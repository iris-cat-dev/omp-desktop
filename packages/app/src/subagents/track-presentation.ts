import type { TFunction } from "i18next";
import type { ComposerTrackPillSegment } from "@/composer/tracks";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { deriveSidebarStateBucket, STATUS_BUCKET_ORDER } from "@/utils/sidebar-agent-state";
import type { SubagentRow } from "./select";
import { isFinishedSubagent } from "./archive-finished";
import { providerSubagentLifecycleStatus } from "./provider-store";

function presentationStatus(row: SubagentRow) {
  if (row.kind === "paseo") return row.status;
  return providerSubagentLifecycleStatus(row.status);
}

export interface SubagentRowPresentationData {
  key: string;
  kind: "agent";
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  statusBucket: SidebarStateBucket | null;
}

export function buildSubagentRowPresentationData(row: SubagentRow): SubagentRowPresentationData {
  // The task distinguishes siblings in a fan-out; provider context stays secondary.
  const description = resolveRowLabel(row.description);
  const title = resolveRowLabel(row.title);
  const label = description ?? title;
  const providerSubtitle = row.kind === "provider" ? resolveRowLabel(row.subtitle) : null;
  const subtitle = providerSubtitle ?? (description ? title : null);
  const status = presentationStatus(row);
  return {
    key: `${row.kind}_subagent_${row.id}`,
    kind: "agent",
    label: label ?? "",
    subtitle: subtitle ?? "",
    titleState: label ? "ready" : "loading",
    statusBucket: deriveSidebarStateBucket({
      status,
      requiresAttention: false,
    }),
  };
}

/** The reported model is explicit even when a provider has not supplied one yet. */
export function buildSubagentMetadata(
  t: TFunction,
  model: string | null | undefined,
  subtitle: string | null | undefined,
): string {
  const reportedModel = model?.trim() || null;
  const modelLabel = t("subagents.modelLabel", {
    model: reportedModel ?? t("subagents.modelUnknown"),
  });
  // Remove only exact model segments, never model-like words in provider-owned context.
  const context = subtitle
    ?.split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && part !== reportedModel && part !== modelLabel)
    .join(" · ");
  return context ? `${modelLabel} · ${context}` : modelLabel;
}

/** One state the pill reports, and how many children are in it. */
interface SubagentStatusCount {
  bucket: SidebarStateBucket;
  count: number;
}

/** Everything the pill draws. Built together so no mark can end up next to another one's count. */
export interface SubagentPillPresentation {
  segments: ComposerTrackPillSegment[];
  accessibilityLabel: string;
}

/**
 * What the pill says about a fan-out, and which marks it says it with.
 *
 * A mark and a number sitting together answer the same question, so the pill cannot collapse a
 * mixed fan-out into the most urgent state the way a sidebar project row does: a red dot beside
 * "1 failed" over a child that is still working says the fan-out has stopped. Every state present
 * gets its own mark and its own count, in the order the sidebar's status groups list them.
 */
export function buildSubagentPillPresentation(
  t: TFunction,
  rows: readonly SubagentRow[],
): SubagentPillPresentation {
  const counts = summarizeSubagentStatus(rows);
  if (counts.length === 0) {
    const label = totalLabel(t, rows.length);
    return { segments: [{ bucket: null, text: label }], accessibilityLabel: label };
  }
  const labels = counts.map(({ bucket, count }) => statusLabel(t, bucket, count));
  return {
    segments: counts.map(({ bucket }, index) => ({ bucket, text: labels[index] ?? "" })),
    // Marks separate the segments on screen; a screen reader needs the pause spelled out.
    accessibilityLabel: labels.join(", "),
  };
}

/** Wording comes from the sidebar's status groups — one name per state across the whole app. */
function statusLabel(t: TFunction, bucket: SidebarStateBucket, count: number): string {
  switch (bucket) {
    case "running":
      return t("subagents.pillLabelWorking", { count });
    case "failed":
      return t("subagents.pillLabelFailed", { count });
    case "needs_input":
      return count === 1
        ? t("subagents.pillLabelNeedsInputOne")
        : t("subagents.pillLabelNeedsInputMany", { count });
    case "attention":
      return t("subagents.pillLabelReadyToReview", { count });
    case "done":
      return t("subagents.pillLabelCompleted", { count });
  }
}

/** Nothing is happening, so the pill is back to naming what it opens. */
function totalLabel(t: TFunction, total: number): string {
  return total === 1 ? t("subagents.pillLabelOne") : t("subagents.pillLabelMany", { count: total });
}

function summarizeSubagentStatus(rows: readonly SubagentRow[]): SubagentStatusCount[] {
  const buckets = rows.map((row) => buildSubagentRowPresentationData(row).statusBucket);
  return STATUS_BUCKET_ORDER.flatMap((bucket) => {
    const count = buckets.filter((candidate) => candidate === bucket).length;
    return count > 0 ? [{ bucket, count }] : [];
  });
}

export function countFinishedSubagents(rows: readonly SubagentRow[]): number {
  return rows.filter(isFinishedSubagent).length;
}

export function resolveRowLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}
