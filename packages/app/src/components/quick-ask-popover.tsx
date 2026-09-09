import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeSyntheticEvent,
  type PointerEvent as RNPointerEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AnchoredSurface } from "@/components/ui/menu/menu-overlay";
import type { Rect } from "@/components/ui/menu";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { getOverlayRoot, OverlayLayerProvider, useOverlayLayer } from "@/lib/overlay-root";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedCloseIcon = withUnistyles(X);
const ThemedCheckIcon = withUnistyles(Check);
const mutedSpinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const checkedIconColor = (theme: Theme) => ({ color: theme.colors.accentForeground });

interface DragOffset {
  x: number;
  y: number;
}

type QuickAskKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & {
    shiftKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
  }
>;

const INITIAL_DRAG_OFFSET: DragOffset = { x: 0, y: 0 };
const VIEWPORT_EDGE_GAP = 8;
const DRAG_HANDLE_WEB_STYLE = { cursor: "move", touchAction: "none" } as object;

function ContextCheckbox({
  checked,
  disabled,
  onPress,
}: {
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={t("quickAsk.includeContext")}
      accessibilityState={accessibilityState}
      aria-checked={checked}
      disabled={disabled}
      onPress={onPress}
      style={styles.contextRow}
      testID="quick-ask-include-context"
    >
      <View style={[styles.checkbox, checked ? styles.checkboxChecked : null]}>
        {checked ? <ThemedCheckIcon size={13} uniProps={checkedIconColor} /> : null}
      </View>
      <Text style={styles.mutedText}>{t("quickAsk.includeContext")}</Text>
    </Pressable>
  );
}

interface QuickAskPopoverProps {
  visible: boolean;
  anchorRect: Rect | null;
  selectedText: string;
  onClose: () => void;
  onAsk: (question: string, includeContext: boolean) => Promise<string>;
}

