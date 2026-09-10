import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { convertPiModelChange, isDroppablePiEntry, summarizePiSession } from "./pi-convert.js";
import {
  convertPiTranscript,
  listPiImportableSessions,
  resolvePiSessionsDir,
} from "./pi-provider.js";
import {
  parseFirstJsonObject,
  readTranscriptHead,
  resolveExternalImportStagingDir,
  stageSessionFile,
} from "./staging.js";

async function writePiSession(
  root: string,
  dirName: string,
  fileName: string,
  lines: unknown[],
): Promise<string> {
  const dir = path.join(root, "sessions", dirName);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return filePath;
}

function piBase(sessionId: string, cwd: string) {
  return [
    { type: "session", version: 3, id: sessionId, timestamp: "2026-09-09T12:51:18.329Z", cwd },
  ];
}

describe("pi transcript conversion", () => {
  test("converts a pi session into a chained OMP transcript", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-pi-convert-"));
    const sourcePath = await writePiSession(root, "--D--repo--", "s.jsonl", [
      ...piBase("pi-sess-1", "D:\\repo"),
      {
        type: "model_change",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-09T12:51:18.361Z",
        provider: "new-provider",
        modelId: "glm-5.3-flash",
      },
      { type: "custom", customType: "pi-web:tool-selection", id: "c1", data: {} },
      {
        type: "message",
        id: "u1",
        parentId: "m1",
        timestamp: "2026-09-09T12:51:23.000Z",
        message: { role: "user", content: [{ type: "text", text: "make a chip" }] },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-09-09T12:51:24.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "writing" },
            { type: "toolCall", id: "call-9", name: "bash", arguments: { command: "ls" } },
          ],
        },
      },
      {
        type: "message",
        id: "t1",
        parentId: "a1",
        timestamp: "2026-09-09T12:51:25.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-9",
          toolName: "bash",
          content: [{ type: "text", text: "ok" }],
          isError: false,
        },
      },
    ]);

    const conversion = await convertPiTranscript({ sourcePath });
    const entries = conversion.lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(conversion.sessionId).toBe("pi-sess-1");
    expect(entries[0]).toMatchObject({
      type: "session",
      version: 3,
      id: "pi-sess-1",
      cwd: "D:\\repo",
    });

    const types = entries.map((entry) => entry.type);
    expect(types).toEqual(["session", "model_change", "message", "message", "message"]);

    const modelChange = entries[1];
    expect(modelChange.model).toBe("new-provider/glm-5.3-flash");
    expect(modelChange.provider).toBeUndefined();
    expect(modelChange.modelId).toBeUndefined();

    const chainOk = entries.every((entry, index) =>
      index <= 1
        ? entry.parentId === null || index === 0
        : entry.parentId === entries[index - 1].id,
    );
    expect(chainOk).toBe(true);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  test("rejects transcripts without a session header", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-pi-bare-"));
    const sourcePath = await writePiSession(root, "--D--repo--", "bare.jsonl", [
      { type: "message", id: "x", message: { role: "user", content: "hi" } },
    ]);
    await expect(convertPiTranscript({ sourcePath })).rejects.toThrow(/no session header/);
  });
});

describe("pi model change conversion", () => {
  test("qualifies provider/modelId into OMP model", () => {
    expect(convertPiModelChange({ provider: "p", modelId: "m" })).toMatchObject({ model: "p/m" });
    expect(convertPiModelChange({ modelId: "already/qualified" })).toMatchObject({
      model: "already/qualified",
    });
    expect(convertPiModelChange({ provider: "p" })).toBeNull();
  });

  test("drops pi-specific carriers", () => {
    expect(isDroppablePiEntry({ type: "custom" })).toBe(true);
    expect(isDroppablePiEntry({ type: "custom_message" })).toBe(true);
    expect(isDroppablePiEntry({ type: "message" })).toBe(false);
    expect(isDroppablePiEntry({ type: "model_change" })).toBe(false);
  });
});

