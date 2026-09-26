import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export function resolveClosedTabWorkspaceArchives(input: {
  routeWorkspaceId: string;
  closingTarget: WorkspaceTabTarget | null | undefined;
  routeWorkspaceEmpty: boolean;
}): string[] {
  const draftWorkspaceId =
    input.closingTarget?.kind === "draft" ? input.closingTarget.workspaceId?.trim() : undefined;
  const archiveWorkspaceIds: string[] = [];
  if (draftWorkspaceId && draftWorkspaceId !== input.routeWorkspaceId) {
    archiveWorkspaceIds.push(draftWorkspaceId);
  }
  if (input.routeWorkspaceEmpty) {
    archiveWorkspaceIds.push(input.routeWorkspaceId);
  }
  return archiveWorkspaceIds;
}
