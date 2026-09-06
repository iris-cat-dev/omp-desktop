import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { useMutation } from "@tanstack/react-query";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useFetchQuery } from "@/data/query";
import { daemonPairingOfferQueryKey } from "@/data/daemon-pairing";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "./settings-section";

export function PairDeviceSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const handleOpen = useCallback(() => setVisible(true), []);
  const handleClose = useCallback(() => setVisible(false), []);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("openProject.tiles.pairDevice.title") }),
    [t],
  );
  return (
    <SettingsSection title={t("openProject.tiles.pairDevice.title")}>
      <Button variant="outline" onPress={handleOpen} testID="settings-pair-device">
        {t("openProject.tiles.pairDevice.title")}
      </Button>
      {visible ? (
        <AdaptiveModalSheet
          visible
          header={header}
          onClose={handleClose}
          testID="pair-device-modal"
        >
          <PairDeviceOffer serverId={serverId} />
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

function PairDeviceOffer({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const features = client?.getLastServerInfoMessage()?.features;
  const supportsPairing = features?.daemonStatusRpc === true;
  const pairing = useFetchQuery({
    queryKey: daemonPairingOfferQueryKey(serverId),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.getDaemonPairingOffer();
    },
    enabled: isConnected && supportsPairing,
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
  });
  const enableRelay = useMutation({
    mutationFn: async () => {
      if (!isConnected || !client) throw new Error(t("workspace.terminal.hostDisconnected"));
      if (features?.relayConfig !== true) throw new Error(t("pairing.device.updateRequired"));
      const config = await patchConfig({ relay: { enabled: true } });
      if (!config) throw new Error(t("workspace.terminal.hostDisconnected"));
      await pairing.refetch({ throwOnError: true });
    },
  });
  const copyLink = useMutation({
    mutationFn: async () => {
      if (pairing.data?.url) await Clipboard.setStringAsync(pairing.data.url);
    },
  });
  const handleEnable = useCallback(() => enableRelay.mutate(), [enableRelay]);
  const handleCopy = useCallback(() => copyLink.mutate(), [copyLink]);
  const handleRetry = useCallback(() => {
    void pairing.refetch();
  }, [pairing]);

  if (!isConnected)
    return <Alert variant="error" description={t("workspace.terminal.hostDisconnected")} />;
  if (!supportsPairing)
    return <Alert variant="warning" description={t("pairing.device.updateRequired")} />;
  if (pairing.isPending) return <Text style={styles.text}>{t("pairing.device.loadingOffer")}</Text>;
  if (pairing.error) {
    return (
      <Alert variant="error" description={pairing.error.message}>
        <Button onPress={handleRetry} testID="pair-device-retry">
          {t("pairing.device.retry")}
        </Button>
      </Alert>
    );
  }
  if (!pairing.data?.relayEnabled) {
    return (
      <View style={styles.content}>
        <Text style={styles.text}>{t("pairing.device.enableDescription")}</Text>
        {enableRelay.error ? (
          <Alert variant="error" description={enableRelay.error.message} />
        ) : null}
        {features?.relayConfig === true ? (
          <Button
            onPress={handleEnable}
            disabled={enableRelay.isPending}
            testID="pair-device-enable-relay"
          >
            {t(
              enableRelay.isPending ? "pairing.device.enablingRelay" : "pairing.device.enableRelay",
            )}
          </Button>
        ) : (
          <Alert variant="warning" description={t("pairing.device.updateRequired")} />
        )}
      </View>
    );
  }
  if (!pairing.data.url) {
    return (
      <Alert variant="warning" description={t("pairing.device.unavailable")}>
        <Button onPress={handleRetry} testID="pair-device-retry">
          {t("pairing.device.retry")}
        </Button>
      </Alert>
    );
  }
  return (
    <View style={styles.content} testID="pair-device-content">
      <Text style={styles.text}>{t("pairing.device.hint")}</Text>
      <AdaptiveTextInput
        initialValue={pairing.data.url}
        resetKey={pairing.data.url}
        readOnly
        selectTextOnFocus
        style={styles.input}
        accessibilityLabel={t("pairing.link.label")}
        testID="pair-device-link"
      />
      <Button onPress={handleCopy} disabled={copyLink.isPending} testID="pair-device-copy-link">
        {t(copyLink.isSuccess ? "pairing.device.copied" : "pairing.device.copy")}
      </Button>
      {copyLink.error ? <Alert variant="error" description={copyLink.error.message} /> : null}
      <Alert variant="warning" description={t("pairing.device.securityWarning")} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[3] },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
}));
