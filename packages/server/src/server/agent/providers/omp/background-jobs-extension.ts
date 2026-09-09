import { randomUUID } from "node:crypto";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async";
import type { AsyncJob } from "@oh-my-pi/pi-coding-agent/async";
import type {
  BackgroundProcess,
  BackgroundProcessOutput,
} from "@omp-desktop/protocol/background-processes";

interface ExtensionContext {
  cwd: string;
  getAsyncJobSnapshot(): { running: AsyncJob[]; recent: AsyncJob[] } | null;
  sessionManager: { getSessionId(): string };
}
interface ExtensionApi {
  on(
    event: "session_start",
    handler: (event: unknown, context: ExtensionContext) => Promise<void>,
  ): void;
  on(event: "session_shutdown", handler: () => void): void;
}
interface OutputRecord {
  text: string;
  cursor: number;
  truncated: boolean;
}
const MAX_OUTPUT_CHARS = 128 * 1024;
const MAX_RETAINED_JOBS = 100;

interface JobBridgeState {
  context: ExtensionContext;
  manager: AsyncJobManager;
  processPrefix: string;
  outputs: Map<string, OutputRecord>;
  retained: Map<string, BackgroundProcess>;
  rememberOutput(id: string, text: string): void;
}

function jobStatus(job: AsyncJob): BackgroundProcess["status"] {
  return job.status === "completed" ? "exited" : job.status;
}

function jobExitCode(job: AsyncJob): number | null {
  if (job.latestDetails?.exitCode !== undefined) return job.latestDetails.exitCode;
  return job.status === "completed" ? 0 : null;
}

function retainJob(state: JobBridgeState, row: AsyncJob): void {
  if (row.type !== "bash") return;
  const job = state.manager.getJob(row.id) ?? row;
  const previous = state.retained.get(job.id);
  state.retained.set(job.id, {
    id: `${state.processPrefix}${job.id}`,
    name: job.label,
    command: job.label,
    cwd: state.context.cwd,
    ownerAgentId: null,
    scope: "agent",
    source: "omp-job",
    status: jobStatus(job),
    startedAt: job.startTime,
    endedAt: job.status === "running" ? null : (previous?.endedAt ?? Date.now()),
    exitCode: jobExitCode(job),
    terminalId: null,
  });
  const text = job.errorText ?? job.resultText;
  if (text !== undefined) state.rememberOutput(job.id, text);
}

function retainVisibleJobs(state: JobBridgeState): void {
  const snapshot = state.context.getAsyncJobSnapshot();
  if (!snapshot) return;
  for (const row of snapshot.running) retainJob(state, row);
  for (const row of snapshot.recent) retainJob(state, row);
}

function refreshRetainedJobs(state: JobBridgeState): void {
  // Keep jobs after they fall outside OMP's five-row recent snapshot. Their
  // ownership was established while they were in this session's snapshot.
  for (const [id, row] of state.retained) {
    const job = state.manager.getJob(id);
    if (!job) {
      if (row.status === "running") row.status = "unknown";
      continue;
    }
    if (job.status === "running") continue;
    row.status = jobStatus(job);
    row.endedAt ??= Date.now();
    row.exitCode = jobExitCode(job);
    const text = job.errorText ?? job.resultText;
    if (text !== undefined) state.rememberOutput(id, text);
  }
}

function pruneRetainedJobs(state: JobBridgeState): void {
  for (const [id, row] of state.retained) {
    if (state.retained.size <= MAX_RETAINED_JOBS) return;
    if (row.status === "running") continue;
    state.retained.delete(id);
    state.outputs.delete(id);
  }
}

