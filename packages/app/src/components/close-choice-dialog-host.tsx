import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Check, Power } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  getDesktopHost,
  type DesktopCloseChoice,
  type DesktopCloseChoiceRequest,
} from "@/desktop/host";

const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.45,
  },
  footerContent: {
    width: "100%",
    gap: theme.spacing[4],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  action: {
    minWidth: 64,
  },
  rememberRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: 0,
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
  rememberLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

function readCloseChoiceRequest(input: unknown): DesktopCloseChoiceRequest | null {
  if (!input || typeof input !== "object") return null;
  const requestId = (input as Partial<DesktopCloseChoiceRequest>).requestId;
  return Number.isSafeInteger(requestId) ? { requestId: requestId as number } : null;
}

export function CloseChoiceDialogHost() {
  const { theme } = useUnistyles();
  const [request, setRequest] = useState<DesktopCloseChoiceRequest | null>(null);
  const [remember, setRemember] = useState(false);
  const [responding, setResponding] = useState(false);
  const requestIdRef = useRef<number | null>(null);

  const showRequest = useCallback((input: unknown) => {
    const nextRequest = readCloseChoiceRequest(input);
    if (!nextRequest || requestIdRef.current === nextRequest.requestId) return;
    requestIdRef.current = nextRequest.requestId;
    setRemember(false);
    setResponding(false);
    setRequest(nextRequest);
  }, []);

  useEffect(() => {
    const host = getDesktopHost();
    const closeChoice = host?.window?.closeChoice;
    const listen = host?.events?.on;
    if (!closeChoice || typeof listen !== "function") return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve(listen("close-choice-request", showRequest)).then((cleanup) => {
      if (disposed) {
        cleanup?.();
        return;
      }
      unlisten = cleanup;
    });
    void closeChoice.ready?.().then((pendingRequest) => {
      if (!disposed && pendingRequest) showRequest(pendingRequest);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [showRequest]);

  const respond = useCallback(
    async (choice: DesktopCloseChoice) => {
      if (!request || responding) return;
      const sendResponse = getDesktopHost()?.window?.closeChoice?.respond;
      if (!sendResponse) return;

      setResponding(true);
      try {
        const accepted = await sendResponse({ requestId: request.requestId, choice, remember });
        if (accepted) {
          requestIdRef.current = null;
          setRequest(null);
        }
      } catch (error) {
        console.error("[close choice] failed to send response", error);
      } finally {
        setResponding(false);
      }
    },
    [remember, request, responding],
  );
  const handleBackground = useCallback(() => void respond("background"), [respond]);
  const handleQuit = useCallback(() => void respond("quit"), [respond]);
  const handleCancel = useCallback(() => void respond("cancel"), [respond]);
  const handleRemember = useCallback(() => setRemember((current) => !current), []);
  const header: SheetHeader = {
    title: "点击关闭时",
    leading: <Power size={theme.iconSize.md} color={theme.colors.foregroundMuted} />,
  };
  const footer = (
    <View style={styles.footerContent}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: remember, disabled: responding }}
        disabled={responding}
        onPress={handleRemember}
        style={styles.rememberRow}
        testID="close-choice-remember"
      >
        <View style={[styles.checkbox, remember ? styles.checkboxChecked : null]}>
          {remember ? <Check size={13} color={theme.colors.accentForeground} /> : null}
        </View>
        <Text style={styles.rememberLabel}>记住我的选择，不再提醒</Text>
      </Pressable>
      <View style={styles.actions}>
        <Button
          style={styles.action}
          size="sm"
          variant="ghost"
          disabled={responding}
          onPress={handleCancel}
          testID="close-choice-cancel"
        >
          取消
        </Button>
        <Button
          style={styles.action}
          size="sm"
          variant="outline"
          disabled={responding}
          onPress={handleQuit}
          testID="close-choice-quit"
        >
          退出应用
        </Button>
        <Button
          style={styles.action}
          size="sm"
          variant="default"
          disabled={responding}
          onPress={handleBackground}
          testID="close-choice-background"
        >
          最小化到托盘
        </Button>
      </View>
    </View>
  );

  return (
    <AdaptiveModalSheet
      visible={request !== null}
      header={header}
      onClose={handleCancel}
      footer={footer}
      desktopMaxWidth={400}
      density="compact"
      snapPoints={["42%"]}
      scrollable={false}
      testID="close-choice-dialog"
    >
      <Text style={styles.message}>选择最小化到系统托盘后，可通过托盘图标恢复窗口。</Text>
    </AdaptiveModalSheet>
  );
}
