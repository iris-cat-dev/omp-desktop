import React, { memo, useCallback, useMemo, useId, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { STREAM_METADATA_FONT_SIZE } from "@/components/message";
import { type StreamItem } from "@/types/stream";
import {
  collectTurnFileChangesForBar,
  type TurnFileChange,
  type TurnFileChangeKind,
} from "./turn-file-changes";
import { confirmDialog } from "@/utils/confirm-dialog";

/** The scrollable row pins its viewport to this many visible chips. */
const MAX_VISIBLE_CHIPS = 3;
const SCROLL_SHADE_WIDTH = 18;
const SCROLL_EDGE_EPSILON = 1;
const CHIP_HEIGHT = 20;

const ThemedScrollShadeSvg = withUnistyles(ScrollShadeSvg, shadeColorMapping);

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

  if (changes.length === 0) {
    return null;
  }

  const renderChip = (change: TurnFileChange) => (
    <TurnFileChangeChip
      key={change.path}
      change={change}
      label={t(accessibilityLabelKey(change.kind), { name: change.path })}
      onPress={handlePress}
    />
  );

  if (changes.length <= MAX_VISIBLE_CHIPS) {
    return (
      <View style={stylesheet.bar} testID="turn-file-changes">
        {changes.map(renderChip)}
      </View>
    );
  }
  return (
    <View style={stylesheet.bar} testID="turn-file-changes">
      <ScrollableChipRow
        key={changes.map((change) => change.path).join("|")}
        changes={changes}
        renderChip={renderChip}
      />
    </View>
  );
});

/**
 * Horizontally scrollable chip row used when there are too many chips to show
 * at once. The viewport is pinned to exactly MAX_VISIBLE_CHIPS chips (the x
 * offset of the chip following the last visible one), so extra files stay
 * reachable by scrolling instead of squeezing into the footer; scrolling is
 * exposed without a scrollbar, the mouse wheel scrolls the row horizontally
 * on web, and gradient shades fade out the chips clipped at each edge.
 */