export function QuickAskPopover({
  visible,
  anchorRect,
  selectedText,
  onClose,
  onAsk,
}: QuickAskPopoverProps) {
  const { t } = useTranslation();
  const [includeContext, setIncludeContext] = useState(true);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [dragOffset, setDragOffset] = useState<DragOffset>(INITIAL_DRAG_OFFSET);
  const floatingLayer = useOverlayLayer("floating");
  const anchorRef = useRef<View>(null);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const requestVersionRef = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const toggleContext = useCallback(() => setIncludeContext((current) => !current), []);

  useEffect(() => {
    if (!visible) return;
    requestVersionRef.current += 1;
    setQuestion("");
    setIncludeContext(true);
    setAnswer(null);
    setError(null);
    setIsPending(false);
    setDragOffset(INITIAL_DRAG_OFFSET);
    const timeout = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timeout);
  }, [visible, selectedText]);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const handleClose = useCallback(() => {
    requestVersionRef.current += 1;
    onClose();
  }, [onClose]);
  const handleQuestionChange = useCallback((value: string) => {
    setQuestion(value);
    setError(null);
  }, []);
  const handleAsk = useCallback(async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isPending) return;

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setIsPending(true);
    setAnswer(null);
    setError(null);
    try {
      const result = await onAsk(trimmedQuestion, includeContext);
      if (requestVersionRef.current === requestVersion) setAnswer(result);
    } catch (caught) {
      if (requestVersionRef.current === requestVersion) {
        setError(caught instanceof Error && caught.message ? caught.message : t("quickAsk.failed"));
      }
    } finally {
      if (requestVersionRef.current === requestVersion) setIsPending(false);
    }
  }, [includeContext, isPending, onAsk, question, t]);
  const handleAskVoid = useCallback(() => {
    void handleAsk();
  }, [handleAsk]);
  const handleQuestionKeyPress = useCallback(
    (event: QuickAskKeyPressEvent) => {
      if (
        event.nativeEvent.key !== "Enter" ||
        event.nativeEvent.shiftKey ||
        isImeComposingKeyboardEvent(event.nativeEvent) ||
        !question.trim() ||
        isPending
      ) {
        return;
      }
      event.preventDefault();
      handleAskVoid();
    },
    [handleAskVoid, isPending, question],
  );
  const handleDragStart = useCallback(
    (event: RNPointerEvent) => {
      if (event.nativeEvent.button !== 0 || dragCleanupRef.current) return;

      const handleElement = event.currentTarget as unknown as HTMLElement;
      const surfaceElement = handleElement.closest<HTMLElement>('[data-menu-surface="true"]');
      if (!surfaceElement) return;

      const pointerId = event.nativeEvent.pointerId;
      const pointerStart = {
        x: event.nativeEvent.clientX,
        y: event.nativeEvent.clientY,
      };
      const surfaceRect = surfaceElement.getBoundingClientRect();
      const initialOffset = dragOffset;
      const cursorBeforeDrag = document.body.style.cursor;
      const userSelectBeforeDrag = document.body.style.userSelect;
      document.body.style.cursor = "move";
      document.body.style.userSelect = "none";
      handleElement.setPointerCapture?.(pointerId);
      event.preventDefault();

      function cleanup() {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerEnd);
        document.body.style.cursor = cursorBeforeDrag;
        document.body.style.userSelect = userSelectBeforeDrag;
        if (handleElement.hasPointerCapture?.(pointerId)) {
          handleElement.releasePointerCapture(pointerId);
        }
        dragCleanupRef.current = null;
      }

      function handlePointerMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - pointerStart.x;
        const deltaY = moveEvent.clientY - pointerStart.y;
        setDragOffset({
          x:
            initialOffset.x +
            Math.max(
              VIEWPORT_EDGE_GAP - surfaceRect.left,
              Math.min(deltaX, window.innerWidth - VIEWPORT_EDGE_GAP - surfaceRect.right),
            ),
          y:
            initialOffset.y +
            Math.max(
              VIEWPORT_EDGE_GAP - surfaceRect.top,
              Math.min(deltaY, window.innerHeight - VIEWPORT_EDGE_GAP - surfaceRect.bottom),
            ),
        });
      }

      function handlePointerEnd(endEvent: PointerEvent) {
        if (endEvent.pointerId !== pointerId) return;
        cleanup();
      }

      dragCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove, { passive: false });
      window.addEventListener("pointerup", handlePointerEnd);
      window.addEventListener("pointercancel", handlePointerEnd);
    },
    [dragOffset],
  );

  if (!visible || !anchorRect || !isWeb || typeof document === "undefined") return null;

  return createPortal(
    <OverlayLayerProvider layer={floatingLayer}>
      <View pointerEvents="box-none" style={[styles.overlay, { zIndex: floatingLayer }]}>
        <AnchoredSurface
          open
          onClose={handleClose}
          anchorRect={anchorRect}
          anchorRef={anchorRef}
          side="right"
          align="start"
          offset={8}
          width={360}
          maxWidth={360}
          maxHeight={520}
          horizontalPadding={12}
          backdrop={false}
          positionOffset={dragOffset}
          testID="quick-ask-popover"
        >
          <View style={styles.body}>
            <View style={styles.header}>
              <View
                accessibilityRole="none"
                onPointerDown={handleDragStart}
                style={[styles.dragHandle, DRAG_HANDLE_WEB_STYLE]}
                testID="quick-ask-drag-handle"
              >
                <Text style={styles.title}>{t("quickAsk.title")}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.actions.close")}
                hitSlop={8}
                onPress={handleClose}
                style={styles.closeButton}
                testID="quick-ask-close"
              >
                <ThemedCloseIcon size={16} uniProps={mutedIconColor} />
              </Pressable>
            </View>

            <View style={styles.selectionCard}>
              <Text style={styles.selectionLabel}>{t("quickAsk.selectedContent")}</Text>
              <Text selectable numberOfLines={4} style={styles.selectionText}>
                {selectedText}
              </Text>
            </View>

            <AdaptiveTextInput
              ref={inputRef}
              initialValue=""
              onChangeText={handleQuestionChange}
              onKeyPress={handleQuestionKeyPress}
              placeholder={t("quickAsk.placeholder")}
              editable={!isPending}
              multiline
              maxLength={2000}
              style={styles.input}
              testID="quick-ask-input"
            />

            <View style={styles.actions}>
              <ContextCheckbox
                checked={includeContext}
                disabled={isPending}
                onPress={toggleContext}
              />
              <Button
                variant="default"
                size="sm"
                onPress={handleAskVoid}
                disabled={!question.trim() || isPending}
                loading={isPending}
                testID="quick-ask-submit"
              >
                {t("quickAsk.ask")}
              </Button>
            </View>

            {isPending ? (
              <View style={styles.loading} testID="quick-ask-loading">
                <ThemedLoadingSpinner size="small" uniProps={mutedSpinnerColor} />
                <Text style={styles.mutedText}>{t("quickAsk.thinking")}</Text>
              </View>
            ) : null}
            {error ? (
              <Text style={styles.errorText} testID="quick-ask-error">
                {error}
              </Text>
            ) : null}
            {answer ? (
              <View style={styles.answerSection} testID="quick-ask-answer">
                <Text style={styles.answerLabel}>{t("quickAsk.answer")}</Text>
                <ScrollView style={styles.answerScroll} nestedScrollEnabled>
                  <Text selectable style={styles.answerText}>
                    {answer}
                  </Text>
                </ScrollView>
              </View>
            ) : null}
          </View>
        </AnchoredSurface>
      </View>
    </OverlayLayerProvider>,
    getOverlayRoot(),
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: "box-none",
  },
  body: {
    gap: theme.spacing[2],
    minHeight: 0,
    padding: theme.spacing[2],
  },
  header: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dragHandle: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  closeButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  selectionCard: {
    gap: theme.spacing[1],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
  },
  selectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  selectionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  input: {
    minHeight: 64,
    maxHeight: 110,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  checkbox: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  checkboxChecked: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  answerSection: {
    minHeight: 0,
    gap: theme.spacing[2],
  },
  answerLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  answerScroll: {
    maxHeight: 180,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
  },
  answerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 21,
  },
}));
