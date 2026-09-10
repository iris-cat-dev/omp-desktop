import { readFile } from "node:fs/promises";

import type { ExternalSessionSourceInfo } from "./delegate.js";
import { readTranscriptHead } from "./staging.js";

export interface CodexSessionSummary {
  source: ExternalSessionSourceInfo;
  cwd: string;
  createdAt: Date;
  firstUserMessage: string | null;
}

interface CodexSessionMeta {
  id: string;
  cwd: string;
  timestamp: string | null;
}

const AUTO_INJECTION_PREFIXES = [
  "<user_instructions>",
  "<environment_context>",
  "<permissions instructions>",
  "<app-context>",
  "<turn_context>",
];

export function isInjectedCodexUserText(text: string): boolean {
  const trimmed = text.trimStart();
  return AUTO_INJECTION_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Parse the `session_meta` payload from a rollout head. */
export function parseCodexSessionMeta(head: string | null): CodexSessionMeta | null {
  if (!head) return null;
  for (const line of head.split(/\r?\n/u)) {
    if (!line.includes("session_meta")) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== "session_meta") continue;
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    const id = readString(payload.id) ?? readString(payload.session_id);
    const cwd = readString(payload.cwd);
    if (!id || !cwd) continue;
    return {
      id,
      cwd,
      timestamp: readString(entry.timestamp) ?? readString(payload.timestamp),
    };
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Snapshot one codex rollout for the import list. */
export async function summarizeCodexSession(filePath: string): Promise<CodexSessionSummary | null> {
  const head = await readTranscriptHead(filePath, 256 * 1024);
  const meta = parseCodexSessionMeta(head);
  if (!meta) return null;
  return {
    source: {
      provider: "codex",
      sessionId: meta.id,
      sourcePath: filePath,
    },
    cwd: meta.cwd,
    createdAt: meta.timestamp ? new Date(meta.timestamp) : new Date(0),
    firstUserMessage: extractFirstRealUserText(head),
  };
}

function extractFirstRealUserText(head: string | null): string | null {
  if (!head) return null;
  for (const line of head.split(/\r?\n/u)) {
    if (!line.includes('"response_item"')) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload || payload.type !== "message" || payload.role !== "user") continue;
    const text = readContentText(payload.content);
    if (text && !isInjectedCodexUserText(text)) return text;
  }
  return null;
}

function readContentText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (typeof record.text === "string") parts.push(record.text);
  }
  const joined = parts.join("\n").trim();
  return joined ? joined : null;
}

// --- Conversion: codex rollout JSONL -> OMP v3 transcript ---

export interface CodexConversionResult {
  sessionId: string;
  lines: string[];
}

export function generateEntryId(prefix: string): string {
  const random = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  return `${prefix}${random}`;
}

interface OmpContentBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * Convert codex `function_call` payload into an OMP assistant toolCall block.
 * `shell_command`/`exec_command` map onto OMP's `bash` tool so they render
 * with real shell cards; anything else keeps its codex name and renders as a
 * generic tool call (payload preserved verbatim).
 */
export function convertCodexFunctionCall(
  payload: Record<string, unknown>,
): { id: string; name: string; arguments: Record<string, unknown> } | null {
  const callId = readString(payload.call_id) ?? readString(payload.id);
  const name = readString(payload.name);
  if (!callId || !name) return null;
  let rawArgs: unknown = payload.arguments;
  if (typeof rawArgs === "string") {
    try {
      rawArgs = JSON.parse(rawArgs);
    } catch {
      rawArgs = { input: rawArgs };
    }
  }
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  if (name === "shell_command" || name === "exec_command" || name === "local_shell") {
    const command = readString(args.command) ?? readString(args.cmd);
    if (command) {
      return { id: callId, name: "bash", arguments: { command } };
    }
  }
  if (name === "create_file") {
    const filePath = readString(args.path);
    if (filePath) {
      return {
        id: callId,
        name: "write",
        arguments: {
          path: filePath,
          ...(typeof args.content === "string" ? { content: args.content } : {}),
        },
      };
    }
  }
  return { id: callId, name, arguments: args };
}

