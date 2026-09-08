import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewDraftKey,
  buildReviewDraftScopeKey,
  useInlineReviewController,
  useResolvedDiffMode,
  useReviewAttachmentSnapshot,
  useSetDiffModeOverride,
} from "@/review";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";

interface UseWorkingDiffOptions {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  ignoreWhitespace: boolean;
  enabled: boolean;
  queryScope?: string;
  modeScope: string;
  summarySupported: boolean;
  detailsEnabled: boolean;
  focusPath?: string;
  collapsedFilePaths: string[];
}
type WorkingDiffQuery = ReturnType<typeof useCheckoutDiffQuery>;
type WorkingDiffComparison = Pick<
  Parameters<typeof useCheckoutDiffQuery>[0],
  "serverId" | "cwd" | "mode" | "baseRef" | "ignoreWhitespace" | "enabled" | "queryScope"
>;

function useLazyWorkingDiffDetails({
  comparison,
  summarySupported,
  modeScope,
  files,
  detailsEnabled,
  focusPath,
  collapsedFilePaths,
}: {
  comparison: WorkingDiffComparison;
  summarySupported: boolean;
  modeScope: string;
  files: WorkingDiffQuery["files"];
  detailsEnabled: boolean;
  focusPath?: string;
  collapsedFilePaths: string[];
}) {
  const detailPaths = useMemo(
    () =>
      focusPath !== undefined
        ? [focusPath]
        : files.filter((file) => !collapsedFilePaths.includes(file.path)).map((file) => file.path),
    [collapsedFilePaths, files, focusPath],
  );
  const detailDiff = useCheckoutDiffQuery({
    ...comparison,
    detail: "full",
    paths: detailPaths,
    enabled: summarySupported && comparison.enabled && detailsEnabled && detailPaths.length > 0,
    queryScope: `${comparison.queryScope ?? modeScope}:details`,
  });
  const fullFiles = summarySupported ? detailDiff.files : files;
  const documentFiles = useMemo(() => {
    if (!summarySupported) return files;
    const byPath = new Map(fullFiles.map((file) => [file.path, file]));
    return files.map((file) => byPath.get(file.path) ?? file);
  }, [files, fullFiles, summarySupported]);
  return { detailDiff, fullFiles, documentFiles };
}

function useWorkingDiffReview({
  comparison,
  summarySupported,
  modeScope,
  listDiff,
  detailDiff,
  fullFiles,
  detailsEnabled,
  reviewDraftKey,
  reviewActions,
  diffMode,
}: {
  comparison: WorkingDiffComparison;
  summarySupported: boolean;
  modeScope: string;
  listDiff: WorkingDiffQuery;
  detailDiff: WorkingDiffQuery;
  fullFiles: WorkingDiffQuery["files"];
  detailsEnabled: boolean;
  reviewDraftKey: string;
  reviewActions: ReturnType<typeof useInlineReviewController>;
  diffMode: "uncommitted" | "base";
}) {
  // Drafts outlive a file's expanded state. Their full hunks remain subscribed
  // independently of the document selection, including in the tree view.
  const reviewPaths = useMemo(
    () => [
      ...new Set(
        [...reviewActions.commentsByTarget.values()].flatMap((comments) =>
          comments.map((comment) => comment.filePath),
        ),
      ),
    ],
    [reviewActions.commentsByTarget],
  );
  const reviewDiff = useCheckoutDiffQuery({
    ...comparison,
    detail: "full",
    paths: reviewPaths,
    enabled: summarySupported && comparison.enabled && reviewPaths.length > 0,
    queryScope: `${comparison.queryScope ?? modeScope}:review`,
  });
  const files = listDiff.files;
  const reviewFiles = useMemo(() => {
    if (!summarySupported) return files;
    const byPath = new Map(
      (detailsEnabled && !detailDiff.payloadError && !detailDiff.diffTooLarge ? fullFiles : []).map(
        (file) => [file.path, file],
      ),
    );
    if (!reviewDiff.payloadError && !reviewDiff.diffTooLarge) {
      for (const file of reviewDiff.files) byPath.set(file.path, file);
    }
    return [...byPath.values()];
  }, [
    summarySupported,
    files,
    detailsEnabled,
    detailDiff.payloadError,
    detailDiff.diffTooLarge,
    fullFiles,
    reviewDiff.payloadError,
    reviewDiff.diffTooLarge,
    reviewDiff.files,
  ]);
  const reviewReady =
    listDiff.hasSnapshot &&
    !listDiff.isLoading &&
    !listDiff.payloadError &&
    !listDiff.diffTooLarge &&
    (!summarySupported ||
      reviewPaths.every(
        (path) =>
          !files.some((file) => file.path === path) ||
          reviewFiles.some((file) => file.path === path && file.status !== "too_large"),
      ));
  const reviewAttachment = useReviewAttachmentSnapshot({
    key: reviewDraftKey,
    diffFiles: reviewReady ? reviewFiles : [],
    cwd: comparison.cwd,
    mode: diffMode,
    baseRef: comparison.baseRef,
  });
  return { reviewDiff, reviewReady, reviewAttachment };
}

