import { randomUUID } from "node:crypto";

import type {
  AgentClient,
  AgentSessionConfig,
  ImportProviderSessionContext,
  ImportProviderSessionInput,
} from "../../agent-sdk-types.js";

import { importSessionFromPersistence } from "../../provider-session-import.js";
import { resolveExternalImportStagingDir, stageSessionFile } from "./staging.js";

export interface ExternalSessionSourceInfo {
  /** Stable external provider id: "pi" | "codex". */
  provider: string;
  /** Original transcript id (uuid); used for dedup keys and staging names. */
  sessionId: string;
  /** Absolute path of the ORIGINAL transcript file. */
  sourcePath: string;
}

/**
 * Complete an external-session import by delegating to the OMP import flow.
 * The converted OMP transcript is staged outside `~/.omp/agent/sessions` so
 * OMP's own session scanner never lists it as a duplicate import candidate,
 * while persistence/resume still go through the native OMP runtime
 * (`--session <staged file>`).
 */
export async function importExternalSessionViaOmp(input: {
  ompClient: Pick<AgentClient, "provider" | "resumeSession">;
  request: ImportProviderSessionInput;
  context: ImportProviderSessionContext;
  conversionSessionId: string;
  /** Converted OMP transcript lines from the provider converter. */
  convertedLines: string[];
  source: ExternalSessionSourceInfo;
  importConfig?: Partial<AgentSessionConfig>;
  env?: NodeJS.ProcessEnv;
}) {
  if (input.conversionSessionId !== input.source.sessionId) {
    throw new Error(
      `Conversion sessionId mismatch: converter emitted '${input.conversionSessionId}', source said '${input.source.sessionId}'`,
    );
  }
  const stagingDir = resolveExternalImportStagingDir({ env: input.env });
  const stagedPath = await stageSessionFile({
    sourcePath: input.source.sourcePath,
    provider: input.source.provider,
    sessionId: input.source.sessionId,
    contents: input.convertedLines,
    stagingDir,
  });
  const imported = await importSessionFromPersistence({
    provider: input.ompClient.provider,
    request: input.request,
    context: input.context,
    resumeSession: input.ompClient.resumeSession.bind(input.ompClient),
    config: input.importConfig,
    persistence: {
      provider: input.ompClient.provider,
      sessionId: input.source.sessionId,
      nativeHandle: stagedPath,
    },
  });
  return { imported, stagedPath };
}

/** Generate an 8-hex entry id compatible with OMP history entries. */
export function generateEntryId(): string {
  return randomUUID().replace(/-/gu, "").slice(0, 8);
}
