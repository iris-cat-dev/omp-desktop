import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  convertCodexTranscript,
  parseCodexSessionMeta,
  summarizeCodexSession,
} from "./codex-convert.js";
import { listCodexImportableSessions, resolveCodexSessionsRoots } from "./codex-provider.js";

async function writeRollout(root: string, relativePath: string, lines: unknown[]): Promise<string> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return filePath;
}

function rolloutBase(sessionId: string, cwd: string) {
  return [
    {
      timestamp: "2026-08-14T04:49:52.454Z",
      type: "session_meta",
      payload: { id: sessionId, session_id: sessionId, cwd, timestamp: "2026-08-14T04:49:52.454Z" },
    },
  ];
}

function toolCallBlocks(entry: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = entry.message as { content?: Array<Record<string, unknown>> } | undefined;
  return (message?.content ?? []).filter((block) => block.type === "toolCall");
}

describe("codex session meta parsing", () => {
  test("extracts id and cwd from a session_meta head", () => {
    const head = `${JSON.stringify(rolloutBase("abc-123", "D:\\repo")[0])}\n`;
    const meta = parseCodexSessionMeta(head);
    expect(meta).toEqual({
      id: "abc-123",
      cwd: "D:\\repo",
      timestamp: "2026-08-14T04:49:52.454Z",
    });
  });

  test("returns null for non-rollout transcripts", () => {
    const head = `${JSON.stringify({ type: "session", version: 3, id: "x", cwd: "/" })}\n`;
    expect(parseCodexSessionMeta(head)).toBeNull();
    expect(parseCodexSessionMeta(null)).toBeNull();
  });
});

describe("codex conversion", () => {
  test("converts messages, tool calls, and reasoning into a chained OMP transcript", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-codex-convert-"));
    const sourcePath = await writeRollout(root, "rollout.jsonl", [
      ...rolloutBase("sess-1", "D:\\repo"),
      {
        timestamp: "2026-08-14T04:50:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "run the tests" }],
        },
      },
      {
        timestamp: "2026-08-14T04:50:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<environment_context>\n  <cwd>D:\\repo</cwd>\n</environment_context>",
            },
          ],
        },
      },
      {
        timestamp: "2026-08-14T04:50:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "<permissions instructions>behave</permissions instructions>",
            },
          ],
        },
      },
      {
        timestamp: "2026-08-14T04:50:03.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "plan: run vitest" }],
        },
      },
      {
        timestamp: "2026-08-14T04:50:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "shell_command",
          arguments: JSON.stringify({ command: "npm test", timeout_ms: 1000 }),
        },
      },
      {
        timestamp: "2026-08-14T04:50:05.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-1", output: "all green" },
      },
      {
        timestamp: "2026-08-14T04:50:06.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-2",
          name: "update_plan",
          arguments: JSON.stringify({ plan: [{ status: "pending", step: "ship" }] }),
        },
      },
      {
        timestamp: "2026-08-14T04:50:07.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "done" }],
        },
      },
    ]);

    const conversion = await convertCodexTranscript({ sourcePath });
    const entries = conversion.lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(conversion.sessionId).toBe("sess-1");
    expect(entries[0]).toMatchObject({
      type: "session",
      version: 3,
      id: "sess-1",
      cwd: "D:\\repo",
    });
    // Message chains start at parentId: null; the session header is not linked.
    expect((entries[1] as Record<string, unknown>).parentId).toBeNull();

    const roles = entries
      .filter((entry) => entry.type === "message")
      .map((entry) => (entry.message as Record<string, unknown>).role);
    // user, reasoning(thinking), call-1, toolResult, call-2, closing text —
    // injected user/developer messages are filtered out.
    expect(roles).toEqual([
      "user",
      "assistant",
      "assistant",
      "toolResult",
      "assistant",
      "assistant",
    ]);

    const toolCalls = entries.flatMap(toolCallBlocks);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toMatchObject({
      id: "call-1",
      name: "bash",
      arguments: { command: "npm test" },
    });
    expect(toolCalls[1]).toMatchObject({ id: "call-2", name: "update_plan" });

    const toolResult = entries.find((entry) => {
      const message = entry.message as Record<string, unknown> | undefined;
      return message?.role === "toolResult";
    });
    expect(toolResult).toBeDefined();
    const resultMessage = toolResult!.message as Record<string, unknown>;
    expect(resultMessage.toolCallId).toBe("call-1");
    expect(resultMessage.isError).toBe(false);

    const chainOk = entries.every((entry, index) =>
      index <= 1
        ? entry.parentId === null || index === 0
        : entry.parentId === entries[index - 1].id,
    );
    expect(chainOk).toBe(true);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  test("marks execution-error tool results as errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-codex-error-"));
    const sourcePath = await writeRollout(root, "rollout.jsonl", [
      ...rolloutBase("sess-2", "D:\\repo"),
      {
        timestamp: "2026-08-14T05:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-e",
          output: "execution error: Io(...)",
        },
      },
    ]);
    const conversion = await convertCodexTranscript({ sourcePath });
    const entries = conversion.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const toolResult = entries.find(
      (entry) => (entry.message as Record<string, unknown> | undefined)?.role === "toolResult",
    );
    expect((toolResult!.message as Record<string, unknown>).isError).toBe(true);
  });

  test("throws when session_meta is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-codex-bare-"));
    const sourcePath = await writeRollout(root, "rollout.jsonl", [
      {
        timestamp: "2026-08-14T05:00:00.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [] },
      },
    ]);
    await expect(convertCodexTranscript({ sourcePath })).rejects.toThrow(/no session_meta/);
  });
});

describe("codex listing", () => {
  test("lists rollouts with previews and skips non-sessions", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-codex-home-"));
    await writeRollout(path.join(home, "sessions", "2026", "08", "14"), "rollout-a.jsonl", [
      ...rolloutBase("sess-a", "D:\\repo-a"),
      {
        timestamp: "2026-08-14T04:50:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "first real prompt for listing" }],
        },
      },
    ]);
    await writeRollout(path.join(home, "archived_sessions"), "rollout-b.jsonl", [
      ...rolloutBase("sess-b", "D:\\repo-b"),
    ]);
    await writeFile(
      path.join(home, "archived_sessions", "not-a-session.jsonl"),
      `${JSON.stringify({ garbage: true })}\n`,
      "utf8",
    );

    const sessions = await listCodexImportableSessions({
      env: { CODEX_HOME: home },
      homeDir: home,
    });
    expect(
      sessions.map((session) => session.providerHandleId.endsWith("rollout-a.jsonl")),
    ).toContain(true);
    const byId = new Map(sessions.map((session) => [session.cwd, session]));
    expect(byId.get("D:\\repo-a")?.firstPromptPreview).toBe("first real prompt for listing");
    expect(byId.get("D:\\repo-b")).toBeDefined();

    const roots = resolveCodexSessionsRoots({ env: { CODEX_HOME: home }, homeDir: home });
    expect(roots).toEqual([path.join(home, "sessions"), path.join(home, "archived_sessions")]);
  });

  test("summarize rejects non-codex files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-codex-sum-"));
    const ompStyle = await writeRollout(root, "omp.jsonl", [
      { type: "session", version: 3, id: "omp-1", cwd: "D:\\x" },
    ]);
    expect(await summarizeCodexSession(ompStyle)).toBeNull();
  });
});
