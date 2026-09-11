import type { SessionInboundMessage, SessionOutboundMessage } from "@omp-desktop/protocol/messages";

import type { Logger } from "pino";
import { OmpPluginCliService } from "./omp-plugin-cli-service.js";

/**
 * Routes `ompPlugins.*` session messages to the CLI-backed service.
 * Kept separate from the daemon plugin runtime (`plugin.*` messages) on
 * purpose: the OMP CLI plugin ecosystem has its own lifecycle and state.
 */
export class OmpPluginSession {
  private readonly service: OmpPluginCliService;
  private readonly emitFn: (msg: SessionOutboundMessage) => void;
  private readonly logger: Logger;

  constructor(options: {
    service: OmpPluginCliService;
    emit: (msg: SessionOutboundMessage) => void;
    logger: Logger;
  }) {
    this.service = options.service;
    this.emitFn = options.emit;
    this.logger = options.logger.child({ module: "omp-plugin-session" });
  }

  handleInboundMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "ompPlugins.list.request": {
        const requestId = msg.requestId;
        return this.reply(
          requestId,
          "ompPlugins.list.response",
          () => this.service.list() as unknown as Promise<Record<string, unknown>>,
        );
      }
      case "ompPlugins.install.request": {
        const { requestId, spec, scope, dryRun } = msg;
        return this.reply(requestId, "ompPlugins.install.response", async () => {
          const result = await this.service.install({ spec, scope, dryRun });
          return { ok: result.ok, plugin: result.plugin ?? null, output: result.output };
        });
      }
      case "ompPlugins.remove.request": {
        const { requestId, name } = msg;
        return this.reply(
          requestId,
          "ompPlugins.remove.response",
          () => this.service.remove(name) as Promise<Record<string, unknown>>,
        );
      }
      case "ompPlugins.setEnabled.request": {
        const { requestId, name, enabled } = msg;
        return this.reply(requestId, "ompPlugins.setEnabled.response", async () => {
          const result = await this.service.setEnabled(name, enabled);
          return { ok: result.ok, name, enabled };
        });
      }
      case "ompPlugins.doctor.request": {
        const requestId = msg.requestId;
        return this.reply(
          requestId,
          "ompPlugins.doctor.response",
          () =>
            this.service.doctor({ fix: msg.fix }) as unknown as Promise<Record<string, unknown>>,
        );
      }
      default:
        return undefined;
    }
  }

  private async reply(
    requestId: string,
    responseType: SessionOutboundMessage["type"],
    operation: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    try {
      const payload = await operation();
      this.emitFn({
        type: responseType,
        payload: { requestId, ...payload },
      } as SessionOutboundMessage);
    } catch (error) {
      this.logger.warn({ err: error, responseType }, "ompPlugins operation failed");
      const statusMessage: SessionOutboundMessage = {
        type: "status",
        payload: {
          status: "ompPlugins_operation_failed",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
          scope: "ompPlugins",
        },
      } as SessionOutboundMessage;
      this.emitFn(statusMessage);
    }
  }
}
