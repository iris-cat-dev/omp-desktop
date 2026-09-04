import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";

export function resolveSidebarWorkspacePrimaryLabel(input: {
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch">;
  workspaceTitleSource: WorkspaceTitleSource;
}): string {
  if (input.workspaceTitleSource === "branch") {
    return input.workspace.currentBranch ?? input.workspace.name;
  }
  return input.workspace.name;
}
export function resolveAgentTabPrimaryLabel(input: {
  agentTitle: string | null | undefined;
  isRootAgent: boolean;
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch"> | null;
  workspaceTitleSource: WorkspaceTitleSource;
}): string | null | undefined {
  if (input.isRootAgent && input.workspace) {
    return resolveSidebarWorkspacePrimaryLabel({
      workspace: input.workspace,
      workspaceTitleSource: input.workspaceTitleSource,
    });
  }
  return input.agentTitle;
}

export function resolveSidebarWorkspaceAccessibilityLabel(input: {
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch" | "statusBucket">;
  workspaceTitleSource: WorkspaceTitleSource;
  leadingProjectName?: string | null;
  hostBadgeLabel?: string | null;
  pullRequestLabel?: string | null;
  serviceLabel?: string | null;
}): string {
  return [
    input.leadingProjectName,
    resolveSidebarWorkspacePrimaryLabel(input),
    input.hostBadgeLabel,
    input.pullRequestLabel,
    input.serviceLabel,
    input.workspace.statusBucket === "done"
      ? null
      : STATUS_BUCKET_LABELS[input.workspace.statusBucket],
  ]
    .filter((label): label is string => Boolean(label))
    .join(", ");
}
