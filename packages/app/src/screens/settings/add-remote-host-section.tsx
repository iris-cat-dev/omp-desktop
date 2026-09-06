import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { PairLinkModal } from "@/components/pair-link-modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import type { HostProfile } from "@/types/host-connection";
import { formatRelayServerAddress, parseRelayServerAddress } from "@/utils/daemon-endpoints";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";

export function AddRemoteHostSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const { addHost } = useLocalSearchParams<{ addHost?: string }>();
  const { settings, isLoading: areSettingsLoading, updateSettings } = useAppSettings();
  const consumedIntent = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [relayDraft, setRelayDraft] = useState(settings.relayServerAddress);
  const [relayResetVersion, setRelayResetVersion] = useState(0);
  const [isSavingRelay, setIsSavingRelay] = useState(false);
  const [relaySaveError, setRelaySaveError] = useState("");
  const [relaySaved, setRelaySaved] = useState(false);
  const trimmedRelayDraft = relayDraft.trim();
  const parsedRelayDraft = useMemo(() => {
    if (!trimmedRelayDraft) return null;
    try {
      return parseRelayServerAddress(trimmedRelayDraft);
    } catch {
      return null;
    }
  }, [trimmedRelayDraft]);
  const normalizedRelayDraft = parsedRelayDraft ? formatRelayServerAddress(parsedRelayDraft) : "";
  const relayDraftInvalid = Boolean(trimmedRelayDraft) && parsedRelayDraft === null;
  const relayDraftDirty = normalizedRelayDraft !== settings.relayServerAddress;
  useEffect(() => {
    setRelayDraft(settings.relayServerAddress);
    setRelayResetVersion((version) => version + 1);
  }, [settings.relayServerAddress]);
  useEffect(() => {
    if (typeof addHost === "string" && addHost && consumedIntent.current !== addHost) {
      consumedIntent.current = addHost;
      setVisible(true);
    }
  }, [addHost]);
  const handleOpen = useCallback(() => setVisible(true), []);
  const handleClose = useCallback(() => setVisible(false), []);
  const handleRelayChange = useCallback((value: string) => {
    setRelayDraft(value);
    setRelaySaved(false);
    setRelaySaveError("");
  }, []);
  const handleRelayReset = useCallback(() => {
    setRelayDraft(settings.relayServerAddress);
    setRelayResetVersion((version) => version + 1);
    setRelaySaved(false);
    setRelaySaveError("");
  }, [settings.relayServerAddress]);
  const handleRelaySave = useCallback(async () => {
    if (relayDraftInvalid || !relayDraftDirty || isSavingRelay) return;
    setIsSavingRelay(true);
    setRelaySaveError("");
    setRelaySaved(false);
    try {
      await updateSettings({ relayServerAddress: normalizedRelayDraft });
      setRelayDraft(normalizedRelayDraft);
      setRelayResetVersion((version) => version + 1);
      setRelaySaved(true);
    } catch (error) {
      setRelaySaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingRelay(false);
    }
  }, [isSavingRelay, normalizedRelayDraft, relayDraftDirty, relayDraftInvalid, updateSettings]);
  const handleRelaySubmit = useCallback(() => {
    void handleRelaySave();
  }, [handleRelaySave]);
  const handleSaved = useCallback(
    (profile: HostProfile) => {
      router.replace(buildSettingsHostSectionRoute(profile.serverId, "host"));
    },
    [router],
  );

  return (
    <>
      <SettingsSection title={t("pairing.relayAddress.label")}>
        <View style={styles.relayContent} testID="settings-relay-address">
          <Text style={styles.description}>{t("pairing.relayAddress.description")}</Text>
          <AdaptiveTextInput
            initialValue={settings.relayServerAddress}
            resetKey={`${relayResetVersion}:${settings.relayServerAddress}`}
            onChangeText={handleRelayChange}
            editable={!areSettingsLoading && !isSavingRelay}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
            placeholder="wss://relay.example.com"
            accessibilityLabel={t("pairing.relayAddress.label")}
            testID="settings-relay-address-input"
          />
          {relayDraftInvalid ? (
            <Alert
              variant="error"
              description={t("pairing.relayAddress.invalid")}
              testID="settings-relay-address-invalid"
            />
          ) : null}
          {relaySaveError ? (
            <Alert
              variant="error"
              description={relaySaveError}
              testID="settings-relay-address-error"
            />
          ) : null}
          {relaySaved ? (
            <Alert
              variant="success"
              description={t("pairing.relayAddress.saved")}
              testID="settings-relay-address-success"
            />
          ) : null}
          <View style={styles.actions}>
            <Button
              onPress={handleRelaySubmit}
              disabled={
                areSettingsLoading || isSavingRelay || relayDraftInvalid || !relayDraftDirty
              }
              testID="settings-relay-address-save"
            >
              {t(isSavingRelay ? "pairing.relayAddress.saving" : "pairing.relayAddress.save")}
            </Button>
            {relayDraft !== settings.relayServerAddress ? (
              <Button
                variant="outline"
                onPress={handleRelayReset}
                disabled={isSavingRelay}
                testID="settings-relay-address-reset"
              >
                {t("common.actions.cancel")}
              </Button>
            ) : null}
          </View>
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.addHost")}>
        <Button onPress={handleOpen} disabled={areSettingsLoading} testID="settings-add-host">
          {t("pairing.connectionMethods.pasteLink.title")}
        </Button>
        {visible ? <PairLinkModal visible onClose={handleClose} onSaved={handleSaved} /> : null}
      </SettingsSection>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  relayContent: { gap: theme.spacing[3] },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
}));
