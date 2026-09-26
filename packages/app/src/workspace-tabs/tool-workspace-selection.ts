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
 * route. Tools follow the focused conversation or draft and keep that scope while a
 * tool has pane focus. Legacy drafts and new tabs belong to the route workspace, as
 * does the initial scope after a route change.
 */
export function resolveWorkspaceToolSelection(input: {
  current: WorkspaceToolSelection | null;
  routeSelection: ActiveWorkspaceSelection | null;
  focusedTarget: WorkspaceTabTarget | null;
  focusedAgentWorkspaceId: string | null;
}): WorkspaceToolSelection | null {
  const routeSelection = input.routeSelection;
  if (!routeSelection) {
    return null;
  }

  const focusedDraftWorkspaceId =
    input.focusedTarget?.kind === "draft" ? input.focusedTarget.workspaceId?.trim() || null : null;
  const focusedWorkspaceId = input.focusedAgentWorkspaceId?.trim() || focusedDraftWorkspaceId;
  let activeSelection = routeSelection;
  if (focusedWorkspaceId) {
    activeSelection = { serverId: routeSelection.serverId, workspaceId: focusedWorkspaceId };
  } else if (
    input.focusedTarget?.kind !== "draft" &&
    input.focusedTarget?.kind !== "new_tab" &&
    input.current &&
    selectionsEqual(input.current.routeSelection, routeSelection)
  ) {
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
  if (input.target.kind === "draft") {
    return input.target.workspaceId?.trim() || input.routeWorkspaceId;
  }
  return isWorkspaceToolTarget(input.target) ? input.toolWorkspaceId : input.routeWorkspaceId;
}
