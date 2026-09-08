import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useConfirmDialogStore } from "@/stores/confirm-dialog-store";

const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
  },
  actions: {
    width: "100%",
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  action: {
    flex: 1,
  },
}));

export function ConfirmDialogHost() {
  const { theme } = useUnistyles();
  const request = useConfirmDialogStore((state) => state.request);
  const respond = useConfirmDialogStore((state) => state.respond);
  const handleCancel = useCallback(() => respond(false), [respond]);
  const handleConfirm = useCallback(() => respond(true), [respond]);
  const header = useMemo<SheetHeader>(
    () => ({
      title: request?.title ?? "",
      leading: (
        <AlertTriangle
          size={theme.iconSize.md}
          color={request?.destructive ? theme.colors.destructive : theme.colors.statusWarning}
        />
      ),
    }),
    [request?.destructive, request?.title, theme.colors, theme.iconSize.md],
  );
  const footer = request ? (
    <View style={styles.actions}>
      <Button
        style={styles.action}
        variant="secondary"
        onPress={handleCancel}
        testID="confirm-dialog-cancel"
      >
        {request.cancelLabel ?? "Cancel"}
      </Button>
      <Button
        style={styles.action}
        variant={request.destructive ? "destructive" : "default"}
        onPress={handleConfirm}
        testID="confirm-dialog-confirm"
      >
        {request.confirmLabel ?? "Confirm"}
      </Button>
    </View>
  ) : null;

  return (
    <AdaptiveModalSheet
      visible={request !== null}
      header={header}
      onClose={handleCancel}
      footer={footer}
      desktopMaxWidth={440}
      snapPoints={["38%"]}
      scrollable={false}
      testID="confirm-dialog"
    >
      {request ? <Text style={styles.message}>{request.message}</Text> : null}
    </AdaptiveModalSheet>
  );
}
