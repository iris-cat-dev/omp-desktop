import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  BackgroundProcessSchema,
  BackgroundProcessOutputSchema,
  type BackgroundProcess,
  type BackgroundProcessOutput,
} from "@omp-desktop/protocol/background-processes";
import type { Logger } from "pino";

import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import {
  JSONL_RPC_DEFAULT_TIMEOUT_MS,
  JsonlRpcProcess,
  JSONL_RPC_NO_TIMEOUT,
  supportsJsonlRpcProtocolV2,
  type JsonlRpcLaunch,
} from "../jsonl-rpc-process.js";
import {
  buildOmpLaunch,
  type OmpRuntime,
  type OmpRuntimeLaunch,
  type OmpRuntimeSession,
  type OmpStartSessionInput,
} from "./runtime.js";
import {
  OmpBranchMessagesResultSchema,
  OmpBranchResultSchema,
  OmpCommandsResultSchema,
  OmpFastModeResultSchema,
  OmpHostToolsResultSchema,
  OmpLoginProvidersResultSchema,
  OmpMessagesResultSchema,
  OmpModelSchema,
  OmpModelsResultSchema,
  OmpPromptAckSchema,
  OmpRpcCommandSchema,
  OmpRuntimeEventSchema,
  OmpSessionStateSchema,
  OmpSessionStatsSchema,
  type OmpThinkingLevel,
  type OmpFastModeResult,
  type OmpAgentMessage,
  type OmpLoginProvider,
  type OmpModel,
  type OmpPromptAck,
  type OmpRpcCommand,
  type OmpRpcHostToolDefinition,
  type OmpRpcHostToolResult,
  type OmpRpcHostToolUpdate,
  type OmpRpcSlashCommand,
  type OmpRuntimeEvent,
  type OmpSessionState,
  type OmpSessionStats,
  type OmpSubagentSubscriptionLevel,
} from "./rpc-types.js";

const DEFAULT_OMP_COMMAND: [string, ...string[]] = [process.env.OMP_COMMAND ?? "omp"];
const DEFAULT_COMMANDS_RPC_NAME = "get_available_commands";
/** Allow cold OMP starts the same 30-second budget as other control-plane RPCs. */
const OMP_READY_TIMEOUT_MS = JSONL_RPC_DEFAULT_TIMEOUT_MS;

export function resolveOmpBackgroundJobsExtensionPath(
  moduleUrl: string | URL = import.meta.url,
  pathExists: (path: string) => boolean = existsSync,
): string {
  const compiled = fileURLToPath(new URL("./background-jobs-extension.js", moduleUrl));
  const source = fileURLToPath(new URL("./background-jobs-extension.ts", moduleUrl));
  const extension = pathExists(compiled) ? compiled : source;
  return extension.replace(/\.asar(?=[/\\]|$)/, ".asar.unpacked");
}

export class OmpReadyTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `OMP did not become ready within ${timeoutMs / 1_000} seconds. Retry the operation; if it keeps failing, restart OMP.`,
    );
    this.name = "OmpReadyTimeoutError";
  }
}

export interface OmpCliRuntimeOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  command?: [string, ...string[]];
  commandsRpcName?: "get_available_commands";
  spawnProcess?: (launch: OmpRuntimeLaunch) => ChildProcessWithoutNullStreams;
}

export class OmpCliRuntime implements OmpRuntime {
  private readonly command: [string, ...string[]];
  private readonly commandsRpcName: "get_available_commands";
  private readonly spawnProcess?: (launch: OmpRuntimeLaunch) => ChildProcessWithoutNullStreams;

  constructor(private readonly options: OmpCliRuntimeOptions) {
    this.command = options.command ?? DEFAULT_OMP_COMMAND;
    this.commandsRpcName = options.commandsRpcName ?? DEFAULT_COMMANDS_RPC_NAME;
    this.spawnProcess = options.spawnProcess;
  }

  async startSession(input: OmpStartSessionInput): Promise<OmpRuntimeSession> {
    const launch = buildOmpLaunch({
      command: this.command,
      runtimeSettings: this.options.runtimeSettings,
      session: input,
    });
    if (input.protocolMode === "rpc-ui") {
      launch.argv.push("--extension", resolveOmpBackgroundJobsExtensionPath());
    }
    const [command, ...args] = launch.argv;
    const processLaunch: JsonlRpcLaunch = {
      command,
      args,
      cwd: launch.cwd,
      env: launch.env,
    };
    const spawn = this.spawnProcess;
    const processOptions = {
      launch: processLaunch,
      logger: this.options.logger,
      diagnosticName: "OMP RPC",
      ...(spawn ? { spawn: () => spawn(launch) } : {}),
    };
    const process = new JsonlRpcProcess(processOptions);
    const runtimeSession = new OmpCliRuntimeSession(process, this.commandsRpcName);
    const handleAbort = () => void process.close(input.signal?.reason).catch(() => undefined);
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    try {
      await negotiateOmpProtocolV2(process, this.options.logger);
      input.signal?.throwIfAborted();
      return runtimeSession;
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error));
      await process.close(startupError);
      throw startupError;
    } finally {
      input.signal?.removeEventListener("abort", handleAbort);
    }
  }
}

