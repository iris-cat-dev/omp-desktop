import { describe, expect, it, vi } from "vitest";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import {
  navigateToLastWorkspace,
  navigateToSidebarWorkspace,
  navigateToWorkspace,
  parseActiveWorkspaceSelection,
  resolveSidebarActiveWorkspaceSelection,
  type NavigateToLastWorkspaceDeps,
  type NavigateToSidebarWorkspaceDeps,
  type NavigateToWorkspaceDeps,
} from "./navigation";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";

interface RecordedTab {
  workspaceKey: string;
  target: WorkspaceTabTarget;
}

function createFakeDeps(overrides: Partial<NavigateToWorkspaceDeps> = {}) {
  const navigations: string[] = [];
  const remembered: ActiveWorkspaceSelection[] = [];
  const openedTabs: RecordedTab[] = [];
  const pinnedAgents: Array<{ workspaceKey: string; agentId: string }> = [];
  const deps: NavigateToWorkspaceDeps = {
    getSessionWorkspaces: () => null,
    getSessionAgents: () => [] as Agent[],
    openTab: ({ workspaceKey, target }) => {
      openedTabs.push({ workspaceKey, target });
      return target.kind === "agent" ? target.agentId : null;
    },
    pinAgent: (workspaceKey, agentId) => pinnedAgents.push({ workspaceKey, agentId }),
    rememberLastWorkspace: (selection) => remembered.push(selection),
    navigateToRoute: (route) => navigations.push(route),
    ...overrides,
  };
  return { deps, navigations, remembered, openedTabs, pinnedAgents };
}

function createSidebarFakeDeps(overrides: Partial<NavigateToSidebarWorkspaceDeps> = {}) {
  const base = createFakeDeps();
  const historyRequests: Array<{ serverId: string; workspaceId: string }> = [];
  const deps: NavigateToSidebarWorkspaceDeps = {
    ...base.deps,
    getSessionAgentsHydrated: () => true,
    fetchWorkspaceAgentHistory: async (serverId, workspaceId) => {
      historyRequests.push({ serverId, workspaceId });
      return [];
    },
    ...overrides,
  };
  return { ...base, deps, historyRequests };
}

function createLastSelectionDeps(
  initial: ActiveWorkspaceSelection | null,
  overrides: Partial<NavigateToWorkspaceDeps> = {},
): {
  deps: NavigateToLastWorkspaceDeps;
  navigations: string[];
  remembered: ActiveWorkspaceSelection[];
} {
  let lastSelection = initial;
  const base = createFakeDeps({
    rememberLastWorkspace: (selection) => {
      lastSelection = selection;
      base.remembered.push(selection);
    },
    ...overrides,
  });
  return {
    deps: { ...base.deps, getLastWorkspaceSelection: () => lastSelection },
    navigations: base.navigations,
    remembered: base.remembered,
  };
}

