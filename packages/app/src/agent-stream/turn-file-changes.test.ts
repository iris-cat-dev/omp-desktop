import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@omp-desktop/protocol/agent-types";
import type { AgentToolCallItem, StreamItem } from "@/types/stream";

import {
  collectTurnFileChanges,
  collectTurnFileChangesForBar,
  normalizeChangePath,
  toGitPathspec,
} from "./turn-file-changes";

function toolCallItem(input: {
  name: string;
  detail: ToolCallDetail;
  status?: "running" | "completed" | "failed" | "canceled";
  turnId?: string;
}): AgentToolCallItem {
  return {
    kind: "tool_call",
    id: input.name + "-id",
    turnId: input.turnId ?? "turn-1",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: input.name + "-call",
        name: input.name,
        status: input.status ?? "completed",
        error: null,
        detail: input.detail,
      },
    },
  } as AgentToolCallItem;
}

const messageItem = {
  kind: "assistant_message",
  id: "assistant-1",
  turnId: "turn-1",
  timestamp: new Date("2026-01-01T00:00:01Z"),
} as unknown as StreamItem;

describe("collectTurnFileChanges", () => {
  it("maps write tool calls to added files", () => {
    const items = [
      toolCallItem({ name: "write", detail: { type: "write", filePath: "src/new.ts" } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([{ path: "src/new.ts", kind: "added" }]);
  });

  it("maps edit tool calls to modified files", () => {
    const items = [
      toolCallItem({
        name: "edit",
        detail: { type: "edit", filePath: "src/app.ts", oldString: "a", newString: "b" },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([{ path: "src/app.ts", kind: "modified" }]);
  });

  it("detects shell deletions", () => {
    const items = [
      toolCallItem({ name: "shell", detail: { type: "shell", command: "rm -rf build/cache" } }),
      toolCallItem({ name: "shell", detail: { type: "shell", command: "rm src/old.ts" } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "build/cache", kind: "deleted" },
      { path: "src/old.ts", kind: "deleted" },
    ]);
  });

  it("detects quoted absolute-path deletions with trailing echo", () => {
    // Real-world shape: rm "D:/abs/path/i.md" && echo deleted — the rm
    // segment still deletes even though the command continues after &&.
    const items = [
      toolCallItem({
        name: "bash",
        detail: { type: "shell", command: 'rm "D:/ai_projects/bar-test/i.md" && echo deleted' },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "D:/ai_projects/bar-test/i.md", kind: "deleted" },
    ]);
  });

  it("still rejects redirection and substitution segments", () => {
    const items = [
      toolCallItem({ name: "bash", detail: { type: "shell", command: "rm out.txt > log" } }),
      toolCallItem({ name: "bash", detail: { type: "shell", command: "rm $(cat list)" } }),
      toolCallItem({ name: "bash", detail: { type: "shell", command: 'rm "unterminated' } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([]);
  });

  it("detects quoted path deletions without operators", () => {
    const items = [
      toolCallItem({ name: "bash", detail: { type: "shell", command: 'rm "D:/bar/i.md"' } }),
      toolCallItem({ name: "bash", detail: { type: "shell", command: "rm -f 'j.md'" } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "D:/bar/i.md", kind: "deleted" },
      { path: "j.md", kind: "deleted" },
    ]);
  });

  it("detects PowerShell Remove-Item deletions", () => {
    const items = [
      toolCallItem({
        name: "shell",
        detail: { type: "shell", command: "Remove-Item src/old.ts" },
      }),
      toolCallItem({
        name: "shell",
        detail: { type: "shell", command: "remove-item -Recurse build/cache" },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "src/old.ts", kind: "deleted" },
      { path: "build/cache", kind: "deleted" },
    ]);
  });

  it("ignores shell commands with operators and flag-only tails", () => {
    const items = [
      toolCallItem({ name: "shell", detail: { type: "shell", command: "rm -rf && echo hi" } }),
      toolCallItem({ name: "shell", detail: { type: "shell", command: "rm -rf" } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([]);
  });
  it("maps every target of a multi-file rm to its own chip", () => {
    const items = [
      toolCallItem({ name: "shell", detail: { type: "shell", command: "rm a.txt b.txt c.txt" } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "a.txt", kind: "deleted" },
      { path: "b.txt", kind: "deleted" },
      { path: "c.txt", kind: "deleted" },
    ]);
  });

  it("detects touch-created files", () => {
    const items = [
      toolCallItem({
        name: "bash",
        detail: { type: "shell", command: "touch a.txt b.txt c.txt" },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "a.txt", kind: "added" },
      { path: "b.txt", kind: "added" },
      { path: "c.txt", kind: "added" },
    ]);
  });

  it("detects files created by a for-in touch loop (real a.txt~f.txt shape)", () => {
    const items = [
      toolCallItem({
        name: "bash",
        detail: {
          type: "shell",
          command: 'for f in a b c d e f; do touch "$f.txt"; done',
        },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "a.txt", kind: "added" },
      { path: "b.txt", kind: "added" },
      { path: "c.txt", kind: "added" },
      { path: "d.txt", kind: "added" },
      { path: "e.txt", kind: "added" },
      { path: "f.txt", kind: "added" },
    ]);
  });
  it("detects the loop after a cd prefix (real bar-test shape)", () => {
    const items = [
      toolCallItem({
        name: "shell",
        detail: {
          type: "shell",
          command:
            'cd /d/ai_projects/bar-test && for f in a b c d e f; do touch "$f.txt"; done && ls',
        },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "a.txt", kind: "added" },
      { path: "b.txt", kind: "added" },
      { path: "c.txt", kind: "added" },
      { path: "d.txt", kind: "added" },
      { path: "e.txt", kind: "added" },
      { path: "f.txt", kind: "added" },
    ]);
  });

  it("expands the loop variable only where bash would", () => {
    const items = [
      // Single quotes stay literal; unknown $vars reject the segment.
      toolCallItem({
        name: "bash",
        detail: { type: "shell", command: "for f in a b; do touch '$f.txt'; done" },
      }),
      toolCallItem({
        name: "bash",
        detail: { type: "shell", command: 'for f in a b; do touch "$f$g.txt"; done' },
      }),
      // Glob word lists select existing files; touching them adds nothing.
      toolCallItem({
        name: "bash",
        detail: { type: "shell", command: 'for f in *.txt; do touch "$f"; done' },
      }),
      toolCallItem({
        name: "bash",
        detail: { type: "shell", command: 'for f in a b; do touch "$(mktemp)"; done' },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([]);
  });
  it("prefers added over modified when a path is touched then edited", () => {
    const items = [
      toolCallItem({ name: "bash", detail: { type: "shell", command: "touch notes.md" } }),
      toolCallItem({
        name: "edit",
        detail: { type: "edit", filePath: "notes.md", oldString: "a", newString: "b" },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([{ path: "notes.md", kind: "added" }]);
  });

  it("detects delete-named tools with unknown detail input", () => {
    const items = [
      toolCallItem({
        name: "delete_file",
        detail: { type: "unknown", input: { file_path: "src/gone.ts" }, output: null },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([{ path: "src/gone.ts", kind: "deleted" }]);
  });

  it("ignores unknown-detail tools without a delete-shaped name", () => {
    const items = [
      toolCallItem({
        name: "search",
        detail: { type: "unknown", input: { path: "src/app.ts" }, output: null },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([]);
  });

  it("ignores failed and canceled tool calls", () => {
    const items = [
      toolCallItem({
        name: "edit",
        status: "failed",
        detail: { type: "edit", filePath: "src/app.ts" },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([]);
  });

  it("prefers the strongest kind when a path receives several changes", () => {
    const items = [
      toolCallItem({ name: "edit", detail: { type: "edit", filePath: "src/app.ts" } }),
      toolCallItem({ name: "shell", detail: { type: "shell", command: "rm src/app.ts" } }),
      toolCallItem({ name: "write", detail: { type: "write", filePath: "src/app.ts" } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([{ path: "src/app.ts", kind: "deleted" }]);
  });

  it("includes tool calls that precede the footer's assistant message", () => {
    // The footer anchors on the assistant message, but the turn's tool calls
    // usually stream BEFORE it — they must still be collected.
    const items = [
      toolCallItem({ name: "write", detail: { type: "write", filePath: "src/new.ts" } }),
      messageItem,
    ];
    expect(collectTurnFileChanges(items, 1)).toEqual([{ path: "src/new.ts", kind: "added" }]);
  });

  it("collects writes when tool calls carry no turnId (real app shape)", () => {
    // appendAgentToolCall never persists event.turnId onto tool_call items;
    // only user/assistant messages get one. The walk-back must still reach
    // the turn's tool calls via the legacy user_message boundary rule.
    const noTurnId = { turnId: undefined };
    const user = {
      kind: "user_message",
      id: "user-1",
      turnId: "turn-real",
      timestamp: new Date("2026-01-01T00:00:00Z"),
    } as unknown as StreamItem;
    const globCall = {
      ...toolCallItem({ name: "glob", detail: { type: "search", query: "*" } }),
      ...noTurnId,
    } as AgentToolCallItem;
    const writeCall = {
      ...toolCallItem({ name: "write", detail: { type: "write", filePath: "test_doc.md" } }),
      ...noTurnId,
    } as AgentToolCallItem;
    const assistant = {
      kind: "assistant_message",
      id: "assistant-real",
      turnId: "turn-real",
      timestamp: new Date("2026-01-01T00:00:03Z"),
    } as unknown as StreamItem;
    expect(collectTurnFileChanges([user, globCall, writeCall, assistant], 3)).toEqual([
      { path: "test_doc.md", kind: "added" },
    ]);
  });

  it("excludes tool-device and MCP resource writes from file changes", () => {
    const items = [
      toolCallItem({ name: "write", detail: { type: "write", filePath: "xd://lsp" } }),
      toolCallItem({
        name: "write",
        detail: { type: "write", filePath: "mcp://automation/workflow" },
      }),
      toolCallItem({ name: "write", detail: { type: "write", filePath: "src/real-file.ts" } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([{ path: "src/real-file.ts", kind: "added" }]);
  });

  it("classifies live OMP REM deletions (edit with oldText but no newText)", () => {
    // Live REM patches map to edit detail carrying the removed text but no
    // replacement; PUT-style edits carry neither side.
    const items = [
      toolCallItem({
        name: "edit",
        detail: { type: "edit", filePath: "todo.txt", oldString: "hello world" },
      }),
      toolCallItem({
        name: "edit",
        detail: { type: "edit", filePath: "new-file.md" },
      }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "todo.txt", kind: "deleted" },
      { path: "new-file.md", kind: "modified" },
    ]);
  });

  it("classifies hydrated OMP patch-DSL edits (unknown detail)", () => {
    // Live edits arrive as {path, edits}; hydrated replays keep the raw patch
    // text inside an unknown detail. REM-only bodies delete, PUT bodies modify.
    const patchEdit = (input: string) =>
      toolCallItem({
        name: "edit",
        detail: { type: "unknown", input: { input }, output: null },
      });
    const items = [
      patchEdit("[new-file.md#BB28]\nPUT <1:\n+# updated\n"),
      patchEdit("[todo.txt#8DB0]\nREM\n"),
      patchEdit("[mixed.txt#1234]\nPUT <1:\n+x\nREM\n"),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "new-file.md", kind: "modified" },
      { path: "todo.txt", kind: "deleted" },
      { path: "mixed.txt", kind: "modified" },
    ]);
  });

  it("does not cross turn boundaries in either direction", () => {
    const userMessage = {
      kind: "user_message",
      id: "user-2",
      turnId: "turn-2",
      timestamp: new Date("2026-01-01T00:00:02Z"),
    } as unknown as StreamItem;
    const nextTurnToolCall = toolCallItem({
      name: "write",
      detail: { type: "write", filePath: "src/other-turn.ts" },
      turnId: "turn-2",
    });
    const items = [
      toolCallItem({ name: "write", detail: { type: "write", filePath: "src/new.ts" } }),
      messageItem,
      userMessage,
      nextTurnToolCall,
    ];
    expect(collectTurnFileChanges(items, 1)).toEqual([{ path: "src/new.ts", kind: "added" }]);
  });

  it("normalizes windows separators and relative prefixes", () => {
    const items = [
      toolCallItem({ name: "write", detail: { type: "write", filePath: "src\\win.ts" } }),
      toolCallItem({ name: "write", detail: { type: "write", filePath: "./src/rel.ts" } }),
    ];
    expect(collectTurnFileChanges(items, 0)).toEqual([
      { path: "src/win.ts", kind: "added" },
      { path: "src/rel.ts", kind: "added" },
    ]);
  });
});

describe("collectTurnFileChangesForBar", () => {
  it("scans un-grouped rawItems so consecutive same-name tool calls all produce chips", () => {
    // Regression: render projections collapse consecutive same-name agent tool
    // calls into one host entry, so scanning the collapsed array hid all but
    // the first write's chip. The bar must scan the raw (un-grouped) items.
    const rawItems = [
      toolCallItem({ name: "write", detail: { type: "write", filePath: "a.ts" } }),
      toolCallItem({ name: "write", detail: { type: "write", filePath: "b.ts" } }),
      toolCallItem({ name: "write", detail: { type: "write", filePath: "c.ts" } }),
      messageItem,
    ];
    // Collapsed view: three tool calls become one host entry carrying only the
    // first call's data, followed by the anchor assistant message.
    const collapsed = [
      toolCallItem({ name: "write", detail: { type: "write", filePath: "a.ts" } }),
      messageItem,
    ];
    expect(collectTurnFileChangesForBar(collapsed, 1, rawItems)).toEqual([
      { path: "a.ts", kind: "added" },
      { path: "b.ts", kind: "added" },
      { path: "c.ts", kind: "added" },
    ]);
  });

  it("falls back to the collapsed scan when rawItems are absent", () => {
    const items = [
      toolCallItem({ name: "write", detail: { type: "write", filePath: "a.ts" } }),
      messageItem,
    ];
    expect(collectTurnFileChangesForBar(items, 1)).toEqual([{ path: "a.ts", kind: "added" }]);
  });

  it("falls back to the collapsed scan when the anchor is missing from rawItems", () => {
    const collapsed = [messageItem];
    const rawItems = [messageItem];
    expect(collectTurnFileChangesForBar(collapsed, 0, rawItems)).toEqual([]);
  });
});

describe("normalizeChangePath", () => {
  it("converts separators and strips ./", () => {
    expect(normalizeChangePath("a\\b.ts")).toBe("a/b.ts");
    expect(normalizeChangePath("./a/b.ts")).toBe("a/b.ts");
    expect(normalizeChangePath("")).toBeNull();
  });
});

describe("toGitPathspec", () => {
  it("relativizes absolute paths under the cwd", () => {
    expect(toGitPathspec("D:/repo/src/a.ts", "D:\\repo")).toBe("src/a.ts");
    expect(toGitPathspec("/home/u/repo/src/a.ts", "/home/u/repo")).toBe("src/a.ts");
  });

  it("keeps relative paths and outside-cwd paths as-is", () => {
    expect(toGitPathspec("src/a.ts", "D:/repo")).toBe("src/a.ts");
    expect(toGitPathspec("/elsewhere/a.ts", "/home/u/repo")).toBe("/elsewhere/a.ts");
  });
});
