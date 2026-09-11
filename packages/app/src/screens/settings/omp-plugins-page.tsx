import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import type { OmpPluginDoctorCheck, OmpPluginInfo } from "@omp-desktop/protocol/messages";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { PluginPageState } from "@/screens/settings/plugins-page-state";

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

function getDoctorStatusLabel(status: OmpPluginDoctorCheck["status"]): string {
  if (status === "ok") return "OK";
  if (status === "warning") return "WARN";
  return "ERR";
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
      <View style={styles.pluginInfo}>
        <Text style={styles.pluginName}>
          {plugin.name}
          {plugin.version ? `  ${plugin.version}` : ""}
        </Text>
        <Text style={styles.muted}>{plugin.path}</Text>
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

function DoctorCheckRow({ check }: DoctorCheckRowProps) {
  return (
    <View style={styles.pluginRow}>
      <Text
        style={[
          styles.doctorStatus,
          check.status === "error" && styles.doctorStatusError,
          check.status === "warning" && styles.doctorStatusWarning,
        ]}
      >
        {getDoctorStatusLabel(check.status)}
      </Text>
      <View style={styles.pluginInfo}>
        <Text style={styles.pluginName}>{check.name}</Text>
        <Text style={styles.muted}>{check.message}</Text>
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

  const offlineMessage = (
    <SettingsMessage
      title={t("settings.host.ompPlugins.states.offlineTitle")}
      description={t("settings.host.ompPlugins.states.offlineDescription")}
    />
  );
  const loadingMessage = (
    <SettingsMessage
      title={t("settings.host.ompPlugins.title")}
      description={t("settings.host.ompPlugins.states.loading")}
    />
  );
  const errorAction = useMemo(
    () => ({ label: t("settings.host.ompPlugins.states.retry"), onPress: handleRetry }),
    [handleRetry, t],
  );
  const errorMessage = (
    <SettingsMessage
      title={t("settings.host.ompPlugins.states.errorTitle")}
      description={loadError ?? ""}
      action={errorAction}
    />
  );

  let body: ReactNode;
  if (pageState === "offline") {
    body = offlineMessage;
  } else if (pageState === "loading") {
    body = loadingMessage;
  } else if (pageState === "error") {
    body = errorMessage;
  } else {
    body = (
      <>
        <SettingsSection title={t("settings.host.ompPlugins.listTitle")}>
          {pageState === "empty" ? (
            <Text style={styles.muted}>{t("settings.host.ompPlugins.states.empty")}</Text>
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
          {rawOutput ? <Text style={styles.rawOutput}>{rawOutput}</Text> : null}
        </SettingsSection>

        <SettingsSection title={t("settings.host.ompPlugins.installTitle")}>
          <TextInput
            initialValue={installSpec}
            onChangeText={setInstallSpec}
            placeholder={t("settings.host.ompPlugins.installPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.installActions}>
            <Button
              onPress={handleInstallPress}
              loading={installing}
              disabled={!installSpec.trim()}
            >
              {installDryRun
                ? t("settings.host.ompPlugins.actions.check")
                : t("settings.host.ompPlugins.actions.install")}
            </Button>
            <Switch
              value={installDryRun}
              onValueChange={setInstallDryRun}
              accessibilityLabel={t("settings.host.ompPlugins.dryRunLabel")}
            />
            <Text style={styles.muted}>{t("settings.host.ompPlugins.dryRunLabel")}</Text>
          </View>
          {installOutput ? <Text style={styles.rawOutput}>{installOutput}</Text> : null}
        </SettingsSection>

        <SettingsSection title={t("settings.host.ompPlugins.doctorTitle")}>
          <View style={styles.installActions}>
            <Button onPress={handleDoctorPress} loading={doctorRunning}>
              {t("settings.host.ompPlugins.actions.doctor")}
            </Button>
            <Button variant="outline" onPress={handleDoctorFixPress} loading={doctorRunning}>
              {t("settings.host.ompPlugins.actions.doctorFix")}
            </Button>
          </View>
          {doctorChecks?.map((check) => (
            <DoctorCheckRow key={check.name} check={check} />
          ))}
        </SettingsSection>

        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
      </>
    );
  }

  return <View style={styles.container}>{body}</View>;
}

function SettingsMessage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.messageRow}>
      <View style={styles.pluginInfo}>
        <Text style={styles.pluginName}>{title}</Text>
        <Text style={styles.muted}>{description}</Text>
      </View>
      {action ? <Button onPress={action.onPress}>{action.label}</Button> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[4],
  },
  pluginRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  pluginInfo: {
    flex: 1,
    gap: theme.spacing[1],
  },
  pluginName: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "500",
  },
  pluginActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  installActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
  rawOutput: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontFamily: "monospace",
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: 12,
  },
  doctorStatus: {
    color: theme.colors.statusSuccess,
    fontSize: 11,
    fontWeight: "700",
    width: 42,
  },
  doctorStatusError: {
    color: theme.colors.statusDanger,
  },
  doctorStatusWarning: {
    color: theme.colors.statusWarning,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
}));