describe("pi listing", () => {
  test("lists pi sessions with OMP descriptor previews", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-pi-home-"));
    await writePiSession(home, "--D--repo-a--", "2026-09-09T_a.jsonl", [
      ...piBase("sess-a", "D:\\repo-a"),
      {
        type: "message",
        id: "u",
        parentId: null,
        timestamp: "2026-09-09T12:51:23.000Z",
        message: { role: "user", content: [{ type: "text", text: "first prompt for pi listing" }] },
      },
    ]);
    await writePiSession(home, "--D--repo-b--", "not-a-session.jsonl", [{ type: "garbage" }]);

    const sessions = await listPiImportableSessions({
      env: { PI_CODING_AGENT_DIR: home },
      homeDir: home,
    });
    expect(sessions.some((session) => session.cwd === "D:\\repo-a")).toBe(true);
    const target = sessions.find((session) => session.cwd === "D:\\repo-a");
    expect(target?.firstPromptPreview).toBe("first prompt for pi listing");
    expect(target?.providerHandleId.endsWith("2026-09-09T_a.jsonl")).toBe(true);

    expect(resolvePiSessionsDir({ env: { PI_CODING_AGENT_DIR: home }, homeDir: home })).toBe(
      path.join(home, "sessions"),
    );
  });
});

describe("pi summary", () => {
  test("rejects non-pi files and extracts first user text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-pi-sum-"));
    const good = await writePiSession(root, "--D--r--", "good.jsonl", [
      ...piBase("g1", "D:\\r"),
      {
        type: "message",
        id: "u",
        parentId: null,
        timestamp: "2026-09-09T12:51:23.000Z",
        message: { role: "user", content: [{ type: "text", text: "hello pi" }] },
      },
    ]);
    const summary = await summarizePiSession(good);
    expect(summary?.source.sessionId).toBe("g1");
    expect(summary?.firstUserMessage).toBe("hello pi");

    const bad = await writePiSession(root, "--D--r--", "bad.jsonl", [
      {
        timestamp: "2026-09-09T00:00:00.000Z",
        type: "session_meta",
        payload: { id: "x", cwd: "D:\\r" },
      },
    ]);
    expect(await summarizePiSession(bad)).toBeNull();
  });
});

describe("staging", () => {
  test("stages files under the resolved staging dir and reuses fresh copies", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-stage-home-"));
    const source = await writePiSession(home, "--D--r--", "s.jsonl", piBase("st1", "D:\\r"));
    const stagingDir = path.join(home, "staging");

    const staged = await stageSessionFile({
      sourcePath: source,
      provider: "pi",
      sessionId: "st1",
      stagingDir,
    });
    expect(staged.startsWith(stagingDir)).toBe(true);
    expect(staged.endsWith("pi-st1.jsonl")).toBe(true);

    const stagedAgain = await stageSessionFile({
      sourcePath: source,
      provider: "pi",
      sessionId: "st1",
      stagingDir,
    });
    expect(stagedAgain).toBe(staged);

    const envDir = resolveExternalImportStagingDir({
      env: { OMP_EXTERNAL_IMPORT_STAGING_DIR: stagingDir },
      homeDir: home,
    });
    expect(envDir).toBe(stagingDir);
  });

  test("sanitizes hostile session ids", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-stage-hostile-"));
    const source = await writePiSession(home, "--D--r--", "s.jsonl", piBase("x", "D:\\r"));
    const staged = await stageSessionFile({
      sourcePath: source,
      provider: "..\\..\\evil",
      sessionId: "../../etc passwd",
      stagingDir: path.join(home, "staging"),
    });
    // Dots and separators are flattened; no path traversal escapes staging.
    expect(path.basename(staged)).toBe("..-..-evil-..-..-etc-passwd.jsonl");
    expect(staged.startsWith(path.join(home, "staging"))).toBe(true);
  });

  test("head reader parses first JSON object and skips preamble", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-stage-head-"));
    const filePath = path.join(root, "t.jsonl");
    await writeFile(
      filePath,
      `${JSON.stringify({ type: "title", title: "T" })}\n${JSON.stringify({ type: "session", version: 3, id: "h1", cwd: "D:\\r" })}\n`,
      "utf8",
    );
    const head = await readTranscriptHead(filePath);
    expect(parseFirstJsonObject(head)).toMatchObject({ type: "title", title: "T" });
    expect(await readTranscriptHead(path.join(root, "missing.jsonl"))).toBeNull();
    expect(parseFirstJsonObject(null)).toBeNull();
  });
});
