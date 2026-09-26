import { useCallback } from "react";
import { router } from "expo-router";
import { useToast } from "@/contexts/toast-context";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useHosts } from "@/runtime/host-runtime";
import {
  getLastWorkspaceSelection,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { openProjectWorkspaceDraft } from "@/utils/open-project-workspace-draft";
import { toErrorMessage } from "@/utils/error-messages";

const WORKSPACE_NEW_ACTIONS: readonly KeyboardActionId[] = ["workspace.new"];

export function useGlobalNewWorkspaceAction() {
  const selection = useActiveWorkspaceSelection();
  const hosts = useHosts();
  const toast = useToast();

  const handle = useCallback(() => {
    if (hosts.length === 0) return false;
    const sessions = useSessionStore.getState().sessions;
    const preferred = selection ?? getLastWorkspaceSelection();
    const preferredWorkspace =
      preferred && sessions[preferred.serverId]?.workspaces.get(preferred.workspaceId);
    const workspaceSelection =
      preferredWorkspace && !preferredWorkspace.archivingAt
        ? preferred
        : hosts.flatMap((host) =>
            Array.from(sessions[host.serverId]?.workspaces.values() ?? [])
              .filter((workspace) => !workspace.archivingAt)
              .map((workspace) => ({ serverId: host.serverId, workspaceId: workspace.id })),
          )[0];
    const workspace =
      workspaceSelection &&
      sessions[workspaceSelection.serverId]?.workspaces.get(workspaceSelection.workspaceId);
    const project =
      workspace && workspaceSelection
        ? {
            serverId: workspaceSelection.serverId,
            projectId: workspace.projectId,
            projectRootPath: workspace.projectRootPath,
          }
        : hosts.flatMap((host) =>
            Array.from(sessions[host.serverId]?.projects.values() ?? []).map((candidate) => ({
              serverId: host.serverId,
              ...candidate,
            })),
          )[0];
    if (project) {
      void openProjectWorkspaceDraft({
        serverId: project.serverId,
        projectId: project.projectId,
        projectRootPath: project.projectRootPath,
        tabHost: selection,
      }).catch((error: unknown) => toast.error(toErrorMessage(error)));
    } else {
      router.navigate(buildOpenProjectRoute());
    }
    return true;
  }, [hosts, selection, toast]);

  useKeyboardActionHandler({
    handlerId: "workspace-new-global",
    actions: WORKSPACE_NEW_ACTIONS,
    enabled: hosts.length > 0,
    priority: 0,
    handle,
  });
}