export default function desktopBackgroundJobs(pi: ExtensionApi): void {
  let cleanup: (() => void) | undefined;
  pi.on("session_start", async (_event, context) => {
    cleanup?.();
    // OMP's compiled extension loader resolves this public package subpath to
    // its own module instance. Never create a second job manager.
    const manager = AsyncJobManager.instance();
    if (!manager) throw new Error("OMP async job manager is unavailable");
    const token = randomUUID();
    const processPrefix = `omp-job:${randomUUID()}:`;
    const outputs = new Map<string, OutputRecord>();
    const retained = new Map<string, BackgroundProcess>();
    let revision = 0;
    let disposed = false;
    const rememberOutput = (id: string, text: string) => {
      if (disposed) return;
      const previous = outputs.get(id);
      const truncated = text.length > MAX_OUTPUT_CHARS || previous?.truncated === true;
      const bounded = text.length > MAX_OUTPUT_CHARS ? text.slice(-MAX_OUTPUT_CHARS) : text;
      if (previous?.text === bounded) return;
      outputs.set(id, { text: bounded, cursor: ++revision, truncated });
    };
    const bridgeState: JobBridgeState = {
      context,
      manager,
      processPrefix,
      outputs,
      retained,
      rememberOutput,
    };
    const list = (): BackgroundProcess[] => {
      retainVisibleJobs(bridgeState);
      refreshRetainedJobs(bridgeState);
      pruneRetainedJobs(bridgeState);
      return [...retained.values()];
    };
    const originalRegister = manager.register;
    // Native background bash deliberately stops its foreground tool updates.
    // Observe its existing progress callback; do not acknowledge, consume,
    // cancel or await a job, and preserve the native callback's exact result.
    const observeRegister: AsyncJobManager["register"] = function (
      this: AsyncJobManager,
      type,
      label,
      run,
      options,
    ) {
      if (type !== "bash") return originalRegister.call(this, type, label, run, options);
      let id: string | undefined;
      let owned = false;
      let pendingText: string | undefined;
      const result = originalRegister.call(this, type, label, run, {
        ...options,
        onProgress: (text, details) => {
          if (id && owned) rememberOutput(id, text);
          else if (!id) pendingText = text;
          return options?.onProgress?.(text, details);
        },
      });
      id = result;
      // Establish ownership from OMP's session-scoped snapshot, not the
      // process-global manager (which also contains child agents' jobs).
      list();
      owned = retained.has(id);
      if (owned && pendingText !== undefined) rememberOutput(id, pendingText);
      if (owned) {
        const refresh = () => {
          if (!disposed) list();
          return undefined;
        };
        void manager.getJob(id)?.promise.then(refresh, refresh);
      }
      return result;
    };
    manager.register = observeRegister;
    // Bun exists only inside the OMP extension host; the desktop Node build
    // deliberately does not depend on Bun's ambient global types.
    const host = globalThis as unknown as {
      Bun: {
        serve(options: { hostname: string; port: number; fetch(request: Request): Response }): {
          port: number;
          stop(): void;
        };
      };
    };
    const bun = host.Bun;
    const server = bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (request.headers.get("authorization") !== `Bearer ${token}`)
          return new Response(null, { status: 401 });
        if (request.method !== "GET") return new Response(null, { status: 405 });
        const url = new URL(request.url);
        const processes = list();
        if (url.pathname === "/list") return Response.json({ processes });
        if (url.pathname !== "/output") return new Response(null, { status: 404 });
        const publicId = url.searchParams.get("id");
        const id = publicId?.startsWith(processPrefix)
          ? publicId.slice(processPrefix.length)
          : null;
        if (!id || !retained.has(id))
          return new Response("Background process not found", { status: 404 });
        const output = outputs.get(id) ?? { text: "", cursor: 0, truncated: false };
        const unchanged = url.searchParams.get("cursor") === String(output.cursor);
        const response: BackgroundProcessOutput = {
          text: unchanged ? "" : output.text,
          cursor: output.cursor,
          reset: !unchanged,
          format: "text",
          truncated: output.truncated,
        };
        return Response.json(response);
      },
    });
    cleanup = () => {
      disposed = true;
      server.stop();
      if (manager.register === observeRegister) manager.register = originalRegister;
      retained.clear();
      outputs.clear();
    };
    process.stdout.write(
      `${JSON.stringify({
        type: "desktop_background_jobs_ready",
        port: server.port,
        token,
      })}\n`,
    );
  });
  pi.on("session_shutdown", () => cleanup?.());
}
