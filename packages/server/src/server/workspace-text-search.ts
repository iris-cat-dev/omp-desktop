import { createRequire } from "node:module";
import { StringDecoder } from "node:string_decoder";

import type {
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResponse,
} from "@omp-desktop/protocol/messages";

import { spawnProcess } from "../utils/spawn.js";

const DEFAULT_VISIBLE_LINE_LIMIT = 2_000;
const DEFAULT_MATCH_LIMIT = 100_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PREVIEW_LENGTH = 4_000;
const PREVIEW_LEADING_CONTEXT = 1_200;

const esmRequire = createRequire(import.meta.url);

export type WorkspaceTextSearchPayload = WorkspaceTextSearchResponse["payload"];

export interface SearchWorkspaceTextOptions extends Omit<
  WorkspaceTextSearchRequest,
  "type" | "requestId" | "searchId"
> {
  signal?: AbortSignal;
  executablePath?: string;
  visibleLineLimit?: number;
  matchLimit?: number;
  timeoutMs?: number;
}

interface RipgrepText {
  text?: string;
  bytes?: string;
}

interface RipgrepMatchEvent {
  type: "match";
  data: {
    path: RipgrepText;
    lines: RipgrepText;
    line_number: number;
    submatches: Array<{ start: number; end: number }>;
  };
}

function resolveRipgrepPath(executablePath?: string): string {
  const configuredPath = executablePath ?? process.env.PASEO_RIPGREP_PATH?.trim();
  if (configuredPath) {
    return configuredPath.includes("app.asar")
      ? configuredPath.replace("app.asar", "app.asar.unpacked")
      : configuredPath;
  }

  const architecture = process.env.npm_config_arch || process.arch;
  const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
  return esmRequire.resolve(
    `@vscode/ripgrep-${process.platform}-${architecture}/bin/${binaryName}`,
  );
}

function decodeRipgrepText(value: RipgrepText): string {
  if (typeof value.text === "string") return value.text;
  if (typeof value.bytes === "string") return Buffer.from(value.bytes, "base64").toString("utf8");
  return "";
}

function utf16IndexAtUtf8Offset(value: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;

  let currentByteOffset = 0;
  let currentUtf16Index = 0;
  for (const character of value) {
    const characterByteLength = Buffer.byteLength(character);
    if (currentByteOffset + characterByteLength > byteOffset) break;
    currentByteOffset += characterByteLength;
    currentUtf16Index += character.length;
  }
  return currentUtf16Index;
}

function createPreview(
  rawText: string,
  rawRanges: Array<{ start: number; length: number }>,
): { text: string; ranges: Array<{ start: number; length: number }> } {
  const text = rawText.replace(/[\r\n]+$/, "");
  if (text.length <= MAX_PREVIEW_LENGTH) return { text, ranges: rawRanges };

  const firstMatchStart = rawRanges[0]?.start ?? 0;
  const sliceStart = Math.max(0, firstMatchStart - PREVIEW_LEADING_CONTEXT);
  const sliceEnd = Math.min(text.length, sliceStart + MAX_PREVIEW_LENGTH);
  const hasPrefix = sliceStart > 0;
  const hasSuffix = sliceEnd < text.length;
  const prefix = hasPrefix ? "…" : "";
  const previewText = `${prefix}${text.slice(sliceStart, sliceEnd)}${hasSuffix ? "…" : ""}`;
  const ranges = rawRanges.flatMap((range) => {
    const start = Math.max(range.start, sliceStart);
    const end = Math.min(range.start + range.length, sliceEnd);
    if (end <= start) return [];
    return [{ start: start - sliceStart + prefix.length, length: end - start }];
  });
  return { text: previewText, ranges };
}

function isRipgrepMatchEvent(value: unknown): value is RipgrepMatchEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<RipgrepMatchEvent>;
  return (
    event.type === "match" &&
    !!event.data &&
    typeof event.data.line_number === "number" &&
    Array.isArray(event.data.submatches)
  );
}

function buildRipgrepArgs(options: SearchWorkspaceTextOptions): string[] {
  const args = ["--json", "--color=never", "--no-messages", "--line-number", "--with-filename"];
  if (!options.regexp) args.push("--fixed-strings");
  if (!options.caseSensitive) args.push("--ignore-case");
  if (options.wholeWord) args.push("--word-regexp");
  for (const glob of options.includeGlobs) args.push("--glob", glob);
  for (const glob of options.excludeGlobs) args.push("--glob", `!${glob}`);
  args.push("--regexp", options.query, ".");
  return args;
}