/**
 * Wait for OMP to advertise readiness and negotiate RPC protocol v2 when it is
 * supported. OMP caps protocol-v1 single-line frames at 1 MiB; `get_available_models`
 * (and other large payloads) can exceed that and are returned as an overflow error.
 * Protocol v2 lifts the ceiling to 64 MiB by chunking oversized frames, which the
 * JSONL transport reassembles. Supported OMP versions send a `ready` frame immediately
 * after launch; startup fails if the process exits or never becomes ready.
 */
async function negotiateOmpProtocolV2(process: JsonlRpcProcess, logger: Logger): Promise<void> {
  const ready = await waitForOmpReadyFrame(process);
  if (!supportsJsonlRpcProtocolV2(ready)) {
    return;
  }
  const response = (await process.request(
    { type: "negotiate_protocol", protocolVersion: 2 },
    JSONL_RPC_DEFAULT_TIMEOUT_MS,
  )) as { protocolVersion?: unknown } | undefined;
  if (response?.protocolVersion !== 2) {
    throw new Error("OMP did not accept RPC protocol v2");
  }
  logger.debug({}, "Negotiated OMP RPC protocol v2 (chunked frame transport)");
}

function waitForOmpReadyFrame(process: JsonlRpcProcess): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribeMessage = (): void => {};
    let unsubscribeExit = (): void => {};
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: Record<string, unknown> | Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribeMessage();
      unsubscribeExit();
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    unsubscribeMessage = process.onMessage((message) => {
      if (message.type === "ready") {
        finish(message);
      }
    });
    unsubscribeExit = process.onExit(({ error }) => finish(error));
    timer = setTimeout(
      () => finish(new OmpReadyTimeoutError(OMP_READY_TIMEOUT_MS)),
      OMP_READY_TIMEOUT_MS,
    );
  });
}

class OmpCliRuntimeSession implements OmpRuntimeSession {
  private readonly subscribers = new Set<(event: OmpRuntimeEvent) => void>();
  activeBranchEntryId?: string;
  private backgroundJobsEndpoint: { port: number; token: string } | null = null;

  constructor(
    private readonly process: JsonlRpcProcess,
    private readonly commandsRpcName: "get_available_commands",
  ) {
    process.onMessage((message) => {
      if (message.type === "desktop_background_jobs_ready") {
        const endpoint = z
          .object({
            port: z.number().int().min(1).max(65535),
            token: z.string().min(1),
          })
          .safeParse(message);
        if (endpoint.success) this.backgroundJobsEndpoint = endpoint.data;
        return;
      }
      const event = OmpRuntimeEventSchema.safeParse(message);
      if (event.success) {
        this.emit(event.data);
      }
    });
    process.onExit(({ error }) => {
      this.emit({ type: "process_exit", error: error.message });
    });
  }

