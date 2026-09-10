import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import type {
  AgentSession,
  AgentSessionConfig,
  ImportProviderSessionContext,
} from "../../agent-sdk-types.js";
import { importExternalSessionViaOmp } from "./delegate.js";
import { resolveExternalImportStagingDir } from "./staging.js";

function buildContext(cwd: string): ImportProviderSessionContext {
  const config = { provider: "omp", cwd } as AgentSessionConfig;
  return { config, storedConfig: { ...config } };
}

describe("external import delegation", () => {
  test("stages the conversion and resumes through the OMP client", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-delegate-home-"));
    const source = path.join(home, "converted.jsonl");
    await writeFile(
      source,
      `${JSON.stringify({ type: "session", version: 3, id: "del-1", cwd: home })}\n`,
      "utf8",
    );

    const resumedHandles: unknown[] = [];
    const fakeSession = { streamHistory: async function* () {} } as unknown as AgentSession;
    const ompClient = {
      provider: "omp",
      resumeSession: async (handle: unknown) => {
        resumedHandles.push(handle);
        return fakeSession;
      },
    };

    const imported = await importExternalSessionViaOmp({
      ompClient,
      request: { providerHandleId: source, cwd: home },
      convertedLines: [
        `${JSON.stringify({ type: "session", version: 3, id: "del-1", cwd: home })}`,
      ],
      context: buildContext(home),
      conversionSessionId: "del-1",
      source: { provider: "pi", sessionId: "del-1", sourcePath: source },
      env: { OMP_EXTERNAL_IMPORT_STAGING_DIR: path.join(home, "staging") },
    });

    expect(resumedHandles).toHaveLength(1);
    const handle = resumedHandles[0] as {
      provider: string;
      sessionId: string;
      nativeHandle: string;
    };
    expect(handle.provider).toBe("omp");
    expect(handle.sessionId).toBe("del-1");
    expect(
      handle.nativeHandle.startsWith(
        resolveExternalImportStagingDir({
          env: { OMP_EXTERNAL_IMPORT_STAGING_DIR: path.join(home, "staging") },
        }),
      ),
    ).toBe(true);
    expect(imported.imported.session).toBe(fakeSession);
    expect(imported.stagedPath).toBe(handle.nativeHandle);
  });

  test("rejects converter/source session id mismatches", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-delegate-mismatch-"));
    const source = path.join(home, "converted.jsonl");
    await writeFile(
      source,
      `${JSON.stringify({ type: "session", version: 3, id: "a" })}\n`,
      "utf8",
    );
    await expect(
      importExternalSessionViaOmp({
        ompClient: { provider: "omp", resumeSession: async () => ({}) as AgentSession },
        request: { providerHandleId: source, cwd: home },
        context: buildContext(home),
        convertedLines: [`${JSON.stringify({ type: "session", version: 3, id: "a", cwd: home })}`],
        source: { provider: "codex", sessionId: "b", sourcePath: source },
        env: { OMP_EXTERNAL_IMPORT_STAGING_DIR: path.join(home, "staging") },
      }),
    ).rejects.toThrow(/sessionId mismatch/);
  });
  test("stages the converted transcript bytes, not the raw source", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-delegate-convert-"));
    // Raw source is codex rollout form; converted lines are OMP v3 form.
    const source = path.join(home, "rollout.jsonl");
    await writeFile(
      source,
      `${JSON.stringify({ type: "session_meta", payload: { id: "raw-1", cwd: home } })}\n`,
      "utf8",
    );
    const convertedLine = `${JSON.stringify({ type: "session", version: 3, id: "raw-1", cwd: home })}`;
    const fakeSession = { streamHistory: async function* () {} } as unknown as AgentSession;
    const ompClient = {
      provider: "omp",
      resumeSession: async () => fakeSession,
    };

    const { stagedPath } = await importExternalSessionViaOmp({
      ompClient,
      request: { providerHandleId: source, cwd: home },
      context: buildContext(home),
      conversionSessionId: "raw-1",
      convertedLines: [convertedLine],
      source: { provider: "codex", sessionId: "raw-1", sourcePath: source },
      env: { OMP_EXTERNAL_IMPORT_STAGING_DIR: path.join(home, "staging") },
    });

    const { readFile } = await import("node:fs/promises");
    const staged = await readFile(stagedPath, "utf8");
    // Staged bytes must be the OMP v3 conversion; the raw rollout first line
    // (`session_meta`) would fail OMP resume header validation.
    expect(staged.split("\n")[0]).toBe(convertedLine);
    expect(staged).not.toContain("session_meta");
  });
});