describe("workspace navigation", () => {
  it("selects the focused agent's owning conversation in a shared tab host", () => {
    expect(
      resolveSidebarActiveWorkspaceSelection({
        routeSelection: { serverId: "server-1", workspaceId: "workspace-host" },
        focusedTarget: { kind: "agent", agentId: "agent-conversation" },
        focusedAgent: { id: "agent-conversation", workspaceId: "workspace-conversation" },
      }),
    ).toEqual({ serverId: "server-1", workspaceId: "workspace-conversation" });
  });

  it("keeps the route workspace selected for non-agent and unresolved tabs", () => {
    const routeSelection = { serverId: "server-1", workspaceId: "workspace-host" };

    expect(
      resolveSidebarActiveWorkspaceSelection({
        routeSelection,
        focusedTarget: { kind: "files" },
        focusedAgent: null,
      }),
    ).toBe(routeSelection);
    expect(
      resolveSidebarActiveWorkspaceSelection({
        routeSelection,
        focusedTarget: { kind: "agent", agentId: "missing" },
        focusedAgent: null,
      }),
    ).toBe(routeSelection);
  });

  it("reports when no last workspace is known", () => {
    const { deps } = createLastSelectionDeps(null);

    expect(navigateToLastWorkspace(deps)).toBe(false);
  });

  it("navigates to a workspace route and remembers the selection", () => {
    const { deps, navigations, remembered } = createFakeDeps();

    navigateToWorkspace({ serverId: "server-1", workspaceId: "workspace-a" }, deps);

    expect(navigations).toEqual(["/h/server-1/workspace/workspace-a"]);
    expect(remembered).toEqual([{ serverId: "server-1", workspaceId: "workspace-a" }]);
  });

  it("focuses the attention agent's tab when a workspace has one", () => {
    const workspace = {
      id: "workspace-a",
      workspaceDirectory: "/repo/workspace-a",
    } as WorkspaceDescriptor;
    const agent = {
      id: "agent-1",
      cwd: "/repo/workspace-a",
      workspaceId: "workspace-a",
      requiresAttention: true,
      attentionReason: "permission",
    } as unknown as Agent;
    const { deps, openedTabs } = createFakeDeps({
      getSessionWorkspaces: () => new Map([[workspace.id, workspace]]),
      getSessionAgents: () => [agent],
    });

    navigateToWorkspace({ serverId: "server-1", workspaceId: "workspace-a" }, deps);

    expect(openedTabs).toEqual([
      {
        workspaceKey: "server-1:workspace-a",
        target: { kind: "agent", agentId: "agent-1" },
      },
    ]);
  });

  it("keeps an explicit tab authoritative over an attention agent", () => {
    const workspace = {
      id: "workspace-a",
      workspaceDirectory: "/repo/workspace-a",
    } as WorkspaceDescriptor;
    const agent = {
      id: "agent-1",
      cwd: "/repo/workspace-a",
      workspaceId: "workspace-a",
      requiresAttention: true,
      attentionReason: "permission",
    } as unknown as Agent;
    const { deps, openedTabs } = createFakeDeps({
      getSessionWorkspaces: () => new Map([[workspace.id, workspace]]),
      getSessionAgents: () => [agent],
    });

    navigateToWorkspace(
      {
        serverId: "server-1",
        workspaceId: "workspace-a",
        target: { kind: "draft", draftId: "draft-1" },
      },
      deps,
    );

    expect(openedTabs).toEqual([
      {
        workspaceKey: "server-1:workspace-a",
        target: { kind: "draft", draftId: "draft-1" },
      },
    ]);
  });

  it("defers an agent tab until a missing workspace is recovered", () => {
    const { deps, navigations, openedTabs } = createFakeDeps({
      getSessionWorkspaces: () => new Map(),
    });

    navigateToWorkspace(
      {
        serverId: "server-1",
        workspaceId: "workspace-a",
        target: { kind: "agent", agentId: "agent-1" },
      },
      deps,
    );

    expect(openedTabs).toEqual([]);
    expect(navigations).toEqual(["/h/server-1/workspace/workspace-a?open=agent%3Aagent-1"]);
  });

  it("opens the latest archived root agent when a sidebar workspace has no active agent", async () => {
    const workspace = {
      id: "workspace-a",
      workspaceDirectory: "/repo/workspace-a",
    } as WorkspaceDescriptor;
    const fetchWorkspaceAgentHistory = vi.fn(async () => [
      {
        id: "agent-archived",
        workspaceId: "workspace-a",
        parentAgentId: null,
      },
    ]);
    const { deps, openedTabs, navigations } = createSidebarFakeDeps({
      getSessionWorkspaces: () => new Map([[workspace.id, workspace]]),
      fetchWorkspaceAgentHistory,
    });

    await navigateToSidebarWorkspace({ serverId: "server-1", workspaceId: "workspace-a" }, deps);

    expect(fetchWorkspaceAgentHistory).toHaveBeenCalledWith("server-1", "workspace-a");
    expect(openedTabs).toEqual([]);
    expect(navigations).toEqual(["/h/server-1/workspace/workspace-a?open=agent%3Aagent-archived"]);
  });

  it("navigates with the active agent open intent when no tab host is available", async () => {
    const workspace = {
      id: "workspace-a",
      workspaceDirectory: "/repo/workspace-a",
    } as WorkspaceDescriptor;
    const activeAgent = {
      id: "agent-active",
      workspaceId: "workspace-a",
      archivedAt: null,
    } as Agent;
    const { deps, historyRequests, openedTabs, navigations, remembered } =
      createSidebarFakeDeps({
        getSessionWorkspaces: () => new Map([[workspace.id, workspace]]),
        getSessionAgents: () => [activeAgent],
      });

    const route = await navigateToSidebarWorkspace(
      { serverId: "server-1", workspaceId: "workspace-a" },
      deps,
    );

    expect(route).toBe("/h/server-1/workspace/workspace-a?open=agent%3Aagent-active");
    expect(historyRequests).toEqual([]);
    expect(openedTabs).toEqual([]);
    expect(navigations).toEqual([route]);
    expect(remembered).toEqual([{ serverId: "server-1", workspaceId: "workspace-a" }]);
  });

  it("opens a sidebar conversation in the current center tab host without navigating", async () => {
    const hostWorkspace = {
      id: "workspace-host",
      workspaceDirectory: "/repo/host",
    } as WorkspaceDescriptor;
    const conversationWorkspace = {
      id: "workspace-conversation",
      workspaceDirectory: "/repo/conversation",
    } as WorkspaceDescriptor;
    const rootAgent = {
      id: "agent-root",
      workspaceId: conversationWorkspace.id,
      parentAgentId: null,
      archivedAt: null,
    } as Agent;
    const childAgent = {
      id: "agent-child",
      workspaceId: conversationWorkspace.id,
      parentAgentId: rootAgent.id,
      archivedAt: null,
    } as Agent;
    const { deps, historyRequests, openedTabs, pinnedAgents, navigations, remembered } =
      createSidebarFakeDeps({
        getSessionWorkspaces: () =>
          new Map([
            [hostWorkspace.id, hostWorkspace],
            [conversationWorkspace.id, conversationWorkspace],
          ]),
        getSessionAgents: () => [childAgent, rootAgent],
      });

    const route = await navigateToSidebarWorkspace(
      {
        serverId: "server-1",
        workspaceId: conversationWorkspace.id,
        tabHost: { serverId: "server-1", workspaceId: hostWorkspace.id },
      },
      deps,
    );

    expect(route).toBe("/h/server-1/workspace/workspace-host");
    expect(historyRequests).toEqual([]);
    expect(openedTabs).toEqual([
      {
        workspaceKey: "server-1:workspace-host",
        target: { kind: "agent", agentId: "agent-root" },
      },
    ]);
    expect(pinnedAgents).toEqual([
      { workspaceKey: "server-1:workspace-host", agentId: "agent-root" },
    ]);
    expect(navigations).toEqual([]);
    expect(remembered).toEqual([]);
  });

  it("opens an archived sidebar conversation in the current center tab host", async () => {
    const hostWorkspace = {
      id: "workspace-host",
      workspaceDirectory: "/repo/host",
    } as WorkspaceDescriptor;
    const conversationWorkspace = {
      id: "workspace-conversation",
      workspaceDirectory: "/repo/conversation",
    } as WorkspaceDescriptor;
    const { deps, openedTabs, pinnedAgents, navigations } = createSidebarFakeDeps({
      getSessionWorkspaces: () =>
        new Map([
          [hostWorkspace.id, hostWorkspace],
          [conversationWorkspace.id, conversationWorkspace],
        ]),
      fetchWorkspaceAgentHistory: async () => [
        {
          id: "agent-archived",
          workspaceId: conversationWorkspace.id,
          parentAgentId: null,
        },
      ],
    });

    await navigateToSidebarWorkspace(
      {
        serverId: "server-1",
        workspaceId: conversationWorkspace.id,
        tabHost: { serverId: "server-1", workspaceId: hostWorkspace.id },
      },
      deps,
    );

    expect(openedTabs).toEqual([
      {
        workspaceKey: "server-1:workspace-host",
        target: { kind: "agent", agentId: "agent-archived" },
      },
    ]);
    expect(pinnedAgents).toEqual([
      { workspaceKey: "server-1:workspace-host", agentId: "agent-archived" },
    ]);
    expect(navigations).toEqual([]);
  });

  it("keeps the current tab host when the clicked workspace has no conversation", async () => {
    const hostWorkspace = {
      id: "workspace-host",
      workspaceDirectory: "/repo/host",
    } as WorkspaceDescriptor;
    const emptyWorkspace = {
      id: "workspace-empty",
      workspaceDirectory: "/repo/empty",
    } as WorkspaceDescriptor;
    const { deps, openedTabs, navigations, remembered } = createSidebarFakeDeps({
      getSessionWorkspaces: () =>
        new Map([
          [hostWorkspace.id, hostWorkspace],
          [emptyWorkspace.id, emptyWorkspace],
        ]),
    });

    const route = await navigateToSidebarWorkspace(
      {
        serverId: "server-1",
        workspaceId: emptyWorkspace.id,
        tabHost: { serverId: "server-1", workspaceId: hostWorkspace.id },
      },
      deps,
    );

    expect(route).toBe("/h/server-1/workspace/workspace-host");
    expect(openedTabs).toEqual([]);
    expect(navigations).toEqual([]);
    expect(remembered).toEqual([]);
  });

  it("navigates when the active tab host belongs to another server", async () => {
    const conversationWorkspace = {
      id: "workspace-conversation",
      workspaceDirectory: "/repo/conversation",
    } as WorkspaceDescriptor;
    const activeAgent = {
      id: "agent-active",
      workspaceId: conversationWorkspace.id,
      parentAgentId: null,
      archivedAt: null,
    } as Agent;
    const { deps, openedTabs, navigations } = createSidebarFakeDeps({
      getSessionWorkspaces: () => new Map([[conversationWorkspace.id, conversationWorkspace]]),
      getSessionAgents: () => [activeAgent],
    });

    await navigateToSidebarWorkspace(
      {
        serverId: "server-1",
        workspaceId: conversationWorkspace.id,
        tabHost: { serverId: "server-2", workspaceId: "workspace-host" },
      },
      deps,
    );

    expect(openedTabs).toEqual([]);
    expect(navigations).toEqual([
      "/h/server-1/workspace/workspace-conversation?open=agent%3Aagent-active",
    ]);
  });

  it("reads the active workspace from the current route", () => {
    const selection = parseActiveWorkspaceSelection({
      pathname: "/h/server-1/workspace/workspace-a",
      params: {},
    });

    expect(selection).toEqual({ serverId: "server-1", workspaceId: "workspace-a" });
  });

  it("falls back to workspace route params during cold route mount", () => {
    const selection = parseActiveWorkspaceSelection({
      pathname: "/",
      params: {
        serverId: "server-1",
        workspaceId: "b64_L3RtcC9wYXNlby1taXNzaW5nLXdvcmtzcGFjZQ",
      },
    });

    expect(selection).toEqual({
      serverId: "server-1",
      workspaceId: "/tmp/paseo-missing-workspace",
    });
  });

  // Desktop cold-starts at "/" (packages/desktop/src/main.ts) and restores the
  // remembered workspace, so a workspace is mounted while the pathname carries
  // no workspace at all. Anything that identifies the active workspace from the
  // pathname alone silently gets nothing there — and reports that workspace's
  // panes as closed.
  it("resolves a workspace the pathname alone cannot identify", () => {
    const params = { serverId: "server-1", workspaceId: "workspace-a" };

    expect(parseHostWorkspaceRouteFromPathname("/")).toBeNull();
    expect(parseActiveWorkspaceSelection({ pathname: "/", params })).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-a",
    });
  });

  it("ignores stale workspace route params while an app-wide route is active", () => {
    const selection = parseActiveWorkspaceSelection({
      pathname: "/settings/general",
      params: {
        serverId: "server-1",
        workspaceId: "workspace-a",
      },
    });

    expect(selection).toBeNull();
  });


  it("navigates to the last workspace once a route observation has been remembered", () => {
    const { deps, navigations } = createLastSelectionDeps(null);

    const observed = parseActiveWorkspaceSelection({
      pathname: "/h/server-1/workspace/workspace-a",
      params: {},
    });
    expect(observed).not.toBeNull();
    if (observed) {
      deps.rememberLastWorkspace(observed);
    }

    expect(navigateToLastWorkspace(deps)).toBe(true);
    expect(navigations).toEqual(["/h/server-1/workspace/workspace-a"]);
  });
});
