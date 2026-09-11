import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import type { OmpPluginDoctorCheck, OmpPluginInfo } from "@omp-desktop/protocol/messages";

import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { PluginPageState } from "@/screens/settings/plugins-page-state";
import { settingsStyles } from "@/styles/settings";

interface OmpPluginsPageProps {
  serverId: string;
}

interface PluginRowProps {
  plugin: OmpPluginInfo;
  busy: boolean;
  onToggle: (plugin: OmpPluginInfo, enabled: boolean) => void;
  onRemove: (plugin: OmpPluginInfo) => void;
  removeLabel: string;
  toggleLabel: string;
}

interface DoctorCheckRowProps {
  check: OmpPluginDoctorCheck;
}

function getDoctorStatusVariant(status: OmpPluginDoctorCheck["status"]): StatusBadgeVariant {
  if (status === "ok") return "success";
  if (status === "warning") return "warning";
  return "error";
}

function DoctorCheckRow({ check }: DoctorCheckRowProps) {
  return (
    <View style={styles.checkRow}>
      <View style={styles.checkBadge}>
        <StatusBadge label={check.name} variant={getDoctorStatusVariant(check.status)} />
      </View>
      <Text style={settingsStyles.rowHint}>{check.message}</Text>
    </View>
  );
}

function OmpPluginRow({
  plugin,
  busy,
  onToggle,
  onRemove,
  removeLabel,
  toggleLabel,
}: PluginRowProps) {
  const handleToggle = useCallback((value: boolean) => onToggle(plugin, value), [onToggle, plugin]);
  const handleRemove = useCallback(() => onRemove(plugin), [onRemove, plugin]);
  return (
    <View style={styles.pluginRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {plugin.name}
          {plugin.version ? `  ${plugin.version}` : ""}
        </Text>
        {plugin.description ? (
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {plugin.description}
          </Text>
        ) : null}
        {plugin.path ? (
          <Text style={styles.pluginPath} numberOfLines={1}>
            {plugin.path}
          </Text>
        ) : null}
      </View>
      <View style={styles.pluginActions}>
        <Switch
          accessibilityLabel={toggleLabel}
          value={plugin.enabled === true}
          onValueChange={handleToggle}
        />
        <Button variant="destructive" size="sm" loading={busy} onPress={handleRemove}>
          {removeLabel}
        </Button>
      </View>
    </View>
  );
}

/**
 * Management page for the OMP runtime's own plugin ecosystem (`omp plugin`).
 * Distinct from the daemon plugin runtime page (`plugins` slug): this talks to
 * the OMP CLI through the ompPlugins.* RPC family.
 */
export function OmpPluginsPage({ serverId }: OmpPluginsPageProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);

  const [plugins, setPlugins] = useState<OmpPluginInfo[]>([]);
  const [pageState, setPageState] = useState<PluginPageState>("loading");
  const [rawOutput, setRawOutput] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null);
  const [installSpec, setInstallSpec] = useState("");
  const [installDryRun, setInstallDryRun] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installOutput, setInstallOutput] = useState<string | null>(null);
  const [doctorChecks, setDoctorChecks] = useState<OmpPluginDoctorCheck[] | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);

  const load = useCallback(async () => {
    if (!client) {
      setPageState("offline");
      return;
    }
    setPageState("loading");
    setLoadError(null);
    try {
      const result = await client.listOmpPlugins();
      setPlugins(result.plugins);
      setRawOutput(result.rawOutput ?? null);
      setPageState(result.plugins.length === 0 ? "empty" : "ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      setPageState("error");
    }
  }, [client]);

  useEffect(() => {
    if (!connected) {
      setPageState("offline");
      return;
    }
    void load();
  }, [connected, load]);

  const handleToggle = useCallback(
    async (plugin: OmpPluginInfo, enabled: boolean) => {
      if (!client) return;
      setBusyPlugin(plugin.name);
      try {
        const result = await client.setOmpPluginEnabled(plugin.name, enabled);
        if (result.ok) {
          setPlugins((prev) =>
            prev.map((entry) => (entry.name === plugin.name ? { ...entry, enabled } : entry)),
          );
        } else {
          setLoadError(t("settings.host.ompPlugins.feedback.toggleFailed", { id: plugin.name }));
        }
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyPlugin(null);
      }
    },
    [client, t],
  );

  const handleRemove = useCallback(
    async (plugin: OmpPluginInfo) => {
      if (!client) return;
      setBusyPlugin(plugin.name);
      try {
        const result = await client.removeOmpPlugin(plugin.name);
        if (result.ok) {
          setPlugins((prev) => prev.filter((entry) => entry.name !== plugin.name));
        } else {
          setLoadError(
            result.output ??
              t("settings.host.ompPlugins.feedback.removeFailed", { id: plugin.name }),
          );
        }
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyPlugin(null);
      }
    },
    [client, t],
  );

  const handleInstall = useCallback(async () => {
    if (!client || !installSpec.trim()) return;
    setInstalling(true);
    setInstallOutput(null);
    try {
      const result = await client.installOmpPlugin({
        spec: installSpec.trim(),
        dryRun: installDryRun,
      });
      if (result.ok) {
        setInstallSpec("");
        setInstallDryRun(false);
        if (!installDryRun) {
          await load();
        }
      }
      setInstallOutput(result.output ?? null);
    } catch (error) {
      setInstallOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  }, [client, installSpec, installDryRun, load]);

  const handleDoctor = useCallback(
    async (fix: boolean) => {
      if (!client) return;
      setDoctorRunning(true);
      try {
        const result = await client.runOmpPluginDoctor(fix);
        setDoctorChecks(result.checks.length > 0 ? result.checks : null);
        if (result.rawOutput) setInstallOutput(result.rawOutput);
      } catch (error) {
        setInstallOutput(error instanceof Error ? error.message : String(error));
      } finally {
        setDoctorRunning(false);
      }
    },
    [client],
  );

  const handleRetry = useCallback(() => {
    void load();
  }, [load]);

  const handleInstallPress = useCallback(() => {
    void handleInstall();
  }, [handleInstall]);

  const handleDoctorPress = useCallback(() => {
    void handleDoctor(false);
  }, [handleDoctor]);

  const handleDoctorFixPress = useCallback(() => {
    void handleDoctor(true);
  }, [handleDoctor]);

  const errorAction = useMemo(
    () => ({ label: t("settings.host.ompPlugins.states.retry"), onPress: handleRetry }),
    [handleRetry, t],
  );

  let body: ReactNode;
  if (pageState === "offline") {
    body = (
      <SettingsSection title={t("settings.host.ompPlugins.title")}>
        <View style={settingsStyles.card} testID="omp-plugins-offline">
          <View style={[settingsStyles.row, styles.centeredRow]}>
            <View style={styles.centeredContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.host.ompPlugins.states.offlineTitle")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.host.ompPlugins.states.offlineDescription")}
              </Text>
            </View>
          </View>
        </View>
      </SettingsSection>
    );
  } else if (pageState === "loading") {
    body = (
      <SettingsSection title={t("settings.host.ompPlugins.title")}>
        <View style={settingsStyles.card} testID="omp-plugins-loading">
          <View style={[settingsStyles.row, styles.centeredRow]}>
            <Text style={settingsStyles.rowHint}>
              {t("settings.host.ompPlugins.states.loading")}
            </Text>
          </View>
        </View>
      </SettingsSection>
    );
  } else if (pageState === "error") {
    body = (
      <SettingsSection title={t("settings.host.ompPlugins.title")}>
        <View style={settingsStyles.card} testID="omp-plugins-error">
          <View style={[settingsStyles.row, styles.centeredRow]}>
            <View style={styles.centeredContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.host.ompPlugins.states.errorTitle")}
              </Text>
              {loadError ? (
                <Text style={settingsStyles.rowError} numberOfLines={4}>
                  {loadError}
                </Text>
              ) : null}
            </View>
            <Button size="sm" onPress={errorAction.onPress}>
              {errorAction.label}
            </Button>
          </View>
        </View>
      </SettingsSection>
    );
  } else {
    body = (
      <>
        <SettingsSection title={t("settings.host.ompPlugins.listTitle")}>
          <View style={settingsStyles.card} testID="omp-plugins-list-card">
            {pageState === "empty" ? (
              <View style={[settingsStyles.row, styles.centeredRow]}>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.host.ompPlugins.states.empty")}
                </Text>
              </View>
            ) : (
              plugins.map((plugin) => (
                <OmpPluginRow
                  key={plugin.name}
                  plugin={plugin}
                  busy={busyPlugin === plugin.name}
                  onToggle={handleToggle}
                  onRemove={handleRemove}
                  removeLabel={t("settings.host.ompPlugins.actions.remove")}
                  toggleLabel={t("settings.host.ompPlugins.toggleLabel", { id: plugin.name })}
                />
              ))
            )}
            {rawOutput ? (
              <View style={[styles.outputBlock, styles.outputBlockFirst]}>
                <Text style={styles.outputText}>{rawOutput}</Text>
              </View>
            ) : null}
          </View>
        </SettingsSection>

        <SettingsSection title={t("settings.host.ompPlugins.installTitle")}>
          <View style={settingsStyles.card} testID="omp-plugins-install-card">
            <View style={[settingsStyles.row, styles.installRow]}>
              <Field
                label={t("settings.host.ompPlugins.installSpecLabel")}
                hint={t("settings.host.ompPlugins.installPlaceholder")}
                testID="omp-plugins-install-field"
              >
                <View style={styles.installControlRow}>
                  <View style={styles.installInput}>
                    <FormTextInput
                      initialValue={installSpec}
                      onChangeText={setInstallSpec}
                      onSubmitEditing={handleInstallPress}
                      placeholder={t("settings.host.ompPlugins.installPlaceholder")}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!installing}
                      testID="omp-plugins-install-input"
                    />
                  </View>
                  <Button
                    onPress={handleInstallPress}
                    loading={installing}
                    disabled={!installSpec.trim()}
                    testID="omp-plugins-install-button"
                  >
                    {installDryRun
                      ? t("settings.host.ompPlugins.actions.check")
                      : t("settings.host.ompPlugins.actions.install")}
                  </Button>
                </View>
              </Field>
              <View style={styles.dryRunRow}>
                <Switch
                  value={installDryRun}
                  onValueChange={setInstallDryRun}
                  accessibilityLabel={t("settings.host.ompPlugins.dryRunLabel")}
                  testID="omp-plugins-install-dry-run"
                />
                <Text style={settingsStyles.rowHint}>
                  {t("settings.host.ompPlugins.dryRunLabel")}
                </Text>
              </View>
              {installOutput ? (
                <View style={styles.outputBlock}>
                  <Text style={styles.outputText}>{installOutput}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </SettingsSection>

        <SettingsSection title={t("settings.host.ompPlugins.doctorTitle")}>
          <View style={settingsStyles.card} testID="omp-plugins-doctor-card">
            <View style={[settingsStyles.row, styles.doctorActionsRow]}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.host.ompPlugins.doctorTitle")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.host.ompPlugins.doctorHint")}
                </Text>
              </View>
              <View style={styles.doctorButtons}>
                <Button
                  size="sm"
                  onPress={handleDoctorPress}
                  loading={doctorRunning}
                  testID="omp-plugins-doctor-run"
                >
                  {t("settings.host.ompPlugins.actions.doctor")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={handleDoctorFixPress}
                  loading={doctorRunning}
                  disabled={doctorRunning}
                  testID="omp-plugins-doctor-fix"
                >
                  {t("settings.host.ompPlugins.actions.doctorFix")}
                </Button>
              </View>
            </View>
            {doctorChecks?.map((check) => (
              <View key={check.name} style={styles.checkRowBorder}>
                <DoctorCheckRow check={check} />
              </View>
            ))}
          </View>
        </SettingsSection>

        {loadError ? (
          <View style={settingsStyles.card} testID="omp-plugins-action-error">
            <View style={[settingsStyles.row, styles.centeredRow]}>
              <Text style={settingsStyles.rowError} numberOfLines={4}>
                {loadError}
              </Text>
            </View>
          </View>
        ) : null}
      </>
    );
  }

  return <View style={styles.container}>{body}</View>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[4],
  },
  centeredRow: {
    paddingVertical: theme.spacing[4],
    justifyContent: "center",
  },
  centeredContent: {
    flex: 1,
    alignItems: "center",
    gap: theme.spacing[1],
  },
  pluginRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  pluginActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  pluginPath: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    marginTop: theme.spacing[1],
  },
  installRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
  installControlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  installInput: {
    flex: 1,
    minWidth: 0,
  },
  dryRunRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  doctorActionsRow: {
    alignItems: "center",
  },
  doctorButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    flex: 1,
  },
  checkRowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  checkBadge: {
    flexShrink: 0,
    maxWidth: 180,
  },
  outputBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  outputBlockFirst: {
    borderTopWidth: 0,
  },
  outputText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
  },
}));
