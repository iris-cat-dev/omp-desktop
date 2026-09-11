import { describe, expect, it } from "vitest";
import {
  isWorkspaceToolTarget,
  resolveWorkspaceTabWorkspaceId,
  resolveWorkspaceToolSelection,
} from "@/workspace-tabs/tool-workspace-selection";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

const ROUTE = { serverId: "server-1", workspaceId: "workspace-host" };

describe("workspace tool selection", () => {
  it("follows a focused conversation and retains it while a tool has focus", () => {
    const focused = resolveWorkspaceToolSelection({
      current: null,
      routeSelection: ROUTE,
      focusedAgentWorkspaceId: "workspace-conversation",
    });

    expect(focused?.activeSelection).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-conversation",
    });
    expect(
      resolveWorkspaceToolSelection({
        current: focused,
        routeSelection: ROUTE,
        focusedAgentWorkspaceId: null,
      }),
    ).toBe(focused);
  });

  it("resets the tool scope when the route host changes", () => {
    const current = resolveWorkspaceToolSelection({
      current: null,
      routeSelection: ROUTE,
      focusedAgentWorkspaceId: "workspace-conversation",
    });

    expect(
      resolveWorkspaceToolSelection({
        current,
        routeSelection: { serverId: "server-1", workspaceId: "workspace-next" },
        focusedAgentWorkspaceId: null,
      })?.activeSelection,
    ).toEqual({ serverId: "server-1", workspaceId: "workspace-next" });
  });

  it("scopes filesystem and terminal panels without rebinding conversations", () => {
    const tools: WorkspaceTabTarget[] = [
      { kind: "terminal", terminalId: "terminal-1" },
      { kind: "files" },
      { kind: "file", path: "src/index.ts" },
      { kind: "working_diff" },
      { kind: "commit_diff", sha: "abc123" },
      { kind: "pull_request" },
    ];
    const conversations: WorkspaceTabTarget[] = [
      { kind: "agent", agentId: "agent-1" },
      { kind: "draft", draftId: "draft-1" },
      { kind: "background_process", agentId: "agent-1", processId: "process-1" },
    ];

    expect(tools.every(isWorkspaceToolTarget)).toBe(true);
    expect(conversations.some(isWorkspaceToolTarget)).toBe(false);
    expect(
      resolveWorkspaceTabWorkspaceId({
        target: tools[0]!,
        routeWorkspaceId: "workspace-host",
        toolWorkspaceId: "workspace-conversation",
      }),
    ).toBe("workspace-conversation");
    expect(
      resolveWorkspaceTabWorkspaceId({
        target: conversations[0]!,
        routeWorkspaceId: "workspace-host",
        toolWorkspaceId: "workspace-conversation",
      }),
    ).toBe("workspace-host");
  });
});
