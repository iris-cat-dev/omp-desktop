import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
} from "@/workspace/file-open";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import {
  FOCUSED_PANE_PLACEMENT,
  type WorkspaceTabPlacement,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

interface OpenWorkspaceFileFromExplorerInput {
  location: WorkspaceFileLocation;
  persistenceKey: string | null;
  showMobileAgent: () => void;
  openWorkspaceTabInFocusedPane: (
    workspaceKey: string,
    target: WorkspaceTabTarget,
    placement?: WorkspaceTabPlacement,
  ) => string | null;
  focusWorkspaceTab: (workspaceKey: string, tabId: string) => void;
}

export function openWorkspaceFileFromExplorer(input: OpenWorkspaceFileFromExplorerInput): void {
  input.showMobileAgent();
  if (!input.persistenceKey) {
    return;
  }
  const location = normalizeWorkspaceFileLocation(input.location);
  if (!location) {
    return;
  }
  const tabId = input.openWorkspaceTabInFocusedPane(
    input.persistenceKey,
    createWorkspaceFileTabTarget(location),
    FOCUSED_PANE_PLACEMENT,
  );
  if (tabId) {
    input.focusWorkspaceTab(input.persistenceKey, tabId);
  }
}
