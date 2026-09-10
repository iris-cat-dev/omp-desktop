import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { STREAM_METADATA_FONT_SIZE } from "@/components/message";
import { type StreamItem } from "@/types/stream";
import {
  collectTurnFileChangesForBar,
  type TurnFileChange,
  type TurnFileChangeKind,
} from "./turn-file-changes";
import { confirmDialog } from "@/utils/confirm-dialog";

/** Keep a short preview visible; the disclosure reveals the complete list. */
const MAX_COLLAPSED_CHIPS = 3;
const CHIP_HEIGHT = 24;

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
  const changesKey = useMemo(
    () => changes.map((change) => `${change.kind}:${change.path}`).join("|"),
    [changes],
  );
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [changesKey]);
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

  if (changes.length === 0) {
    return null;
  }

  const hasOverflow = changes.length > MAX_COLLAPSED_CHIPS;
  const hiddenCount = changes.length - MAX_COLLAPSED_CHIPS;
  const visibleChanges = hasOverflow && !expanded ? changes.slice(0, MAX_COLLAPSED_CHIPS) : changes;

  return (
    <View style={stylesheet.bar} testID="turn-file-changes">
      {visibleChanges.map((change) => (
        <TurnFileChangeChip
          key={change.path}
          change={change}
          label={t(accessibilityLabelKey(change.kind), { name: change.path })}
          onPress={handlePress}
        />
      ))}
      {hasOverflow ? (
        <Pressable
          onPress={() => setExpanded((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={t(
            expanded
              ? "agentStream.turnFileChanges.collapse"
              : "agentStream.turnFileChanges.showMore",
            { count: hiddenCount },
          )}
          accessibilityState={{ expanded }}
          testID="turn-file-changes-toggle"
        >
          <View style={[stylesheet.chip, stylesheet.summaryChip]}>
            <Text style={[stylesheet.chipText, stylesheet.summaryText]}>
              {expanded
                ? t("agentStream.turnFileChanges.collapse")
                : t("agentStream.turnFileChanges.moreCount", { count: hiddenCount })}
            </Text>
          </View>
        </Pressable>
      ) : null}
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
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          style={[stylesheet.chipText, chipTextStyle(change.kind)]}
        >
          {fileName}
        </Text>
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
    alignSelf: "stretch",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: CHIP_HEIGHT,
    maxWidth: 240,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[2],
  },
  chipText: {
    flexShrink: 1,
    fontSize: STREAM_METADATA_FONT_SIZE,
    lineHeight: 16,
    includeFontPadding: false,
    fontVariant: ["tabular-nums"],
    textAlignVertical: "center",
  },
  summaryChip: {
    backgroundColor: theme.colors.surface2,
  },
  summaryText: {
    color: theme.colors.foregroundMuted,
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
