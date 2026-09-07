import * as Clipboard from "expo-clipboard";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenu,
} from "@/components/ui/context-menu";
import type { Rect } from "@/components/ui/menu";
import { isWeb } from "@/constants/platform";
import { useTranslation } from "react-i18next";
import { getQuotedSelectionText } from "@/components/quoted-selection";
import { QuickAskPopover } from "@/components/quick-ask-popover";

interface WebContextMenuEvent {
  nativeEvent: { pageX: number; pageY: number };
  preventDefault(): void;
  stopPropagation(): void;
}

function SelectionContextTarget({
  children,
  onSelection,
}: {
  children: ReactNode;
  onSelection: (text: string, anchorRect: Rect) => void;
}) {
  const contextMenu = useContextMenu();
  const rootRef = useRef<View | null>(null);
  const handleContextMenu = useCallback(
    (event: WebContextMenuEvent) => {
      if (!isWeb || !rootRef.current) return;
      const selection = window.getSelection();
      const text = getQuotedSelectionText(rootRef.current as unknown as HTMLElement, selection);
      if (!text) return;

      event.preventDefault();
      event.stopPropagation();
      const rangeRect =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).getBoundingClientRect()
          : null;
      onSelection(
        text,
        rangeRect && (rangeRect.width > 0 || rangeRect.height > 0)
          ? {
              x: rangeRect.x,
              y: rangeRect.y,
              width: rangeRect.width,
              height: rangeRect.height,
            }
          : {
              x: event.nativeEvent.pageX,
              y: event.nativeEvent.pageY,
              width: 0,
              height: 0,
            },
      );
      contextMenu.setAnchorRect({
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
        width: 0,
        height: 0,
      });
      contextMenu.setOpen(true);
    },
    [contextMenu, onSelection],
  );

  return (
    <View
      ref={rootRef}
      // @ts-expect-error onContextMenu is available on React Native Web.
      onContextMenu={handleContextMenu}
      style={styles.target}
      testID="quoted-selection-context-target"
    >
      {children}
    </View>
  );
}

export function QuotedSelectionContextMenu({
  children,
  onQuote,
  onAsk,
}: {
  children: ReactNode;
  onQuote: (text: string) => void;
  onAsk: (selectedText: string, question: string) => Promise<string>;
}) {
  const { t } = useTranslation();
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionAnchorRect, setSelectionAnchorRect] = useState<Rect | null>(null);
  const [askText, setAskText] = useState<string | null>(null);
  const [askAnchorRect, setAskAnchorRect] = useState<Rect | null>(null);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedText(null);
  }, []);
  const handleSelection = useCallback((text: string, anchorRect: Rect) => {
    setSelectedText(text);
    setSelectionAnchorRect(anchorRect);
  }, []);
  const clearBrowserSelection = useCallback(() => {
    if (isWeb) window.getSelection()?.removeAllRanges();
  }, []);
  const handleQuote = useCallback(() => {
    if (!selectedText) return;
    onQuote(selectedText);
    clearBrowserSelection();
    setSelectedText(null);
  }, [clearBrowserSelection, onQuote, selectedText]);
  const handleAsk = useCallback(() => {
    if (!selectedText) return;
    setAskText(selectedText);
    setAskAnchorRect(selectionAnchorRect);
    clearBrowserSelection();
    setSelectedText(null);
  }, [clearBrowserSelection, selectedText, selectionAnchorRect]);
  const handleCloseAsk = useCallback(() => {
    setAskText(null);
    setAskAnchorRect(null);
  }, []);
  const submitAsk = useCallback(
    (question: string) => {
      if (!askText) return Promise.reject(new Error(t("quickAsk.noSelection")));
      return onAsk(askText, question);
    },
    [askText, onAsk, t],
  );
  const handleCopy = useCallback(() => {
    if (!selectedText) return;
    void Clipboard.setStringAsync(selectedText);
  }, [selectedText]);

  return (
    <>
      <ContextMenu onOpenChange={handleOpenChange}>
        <SelectionContextTarget onSelection={handleSelection}>{children}</SelectionContextTarget>
        <ContextMenuContent align="start" width={200} testID="quoted-selection-context-menu">
          <ContextMenuItem onSelect={handleQuote} testID="quoted-selection-context-menu-quote">
            {t("composer.attachments.quoteSelection")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleAsk} testID="quoted-selection-context-menu-ask">
            {t("quickAsk.menuLabel")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleCopy}>{t("common.actions.copy")}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <QuickAskPopover
        visible={askText !== null}
        anchorRect={askAnchorRect}
        selectedText={askText ?? ""}
        onClose={handleCloseAsk}
        onAsk={submitAsk}
      />
    </>
  );
}

const styles = StyleSheet.create(() => ({
  target: {
    flex: 1,
    minHeight: 0,
  },
}));
