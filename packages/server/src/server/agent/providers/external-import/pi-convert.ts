import { generateEntryId, type ExternalSessionSourceInfo } from "./delegate.js";
import { parseFirstJsonObject, readTranscriptHead } from "./staging.js";

export interface PiSessionSummary {
  source: ExternalSessionSourceInfo;
  cwd: string;
  createdAt: Date;
  firstUserMessage: string | null;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
}

interface PiHeader {
  id: string;
  timestamp: string;
  cwd: string;
}

export function isPiSessionHeader(
  value: Record<string, unknown>,
): value is PiHeader & Record<string, unknown> {
  return value.type === "session" && typeof value.id === "string" && typeof value.cwd === "string";
}

/** Snapshot one pi transcript for the import list: header + bounded head. */
export async function summarizePiSession(filePath: string): Promise<PiSessionSummary | null> {
  const head = await readTranscriptHead(filePath, 64 * 1024);
  const header = parseFirstJsonObject(head);
  if (!header || !isPiSessionHeader(header)) return null;
  const firstUserMessage = extractFirstUserText(head);
  const model = extractLatestModelChange(head);
  return {
    source: {
      provider: "pi",
      sessionId: header.id,
      sourcePath: filePath,
    },
    cwd: header.cwd,
    createdAt: parseDate(header.timestamp) ?? new Date(0),
    firstUserMessage,
    modelProvider: model?.provider ?? null,
    modelId: model?.modelId ?? null,
    thinkingLevel: extractLatestThinkingLevel(head),
  };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractFirstUserText(chunk: string | null): string | null {
  if (!chunk) return null;
  for (const line of chunk.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = entry.message as Record<string, unknown> | undefined;
    if (entry.type !== "message" || !message || message.role !== "user") continue;
    const text = readMessageText(message.content);
    if (text) return text;
  }
  return null;
}

function readMessageText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string"
    ) {
      parts.push((block as Record<string, unknown>).text as string);
    }
  }
  const joined = parts.join("\n").trim();
  return joined ? joined : null;
}

function extractLatestModelChange(
  chunk: string | null,
): { provider: string | null; modelId: string | null } | null {
  if (!chunk) return null;
  let latest: { provider: string | null; modelId: string | null } | null = null;
  for (const line of chunk.split(/\r?\n/u)) {
    if (!line.includes("model_change")) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== "model_change") continue;
    latest = {
      provider: typeof entry.provider === "string" ? entry.provider : null,
      modelId: typeof entry.modelId === "string" ? entry.modelId : null,
    };
  }
  return latest;
}

function extractLatestThinkingLevel(chunk: string | null): string | null {
  if (!chunk) return null;
  let level: string | null = null;
  for (const line of chunk.split(/\r?\n/u)) {
    if (!line.includes("thinking_level_change")) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== "thinking_level_change") continue;
    level = typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : null;
  }
  return level;
}

/**
 * Build the OMP session header entry for a converted pi transcript. The id is
 * the pi session id, so re-importing the same transcript lands on the same
 * staged file name.
 */
export function buildOmpSessionHeader(input: {
  piSessionId: string;
  timestamp: string;
  cwd: string;
}): Record<string, unknown> {
  return {
    type: "session",
    version: 3,
    id: input.piSessionId,
    timestamp: input.timestamp,
    cwd: input.cwd,
  };
}

/**
 * Convert a pi `model_change` entry to OMP shape. pi persists
 * `{provider, modelId}` separately; OMP persists one fully-qualified `model`
 * string (`<provider>/<modelId>`).
 */
export function convertPiModelChange(
  entry: Record<string, unknown>,
): Record<string, unknown> | null {
  const provider = entry.provider;
  const modelId = entry.modelId;
  if (typeof modelId !== "string" || !modelId) return null;
  const qualified =
    typeof provider === "string" && provider && !modelId.includes("/")
      ? `${provider}/${modelId}`
      : modelId;
  const converted: Record<string, unknown> = { ...entry, model: qualified };
  delete converted.provider;
  delete converted.modelId;
  return converted;
}

/**
 * Pi entry types with no OMP counterpart. OMP's chain reader silently skips
 * unknown types, but pi's UI carriers (tool selection, search payloads,
 * extension messages) would render as noise — drop them during conversion.
 */
export function isDroppablePiEntry(entry: Record<string, unknown>): boolean {
  return entry.type === "custom" || entry.type === "custom_message";
}

export { generateEntryId };
