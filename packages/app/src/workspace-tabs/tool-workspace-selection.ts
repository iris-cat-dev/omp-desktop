import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface WorkspaceToolSelection {
  routeSelection: ActiveWorkspaceSelection;
  activeSelection: ActiveWorkspaceSelection;
}

function selectionsEqual(left: ActiveWorkspaceSelection, right: ActiveWorkspaceSelection): boolean {
  return left.serverId === right.serverId && left.workspaceId === right.workspaceId;
}

/**
 * Workspace tabs can host conversations from another workspace without changing the
 * route. Tools follow the focused conversation and keep that scope while a tool has
 * pane focus; a real route change resets the scope to the new route workspace.
 */
export function resolveWorkspaceToolSelection(input: {
  current: WorkspaceToolSelection | null;
  routeSelection: ActiveWorkspaceSelection | null;
  focusedAgentWorkspaceId: string | null;
}): WorkspaceToolSelection | null {
  const routeSelection = input.routeSelection;
  if (!routeSelection) {
    return null;
  }

  const focusedWorkspaceId = input.focusedAgentWorkspaceId?.trim() || null;
  let activeSelection = routeSelection;
  if (focusedWorkspaceId) {
    activeSelection = { serverId: routeSelection.serverId, workspaceId: focusedWorkspaceId };
  } else if (input.current && selectionsEqual(input.current.routeSelection, routeSelection)) {
    activeSelection = input.current.activeSelection;
  }

  if (
    input.current &&
    selectionsEqual(input.current.routeSelection, routeSelection) &&
    selectionsEqual(input.current.activeSelection, activeSelection)
  ) {
    return input.current;
  }
  return { routeSelection, activeSelection };
}

/** Panels whose filesystem or runtime data belongs to the active conversation workspace. */
export function isWorkspaceToolTarget(target: WorkspaceTabTarget): boolean {
  switch (target.kind) {
    case "terminal":
    case "files":
    case "file":
    case "working_diff":
    case "commit_diff":
    case "pull_request":
      return true;
    default:
      return false;
  }
}

export function resolveWorkspaceTabWorkspaceId(input: {
  target: WorkspaceTabTarget;
  routeWorkspaceId: string;
  toolWorkspaceId: string;
}): string {
  return isWorkspaceToolTarget(input.target) ? input.toolWorkspaceId : input.routeWorkspaceId;
}