/** Full rollout -> OMP transcript conversion. */
export async function convertCodexTranscript(input: {
  sourcePath: string;
}): Promise<CodexConversionResult> {
  const raw = await readFile(input.sourcePath, "utf8");
  const lines: string[] = [];
  let sessionId = "";
  let previousId: string | null = null;
  const emit = (entry: Record<string, unknown>): void => {
    const id = generateEntryId("e");
    lines.push(JSON.stringify({ ...entry, id, parentId: previousId }));
    previousId = id;
  };
  const emitMessage = (role: string, content: OmpContentBlock[], timestamp: string): void => {
    emit({
      type: "message",
      timestamp,
      message: { role, content },
    });
  };

  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const timestamp = readString(entry.timestamp) ?? new Date().toISOString();
    const payload = entry.payload as Record<string, unknown> | undefined;

    if (entry.type === "session_meta") {
      const meta = parseCodexSessionMeta(line);
      if (!meta) continue;
      sessionId = meta.id;
      // OMP session headers keep the session uuid as id and are not part of
      // the parentId chain (message chains start at parentId: null), matching
      // native OMP transcripts.
      lines.push(
        JSON.stringify({
          type: "session",
          version: 3,
          id: meta.id,
          timestamp: meta.timestamp ?? timestamp,
          cwd: meta.cwd,
        }),
      );
      continue;
    }
    if (!sessionId) continue;
    if (entry.type !== "response_item") continue;
    if (!payload) continue;

    handleCodexResponseItem(payload, timestamp, emit, emitMessage);
  }
  if (!sessionId) {
    throw new Error(`codex rollout has no session_meta: ${input.sourcePath}`);
  }
  return { sessionId, lines };
}

/** Convert one codex `response_item` payload into OMP transcript entries. */
function handleCodexResponseItem(
  payload: Record<string, unknown>,
  timestamp: string,
  emit: (entry: Record<string, unknown>) => void,
  emitMessage: (role: string, content: OmpContentBlock[], timestamp: string) => void,
): void {
  switch (payload.type) {
    case "message": {
      const role = readString(payload.role);
      if (role === "assistant") {
        const text = readOutputText(payload.content);
        if (text) emitMessage("assistant", [{ type: "text", text }], timestamp);
        break;
      }
      if (role === "user") {
        const text = readInputText(payload.content);
        if (text && !isInjectedCodexUserText(text)) {
          emitMessage("user", [{ type: "text", text }], timestamp);
        }
        break;
      }
      // developer/environment injections carry no conversation value.
      break;
    }
    case "reasoning": {
      const thinking = readReasoningText(payload);
      if (thinking) emitMessage("assistant", [{ type: "thinking", thinking }], timestamp);
      break;
    }
    case "function_call":
    case "custom_tool_call": {
      const converted = convertCodexFunctionCall(payload);
      if (converted) {
        emitMessage(
          "assistant",
          [
            {
              type: "toolCall",
              id: converted.id,
              name: converted.name,
              arguments: converted.arguments,
            },
          ],
          timestamp,
        );
      }
      break;
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      const callId = readString(payload.call_id);
      if (!callId) break;
      const output = readString(payload.output) ?? "";
      emit({
        type: "message",
        timestamp,
        message: {
          role: "toolResult",
          toolCallId: callId,
          toolName: "",
          content: [{ type: "text", text: output }],
          isError: output.startsWith("execution error"),
        },
      });
      break;
    }
    default:
      break;
  }
}

function readOutputText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "output_text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  const joined = parts.join("\n").trim();
  return joined ? joined : null;
}

function readInputText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "input_text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  const joined = parts.join("\n").trim();
  return joined ? joined : null;
}

function readReasoningText(payload: Record<string, unknown>): string | null {
  const summary = payload.summary;
  if (Array.isArray(summary)) {
    const parts: string[] = [];
    for (const block of summary) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      if (record.type === "summary_text" && typeof record.text === "string") {
        parts.push(record.text);
      }
    }
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }
  const content = payload.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") parts.push(record.text);
    }
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }
  return null;
}
