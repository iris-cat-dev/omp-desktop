import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  createLastWorkspaceSelectionStore,
  LAST_WORKSPACE_SELECTION_STORAGE_KEY,
  type ActiveWorkspaceSelection,
  type LastWorkspaceSelectionStorage,
} from "@/stores/last-workspace-selection";
import {
  navigateToLastWorkspace as navigateToLastWorkspacePure,
  navigateToSidebarWorkspace as navigateToSidebarWorkspacePure,
  navigateToWorkspace as navigateToWorkspacePure,
  parseActiveWorkspaceSelection,
  resolveSidebarActiveWorkspaceSelection,
  type NavigateToSidebarWorkspaceDeps,
  type NavigateToSidebarWorkspaceInput,
  type NavigateToWorkspaceDeps,
  type NavigateToWorkspaceInput,
} from "./navigation";
import { useSessionStore } from "@/stores/session-store";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit } from "@/utils/host-route-browser";
import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";
import { getParentAgentIdFromLabels } from "@omp-desktop/protocol/agent-labels";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
export type { NavigateToWorkspaceInput } from "./navigation";

const lastWorkspaceSelectionStorage: LastWorkspaceSelectionStorage = {
  read: () => AsyncStorage.getItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY, value),
  clear: () => AsyncStorage.removeItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
};

const lastWorkspaceSelectionStore = createLastWorkspaceSelectionStore(
  lastWorkspaceSelectionStorage,
);

function navigateDeps(): NavigateToWorkspaceDeps {
  return {
    getSessionWorkspaces: (serverId) => useSessionStore.getState().sessions[serverId]?.workspaces,
    getSessionAgents: (serverId) =>
      useSessionStore.getState().sessions[serverId]?.agents.values() ?? [],
    openTab: (input) => useWorkspaceLayoutStore.getState().openTab(input),
    pinAgent: (workspaceKey, agentId) =>
      useWorkspaceLayoutStore.getState().pinAgent(workspaceKey, agentId),
    rememberLastWorkspace: (selection) => lastWorkspaceSelectionStore.remember(selection),
    navigateToRoute: (route) => {
      navigateToHostWorkspaceRoute(route);
      stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit();
    },
  };
}

export function hydrateLastWorkspaceSelection(): Promise<void> {
  return lastWorkspaceSelectionStore.hydrate();
}

export function getLastWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return lastWorkspaceSelectionStore.getSelection();
}

export function getIsLastWorkspaceSelectionHydrated(): boolean {
  return lastWorkspaceSelectionStore.isHydrated();
}

export function navigateToWorkspace(input: NavigateToWorkspaceInput): string {
  return navigateToWorkspacePure(input, navigateDeps());
}

export async function navigateToSidebarWorkspace(
  input: NavigateToSidebarWorkspaceInput,
): Promise<string> {
  const deps: NavigateToSidebarWorkspaceDeps = {
    ...navigateDeps(),
    getSessionAgentsHydrated: (serverId) =>
      useSessionStore.getState().sessions[serverId]?.hasHydratedAgents ?? false,
    fetchWorkspaceAgentHistory: async (serverId, workspaceId) => {
      const client = useSessionStore.getState().sessions[serverId]?.client;
      if (!client) {
        return [];
      }
      const payload = await client.fetchAgentHistory({
        filter: {
          includeArchived: true,
          workspaceIds: [workspaceId],
        },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 200 },
      });
      return payload.entries.map(({ agent }) => ({
        id: agent.id,
        workspaceId: agent.workspaceId,
        parentAgentId: getParentAgentIdFromLabels(agent.labels),
      }));
    },
  };
  return navigateToSidebarWorkspacePure(input, deps);
}

export function navigateToLastWorkspace(): boolean {
  return navigateToLastWorkspacePure({
    ...navigateDeps(),
    getLastWorkspaceSelection: () => lastWorkspaceSelectionStore.getSelection(),
  });
}

export function useActiveWorkspaceSelection(): ActiveWorkspaceSelection | null {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const selection = parseActiveWorkspaceSelection({ pathname: usePathname(), params });
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  useEffect(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    lastWorkspaceSelectionStore.remember({ serverId, workspaceId });
  }, [serverId, workspaceId]);
  return selection;
}
export function useSidebarActiveWorkspaceSelection(): ActiveWorkspaceSelection | null {
  const routeSelection = useActiveWorkspaceSelection();
  const workspaceKey = routeSelection ? buildWorkspaceTabPersistenceKey(routeSelection) : null;
  const focusedTarget = useWorkspaceLayoutStore((state) => {
    const layout = workspaceKey ? state.layoutByWorkspace[workspaceKey] : null;
    if (!layout) {
      return null;
    }
    const focusedPane = findPaneById(layout.root, layout.focusedPaneId);
    if (!focusedPane?.focusedTabId || focusedPane.hidden === true) {
      return null;
    }
    return (
      collectAllTabs(layout.root).find((tab) => tab.tabId === focusedPane.focusedTabId)?.target ??
      null
    );
  });
  const focusedAgent = useSessionStore((state) => {
    if (!routeSelection || focusedTarget?.kind !== "agent") {
      return null;
    }
    const session = state.sessions[routeSelection.serverId];
    return (
      session?.agents.get(focusedTarget.agentId) ??
      session?.agentDetails.get(focusedTarget.agentId) ??
      null
    );
  });

  return useMemo(
    () =>
      resolveSidebarActiveWorkspaceSelection({
        routeSelection,
        focusedTarget,
        focusedAgent,
      }),
    [focusedAgent, focusedTarget, routeSelection],
  );
}


export function useLastWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getLastWorkspaceSelection,
    getLastWorkspaceSelection,
  );
}

export function useIsLastWorkspaceSelectionHydrated(): boolean {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getIsLastWorkspaceSelectionHydrated,
    getIsLastWorkspaceSelectionHydrated,
  );
}

void hydrateLastWorkspaceSelection();
