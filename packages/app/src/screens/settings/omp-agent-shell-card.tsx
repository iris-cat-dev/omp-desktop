import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfig } from "@omp-desktop/protocol/messages";

import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

type AgentShellMode = "auto" | "git-bash" | "omp-default" | "custom";

interface StoredAgentShellConfig {
  mode?: unknown;
  path?: unknown;
}

interface StoredOmpProviderConfig {
  params?: {
    agentShell?: StoredAgentShellConfig;
  };
}

function readAgentShellConfig(config: MutableDaemonConfig | null): {
  mode: AgentShellMode;
  path: string;
} {
  const omp = config?.providers.omp as StoredOmpProviderConfig | undefined;
  const shell = omp?.params?.agentShell;
  const mode = shell?.mode;
  return {
    mode: mode === "git-bash" || mode === "omp-default" || mode === "custom" ? mode : "auto",
    path: typeof shell?.path === "string" ? shell.path : "",
  };
}

export function OmpAgentShellCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const persisted = readAgentShellConfig(config);
  const [selectedMode, setSelectedMode] = useState<AgentShellMode>(persisted.mode);
  const [customPath, setCustomPath] = useState(persisted.path);

  useEffect(() => {
    setSelectedMode(persisted.mode);
    setCustomPath(persisted.path);
  }, [persisted.mode, persisted.path]);

  const options = useMemo<SelectFieldOption<AgentShellMode>[]>(
    () => [
      {
        id: "auto",
        value: "auto",
        label: t("settings.providers.omp.shell.auto"),
        description: t("settings.providers.omp.shell.autoDescription"),
      },
      {
        id: "git-bash",
        value: "git-bash",
        label: t("settings.providers.omp.shell.gitBash"),
        description: t("settings.providers.omp.shell.gitBashDescription"),
      },
      {
        id: "omp-default",
        value: "omp-default",
        label: t("settings.providers.omp.shell.ompDefault"),
        description: t("settings.providers.omp.shell.ompDefaultDescription"),
      },
      {
        id: "custom",
        value: "custom",
        label: t("settings.providers.omp.shell.custom"),
        description: t("settings.providers.omp.shell.customDescription"),
      },
    ],
    [t],
  );

  const mutation = useMutation({
    mutationFn: async ({ mode, path }: { mode: AgentShellMode; path?: string }) => {
      const result = await patchConfig({
        providers: {
          omp: {
            params: {
              agentShell: {
                mode,
                ...(path ? { path } : {}),
              },
            },
          },
        },
      });
      if (!result) throw new Error(t("workspace.terminal.hostDisconnected"));
      return result;
    },
    onError: () => setSelectedMode(persisted.mode),
  });

  const handleModeChange = useCallback(
    (mode: AgentShellMode) => {
      setSelectedMode(mode);
      if (mode !== "custom") mutation.mutate({ mode });
    },
    [mutation],
  );
  const handleSaveCustom = useCallback(() => {
    const path = customPath.trim();
    if (path) mutation.mutate({ mode: "custom", path });
  }, [customPath, mutation]);

  const selectedDisplay = useMemo(() => {
    const selectedOption = options.find((option) => option.value === selectedMode) ?? options[0];
    return { label: selectedOption.label, description: selectedOption.description };
  }, [options, selectedMode]);
  const disabled = !isConnected || config === null || mutation.isPending;
  const error = mutation.error instanceof Error ? mutation.error.message : null;

  return (
    <View style={[settingsStyles.card, styles.card]} testID="host-page-omp-agent-shell-card">
      <Text style={settingsStyles.rowTitle}>{t("settings.providers.omp.shell.title")}</Text>
      <Text style={settingsStyles.rowHint}>{t("settings.providers.omp.shell.description")}</Text>
      <SelectField
        label={t("settings.providers.omp.shell.modeLabel")}
        value={selectedMode}
        selectedDisplay={selectedDisplay}
        options={options}
        onChange={handleModeChange}
        placeholder={t("settings.providers.omp.shell.auto")}
        emptyText={t("settings.providers.omp.shell.auto")}
        disabled={disabled}
        title={t("settings.providers.omp.shell.modeLabel")}
        testID="host-page-omp-agent-shell-mode"
      />
      {selectedMode === "custom" ? (
        <View style={styles.customRow}>
          <Field
            label={t("settings.providers.omp.shell.pathLabel")}
            hint={t("settings.providers.omp.shell.pathHint")}
            error={error}
            testID="host-page-omp-agent-shell-path-field"
          >
            <FormTextInput
              initialValue={customPath}
              resetKey={persisted.path}
              onChangeText={setCustomPath}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("settings.providers.omp.shell.pathPlaceholder")}
              testID="host-page-omp-agent-shell-path"
            />
          </Field>
          <Button
            onPress={handleSaveCustom}
            disabled={disabled || customPath.trim().length === 0}
            testID="host-page-omp-agent-shell-save"
          >
            {mutation.isPending
              ? t("settings.providers.omp.shell.saving")
              : t("settings.providers.omp.shell.save")}
          </Button>
        </View>
      ) : null}
      {selectedMode !== "custom" && error ? (
        <Text style={settingsStyles.rowError}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    marginBottom: theme.spacing[3],
  },
  customRow: {
    gap: theme.spacing[3],
  },
}));
