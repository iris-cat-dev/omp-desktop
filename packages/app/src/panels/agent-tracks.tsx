import { memo, useCallback, type ReactElement } from "react";
import { WorkspaceBranchPill } from "@/composer/branch-pill";
import { useWorkspaceHasBranch } from "@/composer/workspace-branch";
import { WorkspaceDiffStatPill } from "@/composer/diff-stat-pill";
import { useWorkspaceHasDiffStat } from "@/composer/workspace-diff-stat";
import { ComposerTrackBar } from "@/composer/tracks";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import {
  type ArchiveFinishedStatus,
  useArchiveSubagent,
  useDetachSubagent,
  type SubagentRow,
} from "@/subagents";
import { SubagentsTrack } from "@/subagents/track";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { toggleSupportingTab } from "@/workspace-tabs/side-panel";

/**
 * The pane's ambient workspace changes and subagents as a row of pills above the composer.
 *
 * The row shares the composer's keyboard transform and owns the space between itself and the
 * transcript. Each pill owns its action while tab placement stays behind the workspace boundary.
 */
export const AgentTracks = memo(function AgentTracks({
  serverId,
  workspaceId,
  cwd,
  subagentRows,
  archiveFinishedStatus,
  onArchiveFinished,
}: {
  serverId: string;
  workspaceId: string;
  cwd: string;
  subagentRows: SubagentRow[];
  archiveFinishedStatus: ArchiveFinishedStatus;
  onArchiveFinished: () => void;
}): ReactElement | null {
  const { openTab } = usePaneContext();
  const hasWorkspaceDiffStat = useWorkspaceHasDiffStat(serverId, workspaceId);
  const hasWorkspaceBranch = useWorkspaceHasBranch(serverId, workspaceId);
  const isCompact = useIsCompactFormFactor();
  const canSplit = supportsDesktopPaneSplits() && !isCompact;
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const canDetachSubagents = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentDetach === true,
  );
  const archiveSubagent = useArchiveSubagent({ serverId });
  const detachSubagent = useDetachSubagent({ serverId });
  // Sidebar navigation may host an agent tab in a different workspace.
  // Open child tabs through that pane so they stay with their parent.
  const handleOpenSubagent = useCallback(
    (subagentId: string) => {
      const session = useSessionStore.getState().sessions[serverId];
      const agent = session?.agents.get(subagentId) ?? session?.agentDetails.get(subagentId);
      if (agent?.workspaceId && agent.workspaceId !== workspaceId) {
        navigateToAgent({ serverId, agentId: subagentId });
        return;
      }
      if (canSplit) {
        openTab({ kind: "agent", agentId: subagentId });
        return;
      }
      navigateToAgent({ serverId, agentId: subagentId });
    },
    [canSplit, openTab, serverId, workspaceId],
  );
  const handleOpenProviderSubagent = useCallback(
    (parentAgentId: string, subagentId: string) => {
      openTab({ kind: "provider_subagent", parentAgentId, subagentId });
    },
    [openTab],
  );
  const handleOpenChanges = useCallback(() => {
    if (!workspaceKey) {
      return;
    }
    toggleSupportingTab({
      isCompact,
      workspaceKey,
      checkout: { serverId, cwd, isGit: true },
      target: { kind: "working_diff" },
    });
  }, [cwd, isCompact, serverId, workspaceKey]);

  if (
    !hasWorkspaceDiffStat &&
    !hasWorkspaceBranch &&
    !hasAgentTracks({ subagentRows, archiveFinishedStatus })
  ) {
    return null;
  }

  return (
    <ComposerTrackBar>
      <SubagentsTrack
        rows={subagentRows}
        onOpenSubagent={handleOpenSubagent}
        onOpenProviderSubagent={handleOpenProviderSubagent}
        onArchiveSubagent={archiveSubagent}
        onArchiveFinished={onArchiveFinished}
        archiveFinishedStatus={archiveFinishedStatus}
        onDetachSubagent={canDetachSubagents ? detachSubagent : undefined}
      />
      <WorkspaceDiffStatPill
        serverId={serverId}
        workspaceId={workspaceId}
        onPress={handleOpenChanges}
      />
      <WorkspaceBranchPill serverId={serverId} workspaceId={workspaceId} />
    </ComposerTrackBar>
  );
});

export function hasAgentTracks({
  subagentRows,
  archiveFinishedStatus,
}: {
  subagentRows: readonly SubagentRow[];
  archiveFinishedStatus: ArchiveFinishedStatus;
}): boolean {
  return subagentRows.length > 0 || archiveFinishedStatus.kind !== "idle";
}
