import { describe, expect, it } from "vitest";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SplitPane, WorkspaceLayout } from "@/stores/workspace-layout-store";
import { groupSidebarAgentDrafts } from "./sidebar-agent-drafts";

const hostWorkspace = {
  workspaceKey: "server-1:workspace-host",
  serverId: "server-1",
  workspaceId: "workspace-host",
  projectViewKey: "project-host",
  projectName: "Host project",
  projectRootPath: "/host",
  workspaceDirectory: "/host",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "main",
} as const;
const targetWorkspace = {
  workspaceKey: "server-1:workspace-target",
  serverId: "server-1",
  workspaceId: "workspace-target",
  projectViewKey: "project-target",
  projectName: "Target project",
  projectRootPath: "/target",
  workspaceDirectory: "/target",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "main",
} as const;
const projects: SidebarProjectEntry[] = [
  {
    viewKey: "project-host",
    projectName: "Host project",
    projectKind: "git",
    iconWorkingDir: "/host",
    hosts: [],
    workspaces: [hostWorkspace],
  },
  {
    viewKey: "project-target",
    projectName: "Target project",
    projectKind: "git",
    iconWorkingDir: "/target",
    hosts: [],
    workspaces: [targetWorkspace],
  },
];
const hostLayout: WorkspaceLayout = {
  focusedPaneId: "main",
  root: {
    kind: "pane",
    pane: {
      id: "main",
      tabIds: ["agent_existing", "draft-new"],
      focusedTabId: "draft-new",
      tabs: [
        {
          tabId: "agent_existing",
          target: { kind: "agent", agentId: "existing" },
          createdAt: 1,
        },
        {
          tabId: "draft-new",
          target: {
            kind: "draft",
            draftId: "draft-new",
            workspaceId: "workspace-target",
          },
          createdAt: 2,
        },
      ],
    } as SplitPane,
  },
};

describe("sidebar agent drafts", () => {
  it("groups a hosted draft under its execution project without moving the tab host", () => {
    const grouped = groupSidebarAgentDrafts({
      projects,
      workspaceLayouts: { [hostWorkspace.workspaceKey]: hostLayout },
      activeRouteSelection: {
        serverId: hostWorkspace.serverId,
        workspaceId: hostWorkspace.workspaceId,
      },
    });

    expect(grouped.get("project-host")).toBeUndefined();
    expect(grouped.get("project-target")).toEqual([
      {
        serverId: "server-1",
        workspaceId: "workspace-target",
        tabHostWorkspaceId: "workspace-host",
        draftId: "draft-new",
        selected: true,
      },
    ]);
  });
});
