import { isAgentToolCallItem, type AgentToolCallData, type StreamItem } from "@/types/stream";
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
 * - Shell creation is best-effort: `touch` arguments, including
 *   `for var in <literal words>; do touch "...$var..."; done` loops. Redirections,
 *   echo and cp are not modeled: their shapes cannot be parsed conservatively.
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
  while (turnStart > 0 && continuesTurn(items[turnStart - 1] ?? null, items[turnStart] ?? null)) {
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
    const changes = classifyToolCallChanges(data);
    for (const change of changes) {
      const normalized = normalizeChangePath(change.path);
      if (!normalized) {
        continue;
      }
      const existing = byPath.get(normalized);
      if (!existing || KIND_PRIORITY[change.kind] > KIND_PRIORITY[existing.kind]) {
        byPath.set(normalized, { path: normalized, kind: change.kind });
      }
    }
  }
  return [...byPath.values()];
}

/**
 * Turn file changes for the footer bar. Render projections collapse
 * consecutive agent tool calls into one host entry, so the bar scans the
 * un-grouped `rawItems` when available, relocating the anchor assistant
 * message by item id; collapsed arrays (tests, callers without raw items)
 * keep the legacy behavior.
 */
export function collectTurnFileChangesForBar(
  items: readonly StreamItem[],
  startIndex: number,
  rawItems?: readonly StreamItem[] | null,
): TurnFileChange[] {
  if (!rawItems || rawItems === items) {
    return collectTurnFileChanges(items, startIndex);
  }
  const anchor = items[startIndex];
  if (!anchor) {
    return [];
  }
  const rawAnchorIndex = rawItems.findIndex((item) => item.id === anchor.id);
  if (rawAnchorIndex < 0) {
    return collectTurnFileChanges(items, startIndex);
  }
  return collectTurnFileChanges(rawItems, rawAnchorIndex);
}

/**
 * Maps a single tool call to every file change it represents (an `rm a b` or
 * a `touch` loop covers several paths), or an empty array when the call does
 * not represent file adds/modifies/deletes this feature understands.
 */
function classifyToolCallChanges(data: AgentToolCallData): TurnFileChange[] {
  const detail = data.detail;
  if (detail.type === "write") {
    return detail.filePath ? [{ path: detail.filePath, kind: "added" }] : [];
  }
  if (detail.type === "edit") {
    if (!detail.filePath) {
      return [];
    }
    // OMP REM-style deletions stream as edits whose result carries oldText
    // but no replacement text, while PUT/insert edits leave both unset.
    const removalShaped = detail.oldString !== undefined && detail.newString === undefined;
    return [{ path: detail.filePath, kind: removalShaped ? "deleted" : "modified" }];
  }
  if (detail.type === "shell") {
    const deletions = extractShellDeletePaths(detail.command).map(
      (path): TurnFileChange => ({ path, kind: "deleted" }),
    );
    if (deletions.length > 0) {
      return deletions;
    }
    return extractShellCreatePaths(detail.command).map(
      (path): TurnFileChange => ({ path, kind: "added" }),
    );
  }
  if (detail.type === "unknown") {
    return [extractUnknownChange(data.name, detail.input) ?? classifyUnknownEditPatch(data)].filter(
      (change): change is TurnFileChange => change !== null,
    );
  }
  return [];
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

function extractShellDeletePaths(command: string): string[] {
  const segments = splitShellSegments(command);
  if (!segments) {
    return [];
  }
  const paths: string[] = [];
  for (const segment of segments) {
    const tokens = tokenizeShellSegment(segment);
    if (!tokens || tokens.length < 2 || !tokens[0]) {
      continue;
    }
    if (!SHELL_DELETE_COMMAND_PATTERN.test(tokens[0])) {
      continue;
    }
    // Non-flag tokens are the deletion targets; flags like -rf are skipped.
    for (const token of tokens.slice(1)) {
      if (token && !token.startsWith("-")) {
        paths.push(token);
      }
    }
  }
  return paths;
}

const LOOP_PLACEHOLDER = "\u0000";

/**
 * Recovers file paths a shell command creates. Best-effort and conservative:
 * - `touch <literal paths...>` adds each argument.
 * - `for <var> in <literal words>; do touch "...$<var>..."; done` expands the
 *   loop variable over the literal word list.
 * Redirections, substitution and glob word lists reject the shapes they
 * appear in; anything unparseable yields nothing.
 */
function extractShellCreatePaths(command: string): string[] {
  const segments = splitShellSegments(command);
  if (!segments) {
    return [];
  }
  const loop = extractForLoop(segments);
  if (loop) {
    const paths: string[] = [];
    for (const segment of segments.slice(1)) {
      const tokens = tokenizeShellLoopSegment(segment, loop.loopVar);
      const bodyTokens = tokens?.[0]?.toLowerCase() === "do" ? tokens.slice(1) : tokens;
      if (!bodyTokens || bodyTokens[0]?.toLowerCase() !== "touch") {
        continue;
      }
      for (const token of bodyTokens.slice(1)) {
        if (!token || token.startsWith("-") || token.includes("$")) {
          continue;
        }
        if (token.includes(LOOP_PLACEHOLDER)) {
          for (const word of loop.words) {
            paths.push(token.split(LOOP_PLACEHOLDER).join(word));
          }
        } else {
          paths.push(token);
        }
      }
    }
    if (paths.length > 0) {
      return paths;
    }
  }
  // Plain `touch` without a recognizable loop.
  const paths: string[] = [];
  for (const segment of segments) {
    const tokens = tokenizeShellSegment(segment);
    if (!tokens || tokens[0]?.toLowerCase() !== "touch") {
      continue;
    }
    for (const token of tokens.slice(1)) {
      if (token && !token.startsWith("-")) {
        paths.push(token);
      }
    }
  }
  return paths;
}

function extractForLoop(
  segments: string[],
): { loopVar: string; words: string[] } | null {
  const tokens = tokenizeShellSegment(segments[0] ?? "");
  if (!tokens || tokens.length < 4) {
    return null;
  }
  if (tokens[0]?.toLowerCase() !== "for" || tokens[2]?.toLowerCase() !== "in") {
    return null;
  }
  const loopVar = tokens[1] ?? "";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(loopVar)) {
    return null;
  }
  const words = tokens.slice(3);
  // Glob word lists select existing files; touching them adds nothing.
  if (words.some((word) => /[*?[]/.test(word))) {
    return null;
  }
  return { loopVar, words };
}

/**
 * Tokenizes one `for`-loop body segment, rewriting bare `$<loopVar>` into a
 * placeholder for later word expansion. Expands inside double quotes only
 * (bash semantics); single-quoted `$<var>` stays literal. Substitution forms
 * (`$(`, `${`, backticks) and any other `$` reject the segment.
 */
function tokenizeShellLoopSegment(segment: string, loopVar: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  const expandsAt = (index: number) =>
    segment.startsWith(`$${loopVar}`, index) &&
    /[\s"'.]|$/.test(segment[index + 1 + loopVar.length] ?? "");
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && char === "$" && expandsAt(index)) {
        current += LOOP_PLACEHOLDER;
        index += loopVar.length;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "$") {
      if (expandsAt(index)) {
        current += LOOP_PLACEHOLDER;
        index += loopVar.length;
        continue;
      }
      return null;
    }
    if (SHELL_OPERATOR_PATTERN.test(char) || char === "{" || char === "}") {
      return null;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
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
