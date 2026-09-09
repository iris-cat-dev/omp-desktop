import type {
  BackgroundProcess,
  BackgroundProcessOutput,
} from "@omp-desktop/protocol/background-processes";
import type { TerminalManager } from "./terminal-manager.js";
import type { TerminalSession } from "./terminal.js";

interface OwnedTerminal {
  process: BackgroundProcess;
  observedCommand: boolean;
  lastOutput: string;
}
const registries = new WeakMap<TerminalManager, Map<string, OwnedTerminal>>();

function statusForExitCode(exitCode: number | null): BackgroundProcess["status"] {
  if (exitCode === null) return "unknown";
  return exitCode === 0 ? "exited" : "failed";
}

/** Only the tool's authenticated caller can establish ownership; cwd is never an owner. */
export function registerAgentTerminal(
  manager: TerminalManager,
  terminal: TerminalSession,
  agentId: string,
): void {
  let registry = registries.get(manager);
  if (!registry) {
    registry = new Map();
    registries.set(manager, registry);
  }
  const entry: OwnedTerminal = {
    process: {
      id: `terminal:${terminal.id}`,
      name: terminal.name,
      command: terminal.name,
      cwd: terminal.cwd,
      ownerAgentId: agentId,
      scope: "agent",
      source: "terminal",
      status: "unknown",
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      terminalId: terminal.id,
    },
    observedCommand: false,
    lastOutput: "",
  };
  registry.set(entry.process.id, entry);
  const markStarted = () => {
    entry.observedCommand = true;
    entry.process.status = "running";
    entry.process.startedAt = Date.now();
    entry.process.endedAt = null;
    entry.process.exitCode = null;
  };
  const offStarted = terminal.onCommandStarted?.(markStarted);
  const offActivity = terminal.onActivityChange(({ activity }) => {
    if (activity?.state === "working") markStarted();
  });
  const offTitle = terminal.onTitleChange((title) => {
    if (title) {
      entry.process.name = title;
      entry.process.command = title;
    }
  });
  const offFinished = terminal.onCommandFinished(({ exitCode }) => {
    if (!entry.observedCommand) return;
    entry.process.status = statusForExitCode(exitCode);
    entry.process.exitCode = exitCode;
    entry.process.endedAt = Date.now();
  });
  terminal.onExit((info) => {
    offActivity();
    offTitle();
    offFinished();
    offStarted?.();
    entry.process.status = statusForExitCode(info.exitCode);
    entry.process.exitCode = info.exitCode;
    entry.process.endedAt = Date.now();
    entry.process.terminalId = null;
    entry.lastOutput = info.lastOutputLines.join("\r\n");
    for (const [id, candidate] of registry) {
      if (registry.size <= 100) break;
      if (candidate.process.terminalId === null) registry.delete(id);
    }
  });
}

export function listAgentTerminalProcesses(
  manager: TerminalManager,
  agentId: string,
): BackgroundProcess[] {
  const processes: BackgroundProcess[] = [];
  for (const entry of registries.get(manager)?.values() ?? []) {
    if (!entry.observedCommand || entry.process.ownerAgentId !== agentId) continue;
    processes.push({ ...entry.process });
  }
  return processes;
}

export async function readAgentTerminalOutput(
  manager: TerminalManager,
  agentId: string,
  processId: string,
): Promise<BackgroundProcessOutput> {
  const entry = registries.get(manager)?.get(processId);
  if (!entry || entry.process.ownerAgentId !== agentId)
    throw new Error("Background process not found");
  if (entry.process.terminalId) {
    const capture = await manager.captureTerminal(entry.process.terminalId, {
      start: -1000,
      stripAnsi: false,
    });
    return {
      text: capture.lines.join("\r\n"),
      cursor: 0,
      reset: true,
      truncated: capture.totalLines > 1000,
      format: "terminal",
    };
  }
  return {
    text: entry.lastOutput,
    cursor: 0,
    reset: true,
    truncated: true,
    format: "terminal",
  };
}
