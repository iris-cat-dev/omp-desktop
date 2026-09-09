import { Terminal } from "lucide-react-native";
import { Fragment, useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BackgroundProcess } from "@omp-desktop/protocol/background-processes";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import type { Theme } from "@/styles/theme";
import { isBackgroundProcessRunning, type BackgroundProcessesState } from "./query";

const ThemedTerminal = withUnistyles(Terminal);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const trackIcon = <ThemedTerminal size={14} uniProps={foregroundMutedColorMapping} />;
const processScopes = ["agent", "workspace"] as const;

function BackgroundProcessRow({
  process,
  unavailable,
  onOpen,
}: {
  process: BackgroundProcess;
  unavailable: boolean;
  onOpen: (process: BackgroundProcess) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onOpen(process), [onOpen, process]);
  const status = unavailable ? "unknown" : process.status;
  return (
    <ComposerTrackRow
      testID={`background-process-${process.id}`}
      accessibilityLabel={`${process.name}: ${t(`backgroundProcesses.status.${process.status}`)}`}
      onPress={handlePress}
    >
      <ThemedTerminal size={14} uniProps={foregroundMutedColorMapping} />
      <View style={styles.body}>
        <View style={styles.heading}>
          <Text style={styles.name} numberOfLines={1}>
            {process.name}
          </Text>
          <Text style={styles.detail}>{t(`backgroundProcesses.status.${status}`)}</Text>
        </View>
        <Text style={styles.detail} numberOfLines={1}>
          {process.command}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {process.cwd}
        </Text>
        {process.exitCode !== null ? (
          <Text style={styles.detail}>
            {t("backgroundProcesses.exitCode", { code: process.exitCode })}
          </Text>
        ) : null}
      </View>
    </ComposerTrackRow>
  );
}

export function BackgroundProcessesTrack({
  state,
  onOpen,
}: {
  state: BackgroundProcessesState;
  onOpen: (process: BackgroundProcess) => void;
}) {
  const { t } = useTranslation();
  if (state.processes.length === 0 && !state.error) return null;
  const running = state.processes.filter(isBackgroundProcessRunning).length;
  const bucket = !state.error && running > 0 ? ("running" as const) : null;
  let segmentText = t("backgroundProcesses.running", { count: running });
  if (state.error) {
    segmentText = t(
      state.isConnected
        ? "backgroundProcesses.unavailable"
        : "backgroundProcesses.disconnectedShort",
    );
  }
  const segments = [{ bucket, text: segmentText }];
  return (
    <ComposerTrackPill
      testID="background-processes-track"
      panelTitle={t("backgroundProcesses.title")}
      accessibilityLabel={state.error ?? t("backgroundProcesses.running", { count: running })}
      icon={trackIcon}
      segments={segments}
    >
      {state.error ? (
        <ComposerTrackRow>
          <Text style={styles.error}>{state.error}</Text>
        </ComposerTrackRow>
      ) : null}
      {processScopes.map((scope) => {
        const rows = state.processes.filter((process) => process.scope === scope);
        if (rows.length === 0) return null;
        return (
          <Fragment key={scope}>
            <ComposerTrackRow>
              <Text style={styles.group}>{t(`backgroundProcesses.scope.${scope}`)}</Text>
            </ComposerTrackRow>
            {rows.map((process) => (
              <BackgroundProcessRow
                key={process.id}
                process={process}
                unavailable={Boolean(state.error)}
                onOpen={onOpen}
              />
            ))}
          </Fragment>
        );
      })}
    </ComposerTrackPill>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, minWidth: 0, gap: 3 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
  detail: { color: theme.colors.foregroundMuted, fontSize: 11 },
  group: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" },
  error: { color: theme.colors.destructive, fontSize: 12, flexShrink: 1 },
}));
