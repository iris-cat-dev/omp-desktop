import { useMemo } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useReplicaQuery } from "@/data/query";
import { checkoutDiffPushRoute } from "@/data/push-router";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { ParsedDiffFile, SubscribeCheckoutDiffResponse } from "@omp-desktop/protocol/messages";
import { checkoutDiffQueryKey } from "@/git/query-keys";
import type { CheckoutDiffMode } from "@/git/query-keys";

interface UseCheckoutDiffQueryOptions {
  serverId: string;
  cwd: string;
  mode: CheckoutDiffMode;
  baseRef?: string;
  ignoreWhitespace?: boolean;
  detail?: "summary" | "full";
  paths?: string[];
  enabled?: boolean;
  queryScope?: string;
}

type CheckoutDiffQueryPayload = Omit<SubscribeCheckoutDiffResponse["payload"], "subscriptionId">;

// Re-export the canonical protocol type so all consumers share one definition.
export type { ParsedDiffFile };
export type DiffHunk = ParsedDiffFile["hunks"][number];
export type DiffLine = DiffHunk["lines"][number];
export type HighlightToken = NonNullable<DiffLine["tokens"]>[number];

function normalizeCheckoutDiffCompare(compare: {
  mode: CheckoutDiffMode;
  baseRef?: string;
  ignoreWhitespace?: boolean;
  detail?: "summary" | "full";
  paths?: string[];
}): Pick<
  UseCheckoutDiffQueryOptions,
  "mode" | "baseRef" | "ignoreWhitespace" | "detail" | "paths"
> {
  const baseRef = compare.mode === "base" ? compare.baseRef?.trim() : undefined;
  return {
    mode: compare.mode,
    ...(baseRef ? { baseRef } : {}),
    ignoreWhitespace: compare.ignoreWhitespace === true,
    ...(compare.detail ? { detail: compare.detail } : {}),
    ...(compare.paths !== undefined ? { paths: [...new Set(compare.paths)].sort() } : {}),
  };
}

export function useCheckoutDiffQuery({
  serverId,
  cwd,
  mode,
  baseRef,
  ignoreWhitespace,
  detail,
  paths,
  enabled = true,
  queryScope,
}: UseCheckoutDiffQueryOptions) {
  const retainedPanelActive = useRetainedPanelActive();
  const queryEnabled = enabled && retainedPanelActive;
  const isConnected = useHostRuntimeIsConnected(serverId);
  const normalizedCompare = useMemo(
    () => normalizeCheckoutDiffCompare({ mode, baseRef, ignoreWhitespace, detail, paths }),
    [mode, baseRef, ignoreWhitespace, detail, paths],
  );
  const compareMode = normalizedCompare.mode;
  const compareBaseRef = normalizedCompare.baseRef;
  const compareIgnoreWhitespace = normalizedCompare.ignoreWhitespace;
  const queryKey = useMemo(() => {
    const comparisonKey = checkoutDiffQueryKey(
      serverId,
      cwd,
      compareMode,
      compareBaseRef,
      compareIgnoreWhitespace,
      normalizedCompare.detail,
      normalizedCompare.paths,
    );
    const normalizedScope = queryScope?.trim();
    return normalizedScope ? [...comparisonKey, "scope", normalizedScope] : comparisonKey;
  }, [
    serverId,
    cwd,
    compareMode,
    compareBaseRef,
    compareIgnoreWhitespace,
    normalizedCompare,
    queryScope,
  ]);
  const subscriptionId = useMemo(() => `checkoutDiff:${JSON.stringify(queryKey)}`, [queryKey]);
  const routeEnabled = Boolean(queryEnabled && isConnected && cwd);

  const query = useReplicaQuery<CheckoutDiffQueryPayload>({
    queryKey,
    enabled: routeEnabled,
    pushEvent: "checkout_diff_update",
    meta: checkoutDiffPushRoute({
      enabled: routeEnabled,
      serverId,
      subscriptionId,
      cwd,
      compare: normalizedCompare,
    }),
  });

  const payload = query.data ?? null;
  const payloadError = payload?.error ?? null;

  return {
    files: payload?.files ?? [],
    staging: payload?.staging,
    hasSnapshot: payload !== null,
    payloadError,
    diffTooLarge: payload?.diffTooLarge === true,
    isLoading: payload === null && queryEnabled && isConnected,
    isFetching: false,
    isError: Boolean(payloadError),
    error: null,
  };
}
