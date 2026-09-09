import type { AgentUsage } from "@omp-desktop/protocol/agent-types";

export interface TurnTokenStats {
  totalTokens: number;
  avgTokensPerSecond: number | null;
}

function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

/**
 * Compact token count for the turn footer: 950 -> "950", 4600 -> "4.6k",
 * 1250000 -> "1.3M".
 */
export function formatTokenCount(count: number): string {
  const rounded = Math.max(0, Math.round(count));
  if (rounded >= 1_000_000) {
    return trimTrailingZero((rounded / 1_000_000).toFixed(1)) + "M";
  }
  if (rounded >= 1_000) {
    return trimTrailingZero((rounded / 1_000).toFixed(1)) + "k";
  }
  return String(rounded);
}

/**
 * Derives the completed-turn token display from the usage reported by
 * `turn_completed` (surfaced via the agent's per-turn usage map). The total
 * counts input + output tokens as reported by the provider; the average speed
 * divides output tokens by the turn duration ("Worked for"), which includes
 * tool-call time, so it reads as a per-turn average rather than a pure
 * generation rate.
 */
export function deriveTurnTokenStats(
  usage: AgentUsage | null | undefined,
  durationMs: number | undefined,
): TurnTokenStats | null {
  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  const hasInput =
    typeof inputTokens === "number" && Number.isFinite(inputTokens) && inputTokens > 0;
  const hasOutput =
    typeof outputTokens === "number" && Number.isFinite(outputTokens) && outputTokens > 0;
  if (!hasInput && !hasOutput) {
    return null;
  }
  const totalTokens =
    (hasInput ? (inputTokens as number) : 0) + (hasOutput ? (outputTokens as number) : 0);
  let avgTokensPerSecond: number | null = null;
  if (hasOutput && typeof durationMs === "number" && durationMs > 0) {
    avgTokensPerSecond = ((outputTokens as number) * 1_000) / durationMs;
  }
  return { totalTokens, avgTokensPerSecond };
}
