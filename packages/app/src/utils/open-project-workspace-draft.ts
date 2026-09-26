import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { generateDraftId } from "@/stores/draft-keys";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { remapDraftCwdToWorkspace } from "@/utils/remap-draft-cwd-to-workspace";

export async function openProjectWorkspaceDraft(input: {
  serverId: string;
  projectId: string;
  projectRootPath: string;
  draftId?: string;
  tabHost?: ActiveWorkspaceSelection | null;
  setup?: WorkspaceDraftTabSetup;
  sourceDirectory?: string;
}): Promise<void> {
  const { serverId, projectId, projectRootPath } = input;
  if (!serverId.trim() || !projectId.trim() || !projectRootPath.trim()) {
    throw new Error("A host and project are required to open an agent draft");
  }

  const session = useSessionStore.getState().sessions[serverId];
  if (!session?.client) throw new Error("Host is unavailable");
  const tabHostWorkspace =
    input.tabHost?.serverId === serverId
      ? session.workspaces.get(input.tabHost.workspaceId)
      : undefined;
  const payload = await session.client.createWorkspace({
    source: { kind: "directory", path: projectRootPath, projectId },
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? "Unable to create workspace");
  }
  const workspace = normalizeWorkspaceDescriptor(payload.workspace);
  useSessionStore.getState().mergeWorkspaces(serverId, [workspace]);
  const setup = input.setup
    ? {
        ...input.setup,
        cwd: remapDraftCwdToWorkspace({
          cwd: input.setup.cwd,
          sourceDirectory: input.sourceDirectory,
          workspaceDirectory: workspace.workspaceDirectory,
        }),
      }
    : undefined;
  const tabHostWorkspaceId =
    tabHostWorkspace && !tabHostWorkspace.archivingAt ? tabHostWorkspace.id : workspace.id;
  navigateToWorkspace({
    serverId,
    workspaceId: tabHostWorkspaceId,
    target: {
      kind: "draft",
      draftId: input.draftId?.trim() || generateDraftId(),
      workspaceId: workspace.id,
      ...(setup ? { setup } : {}),
    },
  });
}