function ScrollableChipRow({
  changes,
  renderChip,
}: {
  changes: readonly TurnFileChange[];
  renderChip: (change: TurnFileChange) => React.ReactNode;
}) {
  const scrollOffset = useSharedValue(0);
  const viewportWidth = useSharedValue(0);
  const contentWidth = useSharedValue(0);
  const scrollableRef = useRef<React.ComponentRef<typeof Animated.ScrollView> | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const [pinnedWidth, setPinnedWidth] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  const handleScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.value = event.contentOffset.x;
    viewportWidth.value = event.layoutMeasurement.width;
    contentWidth.value = event.contentSize.width;
  });
  const handleContentSizeChange = useCallback(
    (width: number) => {
      contentWidth.value = width;
      setScrollable((prev) => prev || width > 0);
    },
    [contentWidth],
  );
  const handleContainerLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      setContainerWidth(event.nativeEvent.layout.width);
    },
    [],
  );
  const handleViewportLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      viewportWidth.value = event.nativeEvent.layout.width;
    },
    [viewportWidth],
  );
  // The x offset of the chip right after the last visible one equals the
  // width of MAX_VISIBLE_CHIPS chips plus their gaps; clamp it to the bar.
  const handleChipLayout = useCallback(
    (index: number) => (event: { nativeEvent: { layout: { x: number } } }) => {
      if (index !== MAX_VISIBLE_CHIPS) {
        return;
      }
      const width = event.nativeEvent.layout.x;
      if (width > 0) {
        setPinnedWidth((prev) => (prev === null || width < prev ? width : prev));
      }
    },
    [],
  );

  useWheelHorizontalScroll(scrollableRef);

  const leftShadeStyle = useAnimatedStyle(() => ({
    opacity: Number(scrollOffset.value > SCROLL_EDGE_EPSILON),
  }));
  const rightShadeStyle = useAnimatedStyle(() => ({
    opacity: Number(
      scrollOffset.value + viewportWidth.value < contentWidth.value - SCROLL_EDGE_EPSILON,
    ),
  }));

  const clampedWidth = clampPinnedWidth(pinnedWidth, containerWidth);

  return (
    <View style={stylesheet.scrollContainer} onLayout={handleContainerLayout}>
      <View
        testID="turn-file-changes-viewport"
        onLayout={handleViewportLayout}
        style={
          clampedWidth === null
            ? stylesheet.scrollViewport
            : [stylesheet.scrollViewport, { width: clampedWidth }]
        }
      >
        <Animated.ScrollView
          ref={scrollableRef}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={handleScroll}
          onContentSizeChange={handleContentSizeChange}
          contentContainerStyle={stylesheet.scrollContent}
        >
          {changes.map((change, index) => (
            <View
              key={change.path}
              onLayout={handleChipLayout(index)}
              testID={`turn-file-changes-slot-${index}`}
            >
              {renderChip(change)}
            </View>
          ))}
        </Animated.ScrollView>
        {scrollable ? (
          <>
            <Animated.View
              pointerEvents="none"
              testID="turn-file-changes-shade-left"
              style={[stylesheet.scrollShade, stylesheet.scrollShadeLeft, leftShadeStyle]}
            >
              <ThemedScrollShadeSvg side="left" />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              testID="turn-file-changes-shade-right"
              style={[stylesheet.scrollShade, stylesheet.scrollShadeRight, rightShadeStyle]}
            >
              <ThemedScrollShadeSvg side="right" />
            </Animated.View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function clampPinnedWidth(pinned: number | null, container: number | null): number | null {
  if (pinned === null) {
    return null;
  }
  if (container === null) {
    return pinned;
  }
  return Math.min(pinned, container);
}

/**
 * Web-only: translate vertical wheel input over the row into horizontal
 * scrolling so a plain mouse wheel can browse the chips. Registered directly
 * on the DOM node; native platforms scroll horizontally natively.
 */
function useWheelHorizontalScroll(
  ref: React.RefObject<React.ComponentRef<typeof Animated.ScrollView> | null>,
): void {
  const getScrollableNode = useCallback(() => {
    if (Platform.OS !== "web") {
      return null;
    }
    const rawRef: unknown = ref.current;
    // react-native-web ScrollView forwards its scrollable div under
    // getScrollableNode(); the ref may also be the div itself.
    const withNode = rawRef as { getScrollableNode?: () => HTMLElement | null } | null;
    return withNode?.getScrollableNode?.() ?? (rawRef instanceof HTMLElement ? rawRef : null);
  }, [ref]);
  React.useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }
    const node = getScrollableNode();
    if (!node) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      const maxScroll = node.scrollWidth - node.clientWidth;
      if (maxScroll <= 0) {
        return;
      }
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      if (delta === 0) {
        return;
      }
      event.preventDefault();
      node.scrollLeft += delta;
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", handleWheel);
    };
  }, [getScrollableNode]);
}

function ScrollShadeSvg({ side, color }: { side: "left" | "right"; color: string }) {
  const gradientId = `turn-file-changes-shade-${side}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient
          id={gradientId}
          x1={side === "left" ? "100%" : "0%"}
          y1="0%"
          x2={side === "left" ? "0%" : "100%"}
          y2="0%"
        >
          <Stop offset="0%" stopColor={color} stopOpacity={0} />
          <Stop offset="100%" stopColor={color} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

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

function shadeColorMapping(theme: Theme) {
  return { color: theme.colors.surface0 };
}

const stylesheet = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    marginBottom: theme.spacing[1] + 2,
    alignSelf: "stretch",
  },
  scrollContainer: {
    width: "100%",
  },
  scrollViewport: {
    position: "relative",
    width: "100%",
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  scrollShade: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: SCROLL_SHADE_WIDTH,
  },
  scrollShadeLeft: {
    left: 0,
  },
  scrollShadeRight: {
    right: 0,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: CHIP_HEIGHT,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[2],
  },
  chipText: {
    fontSize: STREAM_METADATA_FONT_SIZE,
    lineHeight: STREAM_METADATA_FONT_SIZE + 1,
    fontVariant: ["tabular-nums"],
    textAlignVertical: "center",
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