export function useWorkingDiff({
  serverId,
  workspaceId,
  cwd,
  ignoreWhitespace,
  enabled,
  queryScope,
  modeScope,
  summarySupported,
  detailsEnabled,
  focusPath,
  collapsedFilePaths,
}: UseWorkingDiffOptions) {
  const {
    status,
    isLoading: isStatusLoading,
    isError: isStatusError,
    error: statusError,
  } = useCheckoutStatusQuery({ serverId, cwd });
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const statusErrorMessage =
    status?.error?.message ??
    (isStatusError && statusError instanceof Error ? statusError.message : null);
  const baseRef = gitStatus?.baseRef ?? undefined;
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const currentBranchName =
    gitStatus?.currentBranch && gitStatus.currentBranch !== "HEAD" ? gitStatus.currentBranch : null;

  const reviewDraftScopeKey = useMemo(
    () =>
      buildReviewDraftScopeKey({
        serverId,
        workspaceId,
        cwd,
        baseRef,
        ignoreWhitespace,
      }),
    [baseRef, cwd, ignoreWhitespace, serverId, workspaceId],
  );
  const modeScopeKey = `${reviewDraftScopeKey}:surface=${encodeURIComponent(modeScope)}`;
  const diffMode = useResolvedDiffMode({
    scopeKey: modeScopeKey,
    hasUncommittedChanges,
  });
  const setDiffModeOverride = useSetDiffModeOverride();
  const selectDiffMode = useCallback(
    (nextMode: "uncommitted" | "base") => {
      setDiffModeOverride({
        scopeKey: modeScopeKey,
        override: {
          serverId,
          cwd,
          mode: nextMode,
          isDirtyAtSelection: hasUncommittedChanges,
        },
      });
    },
    [cwd, hasUncommittedChanges, modeScopeKey, serverId, setDiffModeOverride],
  );
  const selectUncommitted = useCallback(() => selectDiffMode("uncommitted"), [selectDiffMode]);
  const selectBase = useCallback(() => selectDiffMode("base"), [selectDiffMode]);

  const comparison: WorkingDiffComparison = {
    serverId,
    cwd,
    mode: diffMode,
    baseRef,
    ignoreWhitespace,
    enabled: enabled && isGit,
    queryScope,
  };
  const listDiff = useCheckoutDiffQuery({
    ...comparison,
    detail: summarySupported ? "summary" : undefined,
  });
  const {
    files,
    staging,
    payloadError: diffPayloadError,
    diffTooLarge,
    isLoading: isDiffLoading,
  } = listDiff;
  const reviewDraftKey = useMemo(
    () =>
      buildReviewDraftKey({
        serverId,
        workspaceId,
        cwd,
        mode: diffMode,
        baseRef,
        ignoreWhitespace,
      }),
    [baseRef, cwd, diffMode, ignoreWhitespace, serverId, workspaceId],
  );
  const reviewActions = useInlineReviewController({ reviewDraftKey });
  const { detailDiff, fullFiles, documentFiles } = useLazyWorkingDiffDetails({
    comparison,
    summarySupported,
    modeScope,
    files,
    detailsEnabled,
    focusPath,
    collapsedFilePaths,
  });
  const { reviewDiff, reviewReady, reviewAttachment } = useWorkingDiffReview({
    comparison,
    summarySupported,
    modeScope,
    listDiff,
    detailDiff,
    fullFiles,
    detailsEnabled,
    reviewDraftKey,
    reviewActions,
    diffMode,
  });

  return {
    status,
    isStatusLoading,
    isGit,
    notGit,
    statusErrorMessage,
    baseRef,
    currentBranchName,
    diffMode,
    selectUncommitted,
    selectBase,
    files,
    staging,
    documentFiles,
    detailDiff,
    fullFiles,
    reviewDiff,
    reviewReady,
    diffPayloadError,
    diffTooLarge,
    isDiffLoading,
    reviewActions,
    reviewAttachment,
  };
}

export function usePublishWorkingDiffAttachment({
  serverId,
  workspaceId,
  cwd,
  attachment,
  enabled,
  ready,
}: {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  attachment: ReturnType<typeof useWorkingDiff>["reviewAttachment"];
  enabled: boolean;
  ready: boolean;
}) {
  const scopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd }),
    [cwd, serverId, workspaceId],
  );
  const setWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.setWorkspaceAttachments,
  );
  const clearWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.clearWorkspaceAttachments,
  );

  const publishedRef = useRef<{
    scopeKey: string;
    attachments: NonNullable<typeof attachment>[];
  } | null>(null);

  // Only release our last publication when its owner leaves the scope. A pending
  // detail request must not clear a complete snapshot (ours or another panel's).
  useEffect(
    () => () => {
      const published = publishedRef.current;
      if (!published || published.scopeKey !== scopeKey) return;
      const current = useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey];
      if (current === published.attachments) clearWorkspaceAttachments({ scopeKey });
      publishedRef.current = null;
    },
    [clearWorkspaceAttachments, scopeKey],
  );

  useEffect(() => {
    if (!enabled || !ready) return;
    const attachments = attachment ? [attachment] : [];
    setWorkspaceAttachments({ scopeKey, attachments });
    if (useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey] === attachments) {
      publishedRef.current = { scopeKey, attachments };
    }
  }, [attachment, enabled, ready, scopeKey, setWorkspaceAttachments]);
}
