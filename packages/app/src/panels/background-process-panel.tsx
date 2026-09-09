import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { BackgroundProcessOutput } from "@omp-desktop/protocol/background-processes";
import { Terminal } from "lucide-react-native";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useBackgroundProcesses } from "@/background-processes/query";
import { useFetchQuery } from "@/data/query";
import TerminalEmulator, { type TerminalEmulatorHandle } from "@/components/terminal-emulator";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { toXtermTheme } from "@/utils/to-xterm-theme";
import type { Theme } from "@/styles/theme";
import type { TerminalRendererReadyChange } from "@/utils/terminal-renderer-readiness";
import { usePaneContext, usePaneFocus } from "./pane-context";
import type { PanelRegistration } from "./panel-registry";

// Both xterm scrollback and a byte-independent character budget bound retained display.
const MAX_DISPLAY_CHARACTERS = 1_000_000;
const DOM_PROPS = { style: { flex: 1 }, matchContents: false };
const outputEncoder = new TextEncoder();
const ThemedTerminalEmulator = withUnistyles(TerminalEmulator);
const terminalThemeMapping = (theme: Theme) => ({
  xtermTheme: toXtermTheme(theme.colors.terminal),
});

function normalizeOutputText(
  chunk: BackgroundProcessOutput,
  trailingCarriageReturn: boolean,
): { text: string; trailingCarriageReturn: boolean } {
  if (chunk.format !== "text") {
    return {
      text: chunk.text,
      trailingCarriageReturn: chunk.text.endsWith("\r"),
    };
  }
  const continuedNewline = !chunk.reset && trailingCarriageReturn && chunk.text.startsWith("\n");
  let text = chunk.text.replace(/(?<!\r)\n/g, "\r\n");
  if (continuedNewline) text = text.slice(1);
  return {
    text,
    trailingCarriageReturn: chunk.text.endsWith("\r"),
  };
}

function shouldFetchOutput(
  ready: boolean,
  retainedActive: boolean,
  appVisible: boolean,
  workspaceFocused: boolean,
  connected: boolean,
  hasClient: boolean,
): boolean {
  return ready && retainedActive && appVisible && workspaceFocused && connected && hasClient;
}

function BackgroundProcessPanel() {
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "background_process", "BackgroundProcessPanel requires process target");
  return (
    <BackgroundProcessOutput
      key={`${target.agentId.length}:${target.agentId}:${target.processId}`}
      serverId={serverId}
      agentId={target.agentId}
      processId={target.processId}
    />
  );
}

