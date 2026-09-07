import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export interface WorkspaceTabCleanupSnapshot {
  serverId: string;
  agentIds: ReadonlySet<string>;
}

export function captureWorkspaceTabCleanup(input: {
  serverId: string;
  workspaceId: string;
}): WorkspaceTabCleanupSnapshot {
  const serverId = input.serverId.trim();
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  const agentIds = new Set<string>();

  if (serverId && workspaceId) {
    const session = useSessionStore.getState().sessions[serverId];
    for (const agents of [session?.agentDetails.values(), session?.agents.values()]) {
      if (!agents) {
        continue;
      }
      for (const agent of agents) {
        if (normalizeWorkspaceOpaqueId(agent.workspaceId) === workspaceId) {
          agentIds.add(agent.id);
        }
      }
    }
  }

  return { serverId, agentIds };
}

export function closeWorkspaceAgentTabs(snapshot: WorkspaceTabCleanupSnapshot): void {
  if (!snapshot.serverId || snapshot.agentIds.size === 0) {
    return;
  }

  const layoutStore = useWorkspaceLayoutStore.getState();
  const workspaceKeyPrefix = `${snapshot.serverId}:`;
  for (const [workspaceKey, layout] of Object.entries(layoutStore.layoutByWorkspace)) {
    if (!workspaceKey.startsWith(workspaceKeyPrefix)) {
      continue;
    }

    for (const tab of collectAllTabs(layout.root)) {
      let ownerAgentId: string | null = null;
      if (tab.target.kind === "agent") {
        ownerAgentId = tab.target.agentId;
      } else if (tab.target.kind === "provider_subagent") {
        ownerAgentId = tab.target.parentAgentId;
      }
      if (ownerAgentId && snapshot.agentIds.has(ownerAgentId)) {
        layoutStore.closeTab(workspaceKey, tab.tabId);
      }
    }

    for (const agentId of snapshot.agentIds) {
      layoutStore.unpinAgent(workspaceKey, agentId);
    }
  }
}
