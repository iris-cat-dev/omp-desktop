import type pino from "pino";
import type { KeyPair } from "@omp-desktop/relay/e2ee";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import {
  startRelayTransport,
  type RelaySocketLike,
  type RelayTransportController,
} from "./relay-transport.js";

export interface RelayRuntimeConfig {
  enabled: boolean;
  endpoint: string;
  publicEndpoint: string;
  useTls: boolean;
  publicUseTls: boolean;
}

interface RelayRuntimeOptions {
  config: RelayRuntimeConfig;
  logger: pino.Logger;
  attachSocket(ws: RelaySocketLike, metadata?: ExternalSocketMetadata): Promise<void>;
  serverId: string;
  daemonKeyPair: KeyPair;
  startTransport?: typeof startRelayTransport;
}

export interface RelayRuntime {
  getConfig(): RelayRuntimeConfig;
  updateConfig(config: RelayRuntimeConfig): void;
  stop(): Promise<void>;
}

export function createRelayRuntime(options: RelayRuntimeOptions): RelayRuntime {
  const startTransport = options.startTransport ?? startRelayTransport;
  let config = options.config;
  let transport: RelayTransportController | null = null;
  let activeConfig: RelayRuntimeConfig | null = null;
  let scheduled: NodeJS.Immediate | null = null;
  let transition: Promise<void> | null = null;
  let shutdown: Promise<void> | null = null;
  let stopped = false;
  let revision = 0;

  function start(): void {
    transport = startTransport({
      logger: options.logger,
      attachSocket: options.attachSocket,
      relayEndpoint: config.endpoint,
      relayUseTls: config.useTls,
      serverId: options.serverId,
      daemonKeyPair: options.daemonKeyPair,
    });
    activeConfig = config;
  }

  async function reconcile(): Promise<void> {
    if (
      transport &&
      (!config.enabled ||
        activeConfig?.endpoint !== config.endpoint ||
        activeConfig?.useTls !== config.useTls)
    ) {
      // stop drains data responses, closes data, and retires control, in that order.
      // Never register a replacement first: both addresses may reach one relay.
      await transport.stop();
      transport = null;
      activeConfig = null;
    }
    if (!stopped && config.enabled && !transport) start();
  }

  function updateConfig(next: RelayRuntimeConfig): void {
    if (stopped) return;
    config = next;
    revision += 1;
    if (scheduled || transition) return;
    // A dispatch boundary, not a grace-period timer: the requesting session emits
    // its response synchronously, and all its microtasks run before sockets close.
    scheduled = setImmediate(() => {
      scheduled = null;
      const startedRevision = revision;
      transition = reconcile()
        .catch((error) => {
          options.logger.warn({ err: error }, "Failed to rotate relay transport");
        })
        .finally(() => {
          transition = null;
          if (!stopped && revision !== startedRevision) updateConfig(config);
        });
    });
  }

  function stop(): Promise<void> {
    if (shutdown) return shutdown;
    stopped = true;
    config = { ...config, enabled: false };
    if (scheduled) {
      clearImmediate(scheduled);
      scheduled = null;
    }
    shutdown = (async () => {
      await transition;
      await transport?.stop();
      transport = null;
      activeConfig = null;
    })();
    return shutdown;
  }

  if (config.enabled) start();

  return { getConfig: () => config, updateConfig, stop };
}
