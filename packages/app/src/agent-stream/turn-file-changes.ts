import {
  isAgentToolCallItem,
  type AgentToolCallData,
  type StreamItem,
} from "@/types/stream";
import { continuesTurn } from "./turn-membership";

export type TurnFileChangeKind = "added" | "modified" | "deleted";

export interface TurnFileChange {
  path: string;
  kind: TurnFileChangeKind;
}

const KIND_PRIORITY: Record<TurnFileChangeKind, number> = {
  deleted: 3,
  added: 2,
  modified: 1,
};

// Windows-first app: PowerShell's Remove-Item is as common as rm here.
const SHELL_DELETE_COMMAND_PATTERN = /^(rm|rmdir|unlink|del|remove-item)$/i;
// Per-character guard within one segment: redirections and substitution
// cannot be modeled conservatively, so such segments are skipped entirely.
// (&& || ; | & and newlines were already consumed by segment splitting.)
const SHELL_OPERATOR_PATTERN = /[<>`$()]/;
const DELETE_TOOL_NAME_PATTERN = /(delete|remove|unlink|trash|\brm\b)/i;
const UNKNOWN_PATH_KEYS = ["file_path", "filePath", "path", "target"] as const;
// OMP edit calls stream a patch-DSL input ("[<path>#<hash>]\nPUT/REM..."). On
// hydrated timelines their detail stays "unknown" (the schema expects the
// structured {path, edits} shape, which only the live path provides), so the
// patch text is the only place the target path and operation survive.
const OMP_PATCH_HEADER_PATTERN = /^\[(?<path>.+?)#[^\]\n]+]/m;

/**
 * Collects the files an assistant turn added, modified or deleted from its
 * tool-call stream items. Heuristics (documented for the PR):
 * - `write` tool calls count as added (the write tool is create/overwrite).
 * - `edit` tool calls count as modified.
 * - Deletions are best-effort: shell `rm`-style commands and delete-named
 *   tools with a path-shaped input.
 * - Failed/canceled tool calls are ignored; when one path receives several
 *   kinds the strongest one wins (deleted > added > modified).
 *
 * `startIndex` anchors on the footer's assistant message, which usually comes
 * AFTER the turn's tool calls, so the scan first walks back to the turn start
 * (turnId boundary, or the preceding user_message on legacy timelines) and
 * then stops at the next turn boundary instead of running to the array end.
 */
export function collectTurnFileChanges(
  items: readonly StreamItem[],
  startIndex: number,
): TurnFileChange[] {
  const anchor = items[startIndex];
  if (!anchor) {
    return [];
  }
  let turnStart = startIndex;
  while (
    turnStart > 0 &&
    continuesTurn(items[turnStart - 1] ?? null, items[turnStart] ?? null)
  ) {
    turnStart -= 1;
  }
  const byPath = new Map<string, TurnFileChange>();
  for (let index = turnStart; index < items.length; index += 1) {
    if (index > turnStart && !continuesTurn(items[index - 1] ?? null, items[index] ?? null)) {
      break;
    }
    const item = items[index];
    if (!item || !isAgentToolCallItem(item)) {
      continue;
    }
    const data = item.payload.data;
    if (data.status === "failed" || data.status === "canceled") {
      continue;
    }
    const change = classifyToolCallChange(data);
    if (!change) {
      continue;
    }
    const normalized = normalizeChangePath(change.path);
    if (!normalized) {
      continue;
    }
    const existing = byPath.get(normalized);
    if (!existing || KIND_PRIORITY[change.kind] > KIND_PRIORITY[existing.kind]) {
      byPath.set(normalized, { path: normalized, kind: change.kind });
    }
  }
  return [...byPath.values()];
}

/**
 * Maps a single tool call to a file change, or null when the call does not
 * represent a file add/modify/delete this feature understands.
 */
function classifyToolCallChange(data: AgentToolCallData): TurnFileChange | null {
  const detail = data.detail;
  if (detail.type === "write") {
    return detail.filePath ? { path: detail.filePath, kind: "added" } : null;
  }
  if (detail.type === "edit") {
    if (!detail.filePath) {
      return null;
    }
    // OMP REM-style deletions stream as edits whose result carries oldText
    // but no replacement text, while PUT/insert edits leave both unset.
    const removalShaped = detail.oldString !== undefined && detail.newString === undefined;
    return { path: detail.filePath, kind: removalShaped ? "deleted" : "modified" };
  }
  if (detail.type === "shell") {
    const path = extractShellDeletePath(detail.command);
    return path ? { path, kind: "deleted" } : null;
  }
  if (detail.type === "unknown") {
    return extractUnknownChange(data.name, detail.input) ?? classifyUnknownEditPatch(data);
  }
  return null;
}

/**
 * Recovers file changes from hydrated OMP edit calls whose detail stayed
 * "unknown": the patch DSL input carries the target path in its "[<path>#hash]"
 * header, and REM-only bodies delete the file while PUT bodies modify it.
 */
function classifyUnknownEditPatch(data: AgentToolCallData): TurnFileChange | null {
  if (data.name !== "edit") {
    return null;
  }
  const detail = data.detail;
  if (detail.type !== "unknown" || typeof detail.input !== "object" || detail.input === null) {
    return null;
  }
  const patch = (detail.input as Record<string, unknown>).input;
  if (typeof patch !== "string") {
    return null;
  }
  const header = OMP_PATCH_HEADER_PATTERN.exec(patch);
  const path = header?.groups?.path;
  if (!header || !path) {
    return null;
  }
  const operationLines = patch
    .slice(header.index + header[0].length)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const removalOnly =
    operationLines.length > 0 && operationLines.every((line) => /^REM\b/i.test(line));
  return { path, kind: removalOnly ? "deleted" : "modified" };
}

/**
 * Splits a shell command into runnable segments on && || ; | & and newlines
 * (outside quotes). Each segment is an independent candidate: an agent often
 * appends `&& echo deleted` after the actual rm, and backgrounded/piped rm
 * still deletes. Returns null for unterminated quotes.
 */
function splitShellSegments(command: string): string[] | null {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "&" || char === "|") {
      if (command[index + 1] === char) {
        index += 1;
      }
      segments.push(current);
      current = "";
      continue;
    }
    if (char === ";" || char === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote !== null) {
    return null;
  }
  segments.push(current);
  return segments;
}

/**
 * Tokenizes one segment into arguments, honoring quotes. Returns null when
 * the segment still contains shell syntax this parser cannot model
 * conservatively (redirections, substitution): a misread path could mark the
 * wrong file as deleted.
 */
function tokenizeShellSegment(segment: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of segment) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    if (SHELL_OPERATOR_PATTERN.test(char)) {
      return null;
    }
    current += char;
  }
  if (quote !== null) {
    return null;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function extractShellDeletePath(command: string): string | null {
  const segments = splitShellSegments(command);
  if (!segments) {
    return null;
  }
  for (const segment of segments) {
    const tokens = tokenizeShellSegment(segment);
    if (!tokens || tokens.length < 2 || !tokens[0]) {
      continue;
    }
    if (!SHELL_DELETE_COMMAND_PATTERN.test(tokens[0])) {
      continue;
    }
    // The last non-flag token is the deletion target; flags like -rf are skipped.
    for (let index = tokens.length - 1; index >= 1; index -= 1) {
      const token = tokens[index];
      if (token && !token.startsWith("-")) {
        return token;
      }
    }
  }
  return null;
}
function extractUnknownChange(
  name: string,
  input: unknown,
): { path: string; kind: TurnFileChangeKind } | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const rawPath = UNKNOWN_PATH_KEYS.map((key) => record[key]).find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!rawPath || !DELETE_TOOL_NAME_PATTERN.test(name)) {
    return null;
  }
  return { path: rawPath, kind: "deleted" };
}

export function normalizeChangePath(path: string): string | null {
  const unified = path.replace(/\\/g, "/").trim();
  if (!unified) {
    return null;
  }
  return unified.startsWith("./") ? unified.slice(2) : unified;
}

/**
 * Converts a tool-call file path into a git pathspec for discard/restore
 * requests: forward slashes, and relativized against the agent cwd when the
 * path points inside it.
 */
export function toGitPathspec(filePath: string, cwd: string): string {
  const unified = normalizeChangePath(filePath) ?? filePath;
  const cwdUnified = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const isAbsolute = unified.startsWith("/") || /^[a-zA-Z]:\//.test(unified);
  if (!isAbsolute || !cwdUnified) {
    return unified;
  }
  const prefix = cwdUnified.toLowerCase() + "/";
  if (unified.toLowerCase().startsWith(prefix)) {
    return unified.slice(prefix.length);
  }
  return unified;
}
