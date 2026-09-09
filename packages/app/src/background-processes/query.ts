import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import type { BackgroundProcess } from "@omp-desktop/protocol/background-processes";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export const backgroundProcessesQueryKey = (serverId: string, agentId: string) =>
  ["background-processes", serverId, agentId] as const;

const RUNNING_STATUSES: Partial<Record<BackgroundProcess["status"], true>> = {
  starting: true,
  running: true,
  ready: true,
  restarting: true,
  stopping: true,
};

export function isBackgroundProcessRunning(process: BackgroundProcess): boolean {
  return RUNNING_STATUSES[process.status] === true;
}

function resolveBackgroundProcessesError(
  isSupported: boolean,
  isConnected: boolean,
  disconnectedMessage: string,
  queryError: string | undefined,
  responseError: string | null | undefined,
): string | null {
  if (!isSupported) return null;
  if (!isConnected) return disconnectedMessage;
  return queryError ?? responseError ?? null;
}

export function useBackgroundProcesses(serverId: string, agentId: string, enabled = true) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.backgroundProcesses === true,
  );
  const retainedActive = useRetainedPanelActive();
  const appVisible = useAppVisible();
  const query = useFetchQuery({
    queryKey: backgroundProcessesQueryKey(serverId, agentId),
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return client.listBackgroundProcesses(agentId);
    },
    enabled:
      enabled &&
      isSupported &&
      retainedActive &&
      appVisible &&
      isConnected &&
      !!client &&
      !!agentId,
    dataShape: "value",
    refetchInterval: 2_000,
    staleTimeMs: 0,
    retry: false,
  });
  const processes = query.data?.processes ?? [];
  const error = resolveBackgroundProcessesError(
    isSupported,
    isConnected,
    t("backgroundProcesses.disconnected"),
    query.error?.message,
    query.data?.error,
  );
  return { processes, error, isConnected, isLoading: query.isLoading };
}

export type BackgroundProcessesState = ReturnType<typeof useBackgroundProcesses>;
