import { cp, mkdir, open, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveOmpDiagnosticPaths } from "../omp/provider-config.js";

/**
 * Root directory that holds OMP session files staged from external agent
 * formats. Files here are hidden from `listOmpImportableSessions` (which scans
 * `~/.omp/agent/sessions`) while remaining resumable by the OMP runtime via
 * `--session <file>`.
 */
export function resolveExternalImportStagingDir(input?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): string {
  const env = input?.env ?? process.env;
  const override = env.OMP_EXTERNAL_IMPORT_STAGING_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  const agentDir = resolveOmpDiagnosticPaths(env, input?.homeDir || undefined).agentDir;
  return path.join(agentDir, "import-staging");
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "session";
}

/**
 * Copy an external session transcript into the staging dir and return the
 * staged file path. The staged copy — not the original — becomes the OMP
 * persistence nativeHandle, so the source file may freely disappear (e.g.
 * Codex archives) without breaking resume.
 */
export async function stageSessionFile(input: {
  sourcePath: string;
  provider: string;
  sessionId: string;
  /** Converted transcript lines; written instead of copying sourcePath. */
  contents?: string[];
  stagingDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): Promise<string> {
  const stagingDir = input.stagingDir ?? resolveExternalImportStagingDir(input);
  await mkdir(stagingDir, { recursive: true });
  const fileName = `${sanitizeSegment(input.provider)}-${sanitizeSegment(input.sessionId)}.jsonl`;
  const target = path.join(stagingDir, fileName);
  // When explicit contents are supplied (the converted transcript), always
  // rewrite: conversion is deterministic and cheap, and the staged file must
  // reflect the latest conversion instead of possibly stale staged bytes.
  if (input.contents !== undefined) {
    await writeFile(target, `${input.contents.join("\n")}\n`, "utf8");
    return target;
  }
  const sourceStat = await stat(input.sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`External session transcript is not a file: ${input.sourcePath}`);
  }
  // Re-copy when the source is newer than the staged copy so repeated imports
  // of an evolving session stay fresh; otherwise reuse the staged bytes.
  let needsCopy = true;
  try {
    const targetStat = await stat(target);
    needsCopy = sourceStat.mtimeMs > targetStat.mtimeMs;
  } catch {
    needsCopy = true;
  }
  if (needsCopy) {
    await cp(input.sourcePath, target, { force: true });
  }
  return target;
}

/**
 * Read the head of a JSONL transcript for header validation. Returns null when
 * the file is unreadable or empty.
 */
export async function readTranscriptHead(
  filePath: string,
  bytes = 64 * 1024,
): Promise<string | null> {
  try {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead <= 0) return null;
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

/** Parse the first JSON object line from a transcript head, skipping preamble. */
export function parseFirstJsonObject(chunk: string | null): Record<string, unknown> | null {
  if (!chunk) return null;
  for (const line of chunk.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      continue;
    }
  }
  return null;
}
