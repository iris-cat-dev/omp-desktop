import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import {
  captureWorkspaceTabCleanup,
  closeWorkspaceAgentTabs,
  type WorkspaceTabCleanupSnapshot,
} from "@/workspace/workspace-tab-cleanup";

export interface DeleteWorkspaceInput {
  serverId: string;
  workspaceId: string;
}

type DeleteWorkspaceClient = Pick<DaemonClient, "deleteWorkspace">;

function removeAgentIds<T>(current: Map<string, T>, agentIds: ReadonlySet<string>): Map<string, T> {
  let next: Map<string, T> | null = null;
  for (const agentId of agentIds) {
    if (!current.has(agentId)) {
      continue;
    }
    next ??= new Map(current);
    next.delete(agentId);
  }
  return next ?? current;
}

function removeDeletedWorkspaceAgents(snapshot: WorkspaceTabCleanupSnapshot): void {
  const store = useSessionStore.getState();
  store.setAgents(snapshot.serverId, (current) => removeAgentIds(current, snapshot.agentIds));
  store.setAgentDetails(snapshot.serverId, (current) => removeAgentIds(current, snapshot.agentIds));
}

export async function deleteWorkspaceWithCleanup(
  client: DeleteWorkspaceClient,
  input: DeleteWorkspaceInput,
): Promise<void> {
  const tabCleanup = captureWorkspaceTabCleanup(input);
  const result = await client.deleteWorkspace(input.workspaceId);
  if (result.error) {
    throw new Error(result.error);
  }

  closeWorkspaceAgentTabs(tabCleanup);
  removeDeletedWorkspaceAgents(tabCleanup);
}
