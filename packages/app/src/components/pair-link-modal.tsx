import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ConnectionOfferSchema,
  type ConnectionOffer,
} from "@omp-desktop/protocol/connection-offer";
import type { HostProfile } from "@/types/host-connection";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostMutations } from "@/runtime/host-runtime";
import {
  applyConfiguredRelayToOffer,
  decodeOfferFragmentPayload,
  formatRelayServerAddress,
  normalizeHostPort,
  shouldUseTlsForDefaultHostedRelay,
} from "@/utils/daemon-endpoints";
import { connectToDaemon } from "@/utils/test-daemon-connection";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";

export interface PairLinkModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: (profile: HostProfile) => void;
  initialUrl?: string;
  autoPair?: boolean;
}

interface RelayAttemptContext {
  relay: string;
  advertisedRelay: string;
}

function formatOfferRelayAddress(relay: ConnectionOffer["relay"]): string {
  return formatRelayServerAddress({
    endpoint: normalizeHostPort(relay.endpoint),
    useTls: relay.useTls ?? shouldUseTlsForDefaultHostedRelay(relay.endpoint),
  });
}

export function PairLinkModal({
  visible,
  onClose,
  onSaved,
  initialUrl = "",
  autoPair = false,
}: PairLinkModalProps) {
  const { t } = useTranslation();
  const { settings, isLoading: areSettingsLoading } = useAppSettings();
  const { upsertConnectionFromOffer } = useHostMutations();
  const configuredRelayAddress = settings.relayServerAddress;
  const offerUrl = useRef(initialUrl);
  const busy = useRef(false);
  const autoPairAttempted = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.link.title") }), [t]);

  const handleSave = useCallback(async () => {
    if (busy.current) return;
    let relayAttempt: RelayAttemptContext | null = null;
    const raw = offerUrl.current.trim();
    if (!raw || !raw.includes("#offer=")) {
      setErrorMessage(t(raw ? "pairing.link.errors.missingOffer" : "pairing.link.errors.required"));
      return;
    }
    busy.current = true;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const encoded = raw.slice(raw.indexOf("#offer=") + "#offer=".length).trim();
      if (!encoded) throw new Error(t("pairing.link.errors.emptyOffer"));
      const offer = ConnectionOfferSchema.parse(decodeOfferFragmentPayload(encoded));
      const effectiveOffer = applyConfiguredRelayToOffer(offer, configuredRelayAddress);
      relayAttempt = {
        relay: formatOfferRelayAddress(effectiveOffer.relay),
        advertisedRelay: formatOfferRelayAddress(offer.relay),
      };
      const { client, hostname, serverId } = await connectToDaemon(
        {
          id: "probe",
          type: "relay",
          relayEndpoint: normalizeHostPort(effectiveOffer.relay.endpoint),
          useTls: effectiveOffer.relay.useTls,
          daemonPublicKeyB64: effectiveOffer.daemonPublicKeyB64,
        },
        { serverId: effectiveOffer.serverId },
      );
      await client.close().catch(() => undefined);
      if (serverId !== effectiveOffer.serverId) throw new Error(t("pairing.link.errors.invalid"));
      const profile = await upsertConnectionFromOffer(effectiveOffer, hostname ?? undefined);
      onSaved?.(profile);
      onClose();
    } catch (error) {
      const detail = error instanceof Error ? error.message : t("pairing.link.errors.unableToPair");
      setErrorMessage(
        relayAttempt
          ? t("pairing.link.errors.relayConnectionFailed", { ...relayAttempt, detail })
          : detail,
      );
    } finally {
      busy.current = false;
      setIsSaving(false);
    }
  }, [configuredRelayAddress, onClose, onSaved, t, upsertConnectionFromOffer]);

  useEffect(() => {
    if (!visible || !autoPair || autoPairAttempted.current || areSettingsLoading) return;
    autoPairAttempted.current = true;
    void handleSave();
  }, [areSettingsLoading, autoPair, visible, handleSave]);

  const handleClose = useCallback(() => {
    if (!busy.current) onClose();
  }, [onClose]);
  const handleChange = useCallback((value: string) => {
    offerUrl.current = value;
  }, []);
  const handleSubmit = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="pair-link-modal"
    >
      <Text style={styles.helper}>{t("pairing.link.helper")}</Text>
      <Text style={styles.label}>{t("pairing.link.label")}</Text>
      <AdaptiveTextInput
        initialValue={initialUrl}
        onChangeText={handleChange}
        testID="pair-link-input"
        nativeID="pair-link-input"
        accessibilityLabel={t("pairing.link.label")}
        placeholder="#offer=..."
        style={styles.input}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!isSaving}
      />
      {errorMessage ? (
        <Text style={styles.error} testID="pair-link-error">
          {errorMessage}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          variant="secondary"
          onPress={handleClose}
          disabled={isSaving}
          testID="pair-link-cancel"
        >
          {t("pairing.link.actions.cancel")}
        </Button>
        <Button
          onPress={handleSubmit}
          disabled={isSaving || areSettingsLoading}
          testID="pair-link-submit"
        >
          {isSaving ? t("pairing.link.actions.pairing") : t("pairing.link.actions.pair")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  helper: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
  actions: { flexDirection: "row", gap: theme.spacing[3], marginTop: theme.spacing[2] },
}));