export async function searchWorkspaceText(
  options: SearchWorkspaceTextOptions,
): Promise<Omit<WorkspaceTextSearchPayload, "requestId">> {
  const visibleLineLimit = options.visibleLineLimit ?? DEFAULT_VISIBLE_LINE_LIMIT;
  const matchLimit = options.matchLimit ?? DEFAULT_MATCH_LIMIT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let cancelled = options.signal?.aborted ?? false;
  let timedOut = false;
  let matchLimitHit = false;
  let visibleLimitHit = false;

  const abortFromCaller = () => {
    cancelled = true;
    controller.abort();
  };
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (cancelled) controller.abort();

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref();

  const filesByPath = new Map<string, WorkspaceTextSearchPayload["files"][number]>();
  const matchingPaths = new Set<string>();
  let visibleLineCount = 0;
  let matchCount = 0;
  let stderr = "";
  let spawnErrorMessage: string | null = null;
  let pendingOutput = "";

  const process = spawnProcess(
    resolveRipgrepPath(options.executablePath),
    buildRipgrepArgs(options),
    {
      cwd: options.cwd,
      envMode: "internal",
      shell: false,
      signal: controller.signal,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const decoder = new StringDecoder("utf8");

  const processLine = (line: string): void => {
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRipgrepMatchEvent(parsed)) return;

    const path = decodeRipgrepText(parsed.data.path).replaceAll("\\", "/").replace(/^\.\//, "");
    const lineText = decodeRipgrepText(parsed.data.lines);
    const remainingMatches = matchLimit - matchCount;
    if (remainingMatches <= 0) {
      matchLimitHit = true;
      controller.abort();
      return;
    }

    const submatches = parsed.data.submatches.slice(0, remainingMatches);
    matchCount += submatches.length;
    matchingPaths.add(path);
    if (submatches.length < parsed.data.submatches.length) matchLimitHit = true;

    if (visibleLineCount < visibleLineLimit) {
      const rawRanges = submatches.map((submatch) => {
        const start = utf16IndexAtUtf8Offset(lineText, submatch.start);
        const end = utf16IndexAtUtf8Offset(lineText, submatch.end);
        return { start, length: Math.max(1, end - start) };
      });
      const preview = createPreview(lineText, rawRanges);
      let file = filesByPath.get(path);
      if (!file) {
        file = { path, matches: [] };
        filesByPath.set(path, file);
      }
      file.matches.push({
        lineNumber: parsed.data.line_number,
        text: preview.text,
        ranges: preview.ranges,
      });
      visibleLineCount += 1;
    } else {
      visibleLimitHit = true;
    }

    if (matchLimitHit) controller.abort();
  };

  const completion = new Promise<number | null>((resolve) => {
    process.stdout?.on("data", (chunk: Buffer) => {
      pendingOutput += decoder.write(chunk);
      let newlineIndex = pendingOutput.indexOf("\n");
      while (newlineIndex >= 0) {
        processLine(pendingOutput.slice(0, newlineIndex));
        pendingOutput = pendingOutput.slice(newlineIndex + 1);
        newlineIndex = pendingOutput.indexOf("\n");
      }
    });
    process.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 16_384) stderr += chunk.toString("utf8");
    });
    process.on("error", (error) => {
      spawnErrorMessage = error.message;
    });
    process.on("close", (code) => resolve(code));
  });

  const exitCode = await completion;
  pendingOutput += decoder.end();
  processLine(pendingOutput);
  clearTimeout(timeout);
  options.signal?.removeEventListener("abort", abortFromCaller);

  let error: string | null = null;
  if (timedOut) {
    error = "Search timed out.";
  } else if (!cancelled && !matchLimitHit && exitCode !== 0 && exitCode !== 1) {
    error = stderr.trim() || spawnErrorMessage || `ripgrep exited with code ${String(exitCode)}.`;
  }

  return {
    files: [...filesByPath.values()],
    matchCount,
    fileCount: matchingPaths.size,
    complete: !cancelled && !timedOut && !matchLimitHit && error === null,
    visibleLimitHit,
    cancelled,
    error,
  };
}