function BackgroundProcessOutput({
  serverId,
  agentId,
  processId,
}: {
  serverId: string;
  agentId: string;
  processId: string;
}) {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const retainedActive = useRetainedPanelActive();
  const appVisible = useAppVisible();
  const { isWorkspaceFocused } = usePaneFocus();
  // A retained output pane must keep lifecycle status fresh even after its chat closes.
  const processes = useBackgroundProcesses(serverId, agentId, isWorkspaceFocused);
  const process = processes.processes.find((entry) => entry.id === processId);
  const emulator = useRef<TerminalEmulatorHandle>(null);
  const cursor = useRef<number | undefined>(undefined);
  const displayedCharacters = useRef(0);
  const appliedChunk = useRef<unknown>(null);
  const trailingCarriageReturn = useRef(false);
  const [truncated, setTruncated] = useState(false);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const [hasRenderedOutput, setHasRenderedOutput] = useState(false);
  const instanceId = useId();
  const streamKey = JSON.stringify([serverId, agentId, processId]);
  const onRendererReadyChange = useCallback(
    (change: TerminalRendererReadyChange) => {
      if (change.streamKey !== streamKey) return;
      cursor.current = undefined;
      displayedCharacters.current = 0;
      setReady(change.isReady);
      if (change.isReady) setRendererGeneration((generation) => generation + 1);
    },
    [streamKey],
  );
  const onResize = useCallback(() => {
    cursor.current = undefined;
    displayedCharacters.current = 0;
    setRendererGeneration((generation) => generation + 1);
  }, []);
  const output = useFetchQuery({
    // Each renderer owns its cursor. Cached chunks must never replay into another renderer.
    queryKey: [
      "background-process-output",
      serverId,
      agentId,
      processId,
      instanceId,
      rendererGeneration,
    ],
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const response = await client.getBackgroundProcessOutput(agentId, processId, cursor.current);
      if (response.error) throw new Error(response.error);
      if (!response.output) throw new Error(t("backgroundProcesses.outputUnavailable"));
      return response.output;
    },
    enabled: shouldFetchOutput(
      ready,
      retainedActive,
      appVisible,
      isWorkspaceFocused,
      connected,
      Boolean(client),
    ),
    refetchInterval: 1_000,
    dataShape: "value",
    staleTimeMs: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  useEffect(() => {
    const chunk = output.data;
    if (!chunk || !ready || !emulator.current || appliedChunk.current === chunk) return;
    appliedChunk.current = chunk;
    const normalized = normalizeOutputText(chunk, trailingCarriageReturn.current);
    const text = normalized.text;
    trailingCarriageReturn.current = normalized.trailingCarriageReturn;
    // restoreOutput resets terminal parser and screen, unlike clearing scrollback alone.
    const exceedsBudget = displayedCharacters.current + text.length > MAX_DISPLAY_CHARACTERS;
    if (chunk.reset || exceedsBudget) {
      emulator.current.restoreOutput(outputEncoder.encode(text.slice(-MAX_DISPLAY_CHARACTERS)));
      displayedCharacters.current = Math.min(text.length, MAX_DISPLAY_CHARACTERS);
      setTruncated(chunk.truncated || exceedsBudget || text.length > MAX_DISPLAY_CHARACTERS);
    } else {
      emulator.current.writeOutput(outputEncoder.encode(text));
      displayedCharacters.current += text.length;
      if (chunk.truncated) setTruncated(true);
    }
    cursor.current = chunk.cursor;
    setHasRenderedOutput(true);
  }, [output.data, output.dataUpdatedAt, ready]);
  const error = !connected
    ? t("backgroundProcesses.disconnected")
    : (output.error?.message ?? processes.error);
  return (
    <View style={styles.root} testID="background-process-panel">
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {process?.name ?? t("backgroundProcesses.title")}
        </Text>
        <Text style={styles.detail}>
          {t(`backgroundProcesses.status.${error ? "unknown" : (process?.status ?? "unknown")}`)}
        </Text>
        {process?.exitCode != null ? (
          <Text style={styles.detail}>
            {t("backgroundProcesses.exitCode", { code: process.exitCode })}
          </Text>
        ) : null}
        <Text style={styles.detail}>{t("backgroundProcesses.readOnly")}</Text>
      </View>
      {process ? (
        <Text style={styles.command} numberOfLines={2}>
          {process.command}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {truncated ? <Text style={styles.notice}>{t("backgroundProcesses.truncated")}</Text> : null}
      {output.isLoading && !hasRenderedOutput ? (
        <Text style={styles.notice}>{t("backgroundProcesses.loading")}</Text>
      ) : null}
      <View style={styles.output}>
        <ThemedTerminalEmulator
          ref={emulator}
          dom={DOM_PROPS}
          streamKey={streamKey}
          supportsTerminalInputModeReplay={false}
          testId="background-process-output"
          scrollbackLines={Math.min(settings.terminalScrollbackLines, 10_000)}
          fontFamily={settings.monoFontFamily}
          fontSize={settings.codeFontSize}
          uniProps={terminalThemeMapping}
          onRendererReadyChange={onRendererReadyChange}
          onResize={onResize}
        />
      </View>
    </View>
  );
}

export const backgroundProcessPanelRegistration: PanelRegistration<"background_process"> = {
  kind: "background_process",
  resourceKey: (target) => JSON.stringify([target.agentId, target.processId]),
  component: BackgroundProcessPanel,
  useDescriptor(target, context) {
    const { t } = useTranslation();
    const { processes } = useBackgroundProcesses(context.serverId, target.agentId, false);
    const process = processes.find((entry) => entry.id === target.processId);
    const label = process?.name ?? t("backgroundProcesses.title");
    return {
      label,
      subtitle: t("backgroundProcesses.readOnly"),
      tooltip: process?.command ?? label,
      titleState: "ready",
      icon: Terminal,
      statusBucket: null,
    };
  },
};

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, flexWrap: "wrap" },
  name: { color: theme.colors.foreground, fontSize: 12, flexShrink: 1 },
  detail: { color: theme.colors.foregroundMuted, fontSize: 11 },
  command: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  error: { color: theme.colors.destructive, fontSize: 12, padding: 10 },
  notice: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  output: { flex: 1, minHeight: 0 },
}));
