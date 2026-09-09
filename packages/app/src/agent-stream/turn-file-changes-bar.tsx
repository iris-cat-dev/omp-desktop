import React, { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { STREAM_METADATA_FONT_SIZE } from "@/components/message";
import { type StreamItem } from "@/types/stream";
import {
  collectTurnFileChangesForBar,
  type TurnFileChange,
  type TurnFileChangeKind,
} from "./turn-file-changes";
import { confirmDialog } from "@/utils/confirm-dialog";

/**
 * Chip row shown above the completed-turn footer listing the files this turn
 * added (green), modified (blue) or deleted (red). Clicking an added/modified
 * chip opens the file; clicking a deleted chip asks for confirmation and then
 * restores it via the provided handler.
 */
export const TurnFileChangesBar = memo(function TurnFileChangesBar({
  items,
  startIndex,
  rawItems,
  onOpenFile,
  onRestoreFile,
}: {
  items: readonly StreamItem[];
  startIndex: number;
  /** Un-grouped items to scan; falls back to `items` when absent. */
  rawItems?: readonly StreamItem[] | null;
  onOpenFile?: (path: string) => void;
  onRestoreFile?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const changes = useMemo(
    () => collectTurnFileChangesForBar(items, startIndex, rawItems),
    [items, startIndex, rawItems],
  );
  const handlePress = useCallback(
    async (change: TurnFileChange) => {
      if (change.kind !== "deleted") {
        onOpenFile?.(change.path);
        return;
      }
      const fileName = change.path.split("/").findLast(Boolean) ?? change.path;
      const confirmed = await confirmDialog({
        title: t("agentStream.turnFileChanges.restoreTitle"),
        message: t("agentStream.turnFileChanges.restoreMessage", { name: fileName }),
        confirmLabel: t("agentStream.turnFileChanges.restoreConfirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (confirmed) {
        onRestoreFile?.(change.path);
      }
    },
    [onOpenFile, onRestoreFile, t],
  );
  return (
    <View style={stylesheet.bar} testID="turn-file-changes">
      {changes.map((change) => (
        <TurnFileChangeChip
          key={change.path}
          change={change}
          label={t(accessibilityLabelKey(change.kind), { name: change.path })}
          onPress={handlePress}
        />
      ))}
    </View>
  );
});

const TurnFileChangeChip = memo(function TurnFileChangeChip({
  change,
  label,
  onPress,
}: {
  change: TurnFileChange;
  label: string;
  onPress: (change: TurnFileChange) => void;
}) {
  const handlePress = useCallback(() => {
    void onPress(change);
  }, [onPress, change]);
  const fileName = change.path.split("/").findLast(Boolean) ?? change.path;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={"turn-file-change-" + change.kind}
    >
      <View style={stylesheet.chip}>
        <Text style={[stylesheet.chipText, chipTextStyle(change.kind)]}>{fileName}</Text>
      </View>
    </Pressable>
  );
});

function chipTextStyle(kind: TurnFileChangeKind) {
  switch (kind) {
    case "added":
      return stylesheet.textAdded;
    case "deleted":
      return stylesheet.textDeleted;
    default:
      return stylesheet.textModified;
  }
}

function accessibilityLabelKey(kind: TurnFileChangeKind): string {
  switch (kind) {
    case "added":
      return "agentStream.turnFileChanges.added";
    case "deleted":
      return "agentStream.turnFileChanges.deleted";
    default:
      return "agentStream.turnFileChanges.modified";
  }
}

const stylesheet = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1.5],
    marginBottom: theme.spacing[1] + 2,
    alignSelf: "flex-start",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
  },
  chipText: {
    fontSize: STREAM_METADATA_FONT_SIZE,
    fontVariant: ["tabular-nums"],
  },
  textAdded: {
    color: theme.colors.statusSuccess,
  },
  textModified: {
    color: theme.colors.terminal.blue,
  },
  textDeleted: {
    color: theme.colors.statusDanger,
  },
}));
