import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { deleteWorkspaceWithCleanup } from "@/workspace/workspace-delete";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

describe("deleteWorkspaceWithCleanup", () => {
  beforeEach(() => {
    useSessionStore.getState().initializeSession("server-a", {} as DaemonClient);
    useWorkspaceLayoutStore.setState(useWorkspaceLayoutStore.getInitialState(), true);
  });

  afterEach(() => {
    useSessionStore.setState((state) => ({ ...state, sessions: {} }));
  });

  function openAgent(workspaceKey: string, agentId: string): void {
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey,
      target: { kind: "agent", agentId },
      intent: "reveal",
    });
  }
  function agent(id: string, workspaceId: string): Agent {
    const now = new Date("2026-01-01T00:00:00.000Z");
    return {
      serverId: "server-a",
      id,
      provider: "codex",
      status: "idle",
      createdAt: now,
      updatedAt: now,
      lastUserMessageAt: null,
      lastActivityAt: now,
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      cwd: "/repo/worktree",
      workspaceId,
      model: null,
      parentAgentId: null,
      labels: {},
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: null,
      activeTurn: null,
    };
  }

  function openAgentIds(workspaceKey: string): string[] {
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
    return collectAllTabs(layout.root).flatMap((tab) =>
      tab.target.kind === "agent" ? [tab.target.agentId] : [],
    );
  }

  it("closes only tabs owned by the deleted workspace across shared tab hosts", async () => {
    const agents = new Map([
      ["agent-deleted", agent("agent-deleted", "workspace-deleted")],
      ["agent-survivor", agent("agent-survivor", "workspace-survivor")],
    ]);
    useSessionStore.getState().setAgents("server-a", agents);
    useSessionStore.getState().setAgentDetails("server-a", new Map(agents));
    openAgent("server-a:workspace-host", "agent-deleted");
    openAgent("server-a:workspace-host", "agent-survivor");
    openAgent("server-a:workspace-deleted", "agent-deleted");
    openAgent("server-a:workspace-deleted", "agent-survivor");
    openAgent("server-b:workspace-host", "agent-deleted");
    const deleteWorkspace = vi.fn().mockResolvedValue({ error: null });

    await deleteWorkspaceWithCleanup(
      { deleteWorkspace },
      { serverId: "server-a", workspaceId: "workspace-deleted" },
    );

    expect(deleteWorkspace).toHaveBeenCalledWith("workspace-deleted");
    expect(openAgentIds("server-a:workspace-host")).toEqual(["agent-survivor"]);
    expect(openAgentIds("server-a:workspace-deleted")).toEqual(["agent-survivor"]);
    expect(openAgentIds("server-b:workspace-host")).toEqual(["agent-deleted"]);
    expect(useSessionStore.getState().sessions["server-a"]?.agents.has("agent-deleted")).toBe(
      false,
    );
    expect(useSessionStore.getState().sessions["server-a"]?.agents.has("agent-survivor")).toBe(
      true,
    );
    expect(useSessionStore.getState().sessions["server-a"]?.agentDetails.has("agent-deleted")).toBe(
      false,
    );
    expect(
      useSessionStore.getState().sessions["server-a"]?.agentDetails.has("agent-survivor"),
    ).toBe(true);
  });

  it("preserves open tabs when workspace deletion fails", async () => {
    openAgent("server-a:workspace-1", "agent-1");
    useSessionStore
      .getState()
      .setAgents("server-a", new Map([["agent-1", agent("agent-1", "workspace-1")]]));
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace["server-a:workspace-1"];

    await expect(
      deleteWorkspaceWithCleanup(
        { deleteWorkspace: vi.fn().mockResolvedValue({ error: "denied" }) },
        { serverId: "server-a", workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow("denied");

    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace["server-a:workspace-1"]).toBe(
      layout,
    );
  });
});
