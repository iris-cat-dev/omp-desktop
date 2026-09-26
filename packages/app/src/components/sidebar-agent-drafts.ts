import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import {
  collectAllTabs,
  findPaneById,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export interface SidebarAgentDraft {
  serverId: string;
  workspaceId: string;
  tabHostWorkspaceId: string;
  draftId: string;
  selected: boolean;
}

export function groupSidebarAgentDrafts(input: {
  projects: readonly SidebarProjectEntry[];
  workspaceLayouts: Readonly<Record<string, WorkspaceLayout>>;
  activeRouteSelection: ActiveWorkspaceSelection | null;
}): ReadonlyMap<string, SidebarAgentDraft[]> {
  const workspaceByKey = new Map<
    string,
    { serverId: string; workspaceId: string; projectViewKey: string }
  >();
  for (const project of input.projects) {
    for (const workspace of project.workspaces) {
      workspaceByKey.set(workspace.workspaceKey, {
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
        projectViewKey: project.viewKey,
      });
    }
  }

  const draftsByProjectViewKey = new Map<string, SidebarAgentDraft[]>();
  for (const [tabHostWorkspaceKey, layout] of Object.entries(input.workspaceLayouts)) {
    const tabHostWorkspace = workspaceByKey.get(tabHostWorkspaceKey);
    if (!tabHostWorkspace) continue;
    const focusedPane = findPaneById(layout.root, layout.focusedPaneId);
    for (const tab of collectAllTabs(layout.root)) {
      if (tab.target.kind !== "draft") continue;
      const workspaceId = tab.target.workspaceId?.trim() || tabHostWorkspace.workspaceId;
      const workspaceKey = buildWorkspaceTabPersistenceKey({
        serverId: tabHostWorkspace.serverId,
        workspaceId,
      });
      const projectViewKey = workspaceKey
        ? workspaceByKey.get(workspaceKey)?.projectViewKey
        : undefined;
      if (!projectViewKey) continue;
      const drafts = draftsByProjectViewKey.get(projectViewKey) ?? [];
      drafts.push({
        serverId: tabHostWorkspace.serverId,
        workspaceId,
        tabHostWorkspaceId: tabHostWorkspace.workspaceId,
        draftId: tab.target.draftId,
        selected:
          input.activeRouteSelection?.serverId === tabHostWorkspace.serverId &&
          input.activeRouteSelection.workspaceId === tabHostWorkspace.workspaceId &&
          focusedPane?.focusedTabId === tab.tabId,
      });
      draftsByProjectViewKey.set(projectViewKey, drafts);
    }
  }
  return draftsByProjectViewKey;
}
