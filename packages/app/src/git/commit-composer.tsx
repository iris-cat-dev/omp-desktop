import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Check, Sparkles } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { useSessionStore } from "@/stores/session-store";
import { isWeb } from "@/constants/platform";

interface CommitComposerProps {
  serverId: string;
  cwd: string;
  branchName: string | null;
  hasChanges: boolean;
}

export function CommitComposer({ serverId, cwd, branchName, hasChanges }: CommitComposerProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const handleInputFocus = useCallback(() => setIsInputFocused(true), []);
  const handleInputBlur = useCallback(() => setIsInputFocused(false), []);
  const client = useSessionStore((state) => state.sessions[serverId]?.client);
  const generationSupported = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.checkoutCommitMessageGeneration === true,
  );
  const runCommit = useCheckoutGitActionsStore((state) => state.commit);
  const commitStatus = useCheckoutGitActionsStore((state) =>
    state.getStatus({ serverId, cwd, actionId: "commit" }),
  );
  const trimmedMessage = message.trim();
  const isCommitting = commitStatus === "pending";
  const canCommit = hasChanges && trimmedMessage.length > 0 && !isCommitting && !isGenerating;
  const canGenerate = hasChanges && generationSupported && Boolean(client) && !isGenerating;

  const replaceMessage = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
    inputRef.current?.replaceText(nextMessage, {
      start: nextMessage.length,
      end: nextMessage.length,
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!client || !canGenerate) return;

    setIsGenerating(true);
    try {
      const generated = await client.generateCheckoutCommitMessage(cwd);
      replaceMessage(generated);
      inputRef.current?.focus();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.git.commitComposer.failedGeneration"),
      );
    } finally {
      setIsGenerating(false);
    }
  }, [canGenerate, client, cwd, replaceMessage, t, toast]);

  const handleCommit = useCallback(async () => {
    if (!canCommit) return;

    try {
      await runCommit({ serverId, cwd, message: trimmedMessage });
      replaceMessage("");
      toast.show(t("workspace.git.actions.commit.success"), { variant: "success" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.git.actions.toasts.failedCommit"),
      );
    }
  }, [canCommit, cwd, replaceMessage, runCommit, serverId, t, toast, trimmedMessage]);

  const generationLabel = isGenerating
    ? t("workspace.git.commitComposer.generating")
    : t("workspace.git.commitComposer.generate");

  return (
    <View style={styles.container} testID="changes-commit-composer">
      <View style={styles.messageRow}>
        <AdaptiveTextInput
          ref={inputRef}
          initialValue=""
          onChangeText={setMessage}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={t("workspace.git.commitComposer.placeholder", {
            branch: branchName ?? t("workspace.git.diff.branchUnknown"),
          })}
          accessibilityLabel={t("workspace.git.commitComposer.placeholder", {
            branch: branchName ?? t("workspace.git.diff.branchUnknown"),
          })}
          multiline
          submitBehavior="newline"
          textAlignVertical="top"
          style={[styles.messageInput, isInputFocused && styles.messageInputFocused]}
          testID="changes-commit-message"
        />
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              leftIcon={Sparkles}
              loading={isGenerating}
              disabled={!canGenerate}
              accessibilityLabel={generationLabel}
              onPress={handleGenerate}
              style={styles.generateButton}
              testID="changes-generate-commit-message"
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Text style={styles.tooltipText}>{generationLabel}</Text>
          </TooltipContent>
        </Tooltip>
      </View>
      <Button
        variant="default"
        size="sm"
        leftIcon={Check}
        loading={isCommitting}
        disabled={!canCommit}
        onPress={handleCommit}
        style={styles.commitButton}
        testID="changes-commit-button"
      >
        {isCommitting
          ? t("workspace.git.actions.commit.pending")
          : t("workspace.git.actions.commit.label")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  messageInput: {
    flex: 1,
    minWidth: 0,
    height: 34,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    outlineWidth: 0,
    ...(isWeb ? { scrollbarWidth: "none" as const } : {}),
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  messageInputFocused: {
    borderColor: theme.colors.borderAccent,
  },
  generateButton: {
    width: 34,
    paddingHorizontal: 0,
    flexShrink: 0,
  },
  commitButton: {
    width: "100%",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
