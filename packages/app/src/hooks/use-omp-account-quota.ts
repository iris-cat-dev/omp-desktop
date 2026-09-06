import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";
import { useFetchQuery } from "@/data/query";
import type { OmpProviderManagement } from "@omp-desktop/protocol/messages";
import { loadOmpProviderAccountNotes } from "@/components/omp-provider-account-notes";
import { resolveOmpModelProviderNamespace } from "@/provider-selection/omp-model-provider";
import { useSessionStore } from "@/stores/session-store";

type OmpAccountQuotaAccount = NonNullable<
  OmpProviderManagement["loginProviders"][number]["accounts"]
>[number];

export type OmpAccountQuotaDisplayAccount = OmpAccountQuotaAccount & { note?: string };

export function ompAccountQuotaQueryKey(serverId: string) {
  return ["ompWorkflowQuota", serverId] as const;
}

function isCodexProvider(provider: string | undefined, modelId: string | null): boolean {
  if (provider === "openai-codex") return true;
  return provider === "omp" && resolveOmpModelProviderNamespace(modelId ?? "") === "openai-codex";
}

interface OmpProviderManagementClient {
  getOmpProviderManagement(): Promise<OmpProviderManagement>;
}

function needsInitialQuotaRetry(management: OmpProviderManagement): boolean {
  const codex = management.loginProviders.find((provider) => provider.id === "openai-codex");
  if (!codex?.authenticated) return false;
  if (!codex.accounts || codex.accounts.length === 0) return true;
  return codex.accounts.some((account) => account.quota?.status !== "available");
}

function waitForInitialQuotaRetry(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 750);
  return promise;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export async function fetchOmpAccountQuotaManagement(
  client: OmpProviderManagementClient,
  waitForRetry: () => Promise<void> = waitForInitialQuotaRetry,
): Promise<OmpProviderManagement> {
  const first = await client.getOmpProviderManagement();
  if (!needsInitialQuotaRetry(first)) return first;
  await waitForRetry();
  return client.getOmpProviderManagement().catch(() => first);
}

export interface OmpCodexAccountQuotaResult {
  accounts: OmpAccountQuotaDisplayAccount[];
  provider: OmpProviderManagement["loginProviders"][number] | null;
  loading: boolean;
  error: string | null;
  updatedAt: string | null;
  refresh: () => Promise<void>;
}

export function useOmpCodexAccountQuota(
  serverId: string | null | undefined,
  enabled = true,
): OmpCodexAccountQuotaResult {
  const client = useSessionStore((state) => state.sessions[serverId ?? ""]?.client ?? null);
  const supportsOmpProviderManagement = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.ompProviderManagement === true,
  );
  const canFetch = Boolean(client && supportsOmpProviderManagement);
  const active = enabled && canFetch;
  const query = useFetchQuery({
    queryKey: ompAccountQuotaQueryKey(serverId ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("OMP provider management is unavailable");
      return fetchOmpAccountQuotaManagement(client);
    },
    enabled: active,
    dataShape: "value",
    staleTimeMs: 0,
    refetchInterval: 300_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const notesQuery = useFetchQuery({
    queryKey: ["ompProviderAccountNotes", serverId ?? ""],
    queryFn: () => loadOmpProviderAccountNotes(AsyncStorage, serverId ?? undefined),
    enabled: Boolean(serverId && active),
    dataShape: "value",
    staleTimeMs: 0,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const refetchQuota = query.refetch;
  const refetchNotes = notesQuery.refetch;
  const refresh = useCallback(async () => {
    if (!active) return;
    await Promise.all([refetchQuota(), refetchNotes()]);
  }, [active, refetchNotes, refetchQuota]);
  const provider = active
    ? (query.data?.loginProviders.find((entry) => entry.id === "openai-codex") ?? null)
    : null;
  const accounts = (provider?.accounts ?? []).map((account) =>
    Object.assign({}, account, {
      note: notesQuery.data?.[String(account.credentialId)],
    }),
  );
  const updatedAtMs = query.dataUpdatedAt || query.errorUpdatedAt;

  return {
    accounts,
    provider,
    loading: active && (query.isFetching || notesQuery.isFetching),
    error: active && query.isError ? errorMessage(query.error) : null,
    updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null,
    refresh,
  };
}

export function useOmpAccountQuota(
  serverId: string | null | undefined,
  provider: string | null | undefined,
  modelId: string | null | undefined,
): { accounts: OmpAccountQuotaDisplayAccount[]; loading: boolean } {
  const shouldFetch = isCodexProvider(provider ?? undefined, modelId ?? null);
  const query = useOmpCodexAccountQuota(serverId, shouldFetch);
  return {
    accounts: shouldFetch ? query.accounts : [],
    loading: shouldFetch && query.loading,
  };
}
