import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { Split } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface AssistantForkButtonProps {
  onFork: () => Promise<void> | void;
  testID?: string;
}

const ThemedSplit = withUnistyles(Split);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const AssistantForkButton = memo(function AssistantForkButton({
  onFork,
  testID = "assistant-fork-button",
}: AssistantForkButtonProps) {
  const { t } = useTranslation();
  const [isPending, setIsPending] = useState(false);

  const handlePress = useCallback(async () => {
    if (isPending) return;
    setIsPending(true);
    try {
      await onFork();
    } finally {
      setIsPending(false);
    }
  }, [isPending, onFork]);

  const triggerStyle = useMemo(
    () => [styles.trigger, isPending ? styles.triggerDisabled : null],
    [isPending],
  );

  const tooltipContent = useMemo(
    () => (
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("message.actions.forkInNewWorkspace")}</Text>
      </TooltipContent>
    ),
    [t],
  );

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <View style={styles.triggerSlot} collapsable={false}>
          <Pressable
            accessibilityLabel={t("message.actions.forkInNewWorkspace")}
            accessibilityRole="button"
            disabled={isPending}
            onPress={handlePress}
            style={triggerStyle}
            testID={testID}
          >
            <ThemedSplit size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
          </Pressable>
        </View>
      </TooltipTrigger>
      {tooltipContent}
    </Tooltip>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  triggerDisabled: {
    opacity: theme.opacity[50],
  },
  triggerSlot: {
    alignSelf: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));