  onEvent(callback: (event: OmpRuntimeEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async prompt(
    message: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
  ): Promise<OmpPromptAck> {
    const { id: requestId, promise } = this.process.startRequest({
      type: "prompt",
      message,
      ...(images?.length ? { images } : {}),
    });
    const ack = OmpPromptAckSchema.parse(await promise) ?? {};
    return { requestId, ...ack };
  }

  async compact(customInstructions?: string): Promise<void> {
    await this.request(
      {
        type: "compact",
        ...(customInstructions ? { customInstructions } : {}),
      },
      JSONL_RPC_NO_TIMEOUT,
    );
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    await this.request({ type: "set_auto_compaction", enabled });
  }

  async abort(): Promise<void> {
    await this.request({ type: "abort" });
  }

  async getState(): Promise<OmpSessionState> {
    return OmpSessionStateSchema.parse(await this.request({ type: "get_state" }));
  }

  async listBackgroundJobs(): Promise<BackgroundProcess[]> {
    if (!this.backgroundJobsEndpoint) return [];
    const payload = await this.requestBackgroundJobs("/list");
    return z.object({ processes: z.array(BackgroundProcessSchema) }).parse(payload).processes;
  }

  async getBackgroundJobOutput(
    processId: string,
    cursor?: number,
  ): Promise<BackgroundProcessOutput> {
    const query = new URLSearchParams({ id: processId });
    if (cursor !== undefined) query.set("cursor", String(cursor));
    return BackgroundProcessOutputSchema.parse(
      await this.requestBackgroundJobs(`/output?${query}`),
    );
  }

  private async requestBackgroundJobs(path: string): Promise<unknown> {
    const endpoint = this.backgroundJobsEndpoint;
    if (!endpoint) throw new Error("OMP background-process bridge is not available yet");
    const response = await fetch(`http://127.0.0.1:${endpoint.port}${path}`, {
      headers: { authorization: `Bearer ${endpoint.token}` },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`OMP background-process request failed (${response.status})`);
    return response.json();
  }

  async setFastMode(enabled: boolean): Promise<OmpFastModeResult> {
    return OmpFastModeResultSchema.parse(await this.request({ type: "set_fast_mode", enabled }));
  }

  async getMessages(): Promise<OmpAgentMessage[]> {
    const data = OmpMessagesResultSchema.parse(await this.request({ type: "get_messages" }));
    return data.messages ?? [];
  }

  async getAvailableModels(timeoutMs?: number | null): Promise<OmpModel[]> {
    const data = OmpModelsResultSchema.parse(
      await this.request({ type: "get_available_models" }, timeoutMs),
    );
    return data.models ?? [];
  }
  async getLoginProviders(): Promise<OmpLoginProvider[]> {
    const data = OmpLoginProvidersResultSchema.parse(
      await this.request({ type: "get_login_providers" }),
    );
    return data.providers ?? [];
  }

  async login(providerId: string): Promise<void> {
    await this.request({ type: "login", providerId }, null);
  }

  async setModel(provider: string, modelId: string): Promise<OmpModel> {
    return OmpModelSchema.parse(await this.request({ type: "set_model", provider, modelId }));
  }

  async setThinkingLevel(level: OmpThinkingLevel): Promise<void> {
    await this.request({ type: "set_thinking_level", level });
  }

  async getSessionStats(): Promise<OmpSessionStats> {
    // COMPAT(ompGetStateFallback): added in v0.1.105 — older OMP binaries
    // lack the `get_session_stats` RPC command; fall back to extracting
    // context window usage from `get_state`. Remove after 2027-01-10 once the
    // supported OMP floor includes `get_session_stats`.
    let stats: OmpSessionStats | undefined;
    try {
      stats = OmpSessionStatsSchema.parse(await this.request({ type: "get_session_stats" }));
    } catch {
      // get_session_stats not supported by this binary — will try get_state below
    }
    if (stats?.tokens == null && stats?.cost == null && stats?.contextUsage == null) {
      try {
        const state = OmpSessionStateSchema.parse(await this.request({ type: "get_state" }));
        const ctx = state.contextUsage;
        if (ctx) {
          return {
            contextUsage: {
              tokens: typeof ctx.tokens === "number" ? ctx.tokens : undefined,
              contextWindow: typeof ctx.contextWindow === "number" ? ctx.contextWindow : undefined,
            },
          };
        }
      } catch {
        // get_state also failed — nothing we can do
      }
    }
    return stats ?? {};
  }

  async getCommands(): Promise<OmpRpcSlashCommand[]> {
    const data = OmpCommandsResultSchema.parse(await this.request({ type: this.commandsRpcName }));
    return data.commands ?? [];
  }

  async setSubagentSubscription(level: OmpSubagentSubscriptionLevel): Promise<void> {
    await this.request({ type: "set_subagent_subscription", level });
  }

  async setHostTools(tools: OmpRpcHostToolDefinition[]): Promise<string[]> {
    const data = OmpHostToolsResultSchema.parse(
      await this.request({ type: "set_host_tools", tools }),
    );
    return data.toolNames ?? [];
  }

  sendHostToolResult(result: OmpRpcHostToolResult): void {
    this.process.send({ ...result });
  }

  sendHostToolUpdate(update: OmpRpcHostToolUpdate): void {
    this.process.send({ ...update });
  }

  async branch(entryId: string): Promise<{ text: string }> {
    const data = OmpBranchResultSchema.parse(await this.request({ type: "branch", entryId }));
    if (data.cancelled === true) {
      throw new Error("OMP branch was cancelled");
    }
    if (typeof data.text !== "string") {
      throw new Error("OMP branch response did not include restored prompt text");
    }
    this.activeBranchEntryId = entryId;
    return { text: data.text };
  }

  async getBranchMessages(): Promise<Array<{ entryId: string; text: string }>> {
    const data = OmpBranchMessagesResultSchema.parse(
      await this.request({ type: "get_branch_messages" }),
    );
    return data.messages ?? [];
  }

  steer(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): void {
    this.process.send({ type: "steer", message, ...(images?.length ? { images } : {}) });
  }

  followUp(
    message: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
  ): void {
    this.process.send({ type: "follow_up", message, ...(images?.length ? { images } : {}) });
  }

  async handoff(customInstructions?: string): Promise<void> {
    await this.request({
      type: "handoff",
      ...(customInstructions ? { customInstructions } : {}),
    });
  }

  respondToExtensionUiRequest(
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): void {
    this.process.send({ type: "extension_ui_response", id, ...response });
  }

  cancelExtensionUiRequest(id: string): void {
    this.respondToExtensionUiRequest(id, { cancelled: true });
  }

  async close(): Promise<void> {
    await this.process.close(new Error("OMP RPC session is closed"));
  }

  private request(command: OmpRpcCommand, timeoutMs?: number | null): Promise<unknown> {
    return this.process.request(OmpRpcCommandSchema.parse(command), timeoutMs);
  }

  private emit(event: OmpRuntimeEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}
