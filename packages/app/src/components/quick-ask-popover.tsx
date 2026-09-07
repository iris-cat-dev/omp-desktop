import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AnchoredSurface } from "@/components/ui/menu/menu-overlay";
import type { Rect } from "@/components/ui/menu";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { getOverlayRoot, OverlayLayerProvider, useOverlayLayer } from "@/lib/overlay-root";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedCloseIcon = withUnistyles(X);
const mutedSpinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface QuickAskPopoverProps {
  visible: boolean;
  anchorRect: Rect | null;
  selectedText: string;
  onClose: () => void;
  onAsk: (question: string) => Promise<string>;
}

export function QuickAskPopover({
  visible,
  anchorRect,
  selectedText,
  onClose,
  onAsk,
}: QuickAskPopoverProps) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const floatingLayer = useOverlayLayer("floating");
  const anchorRef = useRef<View>(null);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    requestVersionRef.current += 1;
    setQuestion("");
    setAnswer(null);
    setError(null);
    setIsPending(false);
    const timeout = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timeout);
  }, [visible, selectedText]);

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
      const result = await onAsk(trimmedQuestion);
      if (requestVersionRef.current === requestVersion) setAnswer(result);
    } catch (caught) {
      if (requestVersionRef.current === requestVersion) {
        setError(caught instanceof Error && caught.message ? caught.message : t("quickAsk.failed"));
      }
    } finally {
      if (requestVersionRef.current === requestVersion) setIsPending(false);
    }
  }, [isPending, onAsk, question, t]);
  const handleAskVoid = useCallback(() => {
    void handleAsk();
  }, [handleAsk]);

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
          testID="quick-ask-popover"
        >
          <View style={styles.body}>
            <View style={styles.header}>
              <Text style={styles.title}>{t("quickAsk.title")}</Text>
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
              placeholder={t("quickAsk.placeholder")}
              editable={!isPending}
              multiline
              maxLength={2000}
              style={styles.input}
              testID="quick-ask-input"
            />

            <View style={styles.actions}>
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
    justifyContent: "flex-end",
    gap: theme.spacing[2],
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
