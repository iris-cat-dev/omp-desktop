import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import type { AgentAttachment } from "@omp-desktop/protocol/messages";
import type { RewindMode } from "./use-rewind-capabilities";
import type { UserMessageImageAttachment } from "@/types/stream";
import { useRewindComposerRestore } from "./composer-restore";
import { useSessionStore } from "@/stores/session-store";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

interface UseRewindAgentMutationInput {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  client?: DaemonClient | null;
}

interface RewindAgentInput {
  mode: RewindMode;
  rewoundText: string;
  rewoundImages: readonly UserMessageImageAttachment[];
  rewoundAttachments: readonly AgentAttachment[];
}

export function useRewindAgentMutation(input: UseRewindAgentMutationInput): {
  rewindAgent: (input: RewindAgentInput) => Promise<void>;
  isPending: boolean;
} {
  const toast = useToast();
  const { t } = useTranslation();
  const composerRestore = useRewindComposerRestore();
  const { isPending, mutateAsync } = useMutation({
    mutationFn: async ({
      mode,
      rewoundText,
      rewoundImages,
      rewoundAttachments,
    }: RewindAgentInput) => {
      if (!input.client || !input.agentId || !input.messageId) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      await input.client.rewindAgent(input.agentId, input.messageId, mode);

      if (shouldRestoreComposerForRewindMode(mode)) {
        composerRestore?.restoreIfComposerEmpty({
          text: rewoundText,
          images: rewoundImages,
          attachments: rewoundAttachments,
        });
      }

      if (mode !== "files") {
        const cursor = input.serverId
          ? useSessionStore
              .getState()
              .sessions[input.serverId]?.agentTimelineCursor.get(input.agentId)
          : undefined;
        if (!input.serverId) throw new Error(t("common.errors.daemonClientUnavailable"));
        await getHostRuntimeStore().fetchAgentTimeline(input.serverId, input.agentId, {
          direction: "tail",
          projection: "projected",
          ...(cursor ? { cursor: { epoch: cursor.epoch, seq: cursor.endSeq } } : {}),
        });
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("rewind.errors.failed"));
    },
  });

  const rewindAgent = useCallback(
    async (rewindInput: RewindAgentInput) => {
      if (isPending) {
        return;
      }
      await mutateAsync(rewindInput);
    },
    [isPending, mutateAsync],
  );

  return {
    rewindAgent,
    isPending,
  };
}
