import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import type { Agent } from "@/stores/session-store";

export interface QuickAskSource {
  provider: Agent["provider"];
  cwd: string;
  currentModeId?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  features?: Agent["features"];
}

export async function runQuickAsk(input: {
  client: DaemonClient;
  source: QuickAskSource;
  selectedText: string;
  question: string;
}): Promise<string> {
  const featureValues = input.source.features?.length
    ? Object.fromEntries(input.source.features.map((feature) => [feature.id, feature.value]))
    : undefined;
  return input.client.quickAsk({
    config: {
      provider: input.source.provider,
      cwd: input.source.cwd,
      ...(input.source.currentModeId ? { modeId: input.source.currentModeId } : {}),
      ...(input.source.model ? { model: input.source.model } : {}),
      ...(input.source.thinkingOptionId ? { thinkingOptionId: input.source.thinkingOptionId } : {}),
      ...(featureValues ? { featureValues } : {}),
    },
    selectedText: input.selectedText,
    question: input.question,
  });
}
