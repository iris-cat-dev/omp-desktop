import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAgentOrWorkspace, removeAgentFromHistoryPayload } from "./use-delete-agent";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

describe("deleteAgentOrWorkspace", () => {
  beforeEach(() => {
    useWorkspaceLayoutStore.setState(useWorkspaceLayoutStore.getInitialState(), true);
  });

  function openAgent(workspaceKey: string, agentId: string) {
    return useWorkspaceLayoutStore.getState().openTab({
      workspaceKey,
      target: { kind: "agent", agentId },
      intent: "reveal",
    });
  }

  it("purges the deleted workspace layout without affecting another host", async () => {
    openAgent("server-a:workspace-1", "agent-1");
    openAgent("server-a:workspace-1", "child");
    openAgent("server-b:workspace-1", "agent-1");
    const otherLayout =
      useWorkspaceLayoutStore.getState().layoutByWorkspace["server-b:workspace-1"];
    const client = {
      deleteAgent: vi.fn(),
      deleteWorkspace: vi.fn().mockResolvedValue({ error: null }),
    };

    await deleteAgentOrWorkspace(client, {
      serverId: "server-a",
      agentId: "agent-1",
      workspaceId: "workspace-1",
    });

    expect(
      useWorkspaceLayoutStore.getState().layoutByWorkspace["server-a:workspace-1"],
    ).toBeUndefined();
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace["server-b:workspace-1"]).toBe(
      otherLayout,
    );
  });

  it.each([true, false])("closes an agent-only deletion with active=%s", async (active) => {
    openAgent("server-a:workspace-1", "agent-1");
    openAgent("server-a:workspace-1", "survivor");
    if (active) openAgent("server-a:workspace-1", "agent-1");
    openAgent("server-b:workspace-1", "agent-1");
    const otherLayout =
      useWorkspaceLayoutStore.getState().layoutByWorkspace["server-b:workspace-1"];

    await deleteAgentOrWorkspace(
      { deleteAgent: vi.fn().mockResolvedValue(undefined), deleteWorkspace: vi.fn() },
      { serverId: "server-a", agentId: "agent-1" },
    );

    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace["server-a:workspace-1"];
    expect(
      collectAllTabs(layout.root)
        .filter((tab) => tab.target.kind === "agent")
        .map((tab) => tab.target),
    ).toEqual([{ kind: "agent", agentId: "survivor" }]);
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace["server-b:workspace-1"]).toBe(
      otherLayout,
    );
  });

  it("preserves open tabs when workspace deletion fails", async () => {
    openAgent("server-a:workspace-1", "agent-1");
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace["server-a:workspace-1"];
    await expect(
      deleteAgentOrWorkspace(
        { deleteAgent: vi.fn(), deleteWorkspace: vi.fn().mockResolvedValue({ error: "denied" }) },
        { serverId: "server-a", agentId: "agent-1", workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow("denied");
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace["server-a:workspace-1"]).toBe(
      layout,
    );
  });
});

describe("removeAgentFromHistoryPayload", () => {
  it("removes only the deleted host-scoped agent from every history page", () => {
    const payload = {
      pages: [
        {
          agents: [
            { id: "shared-id", serverId: "server-a" },
            { id: "shared-id", serverId: "server-b" },
          ],
        },
        { agents: [{ id: "other", serverId: "server-a" }] },
      ],
    };

    const result = removeAgentFromHistoryPayload(payload, {
      serverId: "server-a",
      agentId: "shared-id",
    });

    expect(result.pages).toEqual([
      { agents: [{ id: "shared-id", serverId: "server-b" }] },
      { agents: [{ id: "other", serverId: "server-a" }] },
    ]);
  });

  it("preserves payload identity when the deleted agent is absent", () => {
    const payload = { pages: [{ agents: [{ id: "other", serverId: "server-a" }] }] };

    expect(
      removeAgentFromHistoryPayload(payload, {
        serverId: "server-a",
        agentId: "missing",
      }),
    ).toBe(payload);
  });
});
