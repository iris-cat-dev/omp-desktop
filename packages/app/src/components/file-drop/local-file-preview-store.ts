import { create } from "zustand";
import {
  readExternalPreviewFile,
  type ExternalFilePreviewItem,
  type ExternalFilePreviewResult,
} from "./external-file-preview";

export type LocalFilePreviewEntry = ExternalFilePreviewItem & {
  result: ExternalFilePreviewResult | null;
  loading: boolean;
  mode: "preview" | "source";
};

export interface LocalFilePreviewStore {
  entries: Record<string, LocalFilePreviewEntry>;
  load: (previewId: string) => Promise<void>;
  setMode: (previewId: string, mode: LocalFilePreviewEntry["mode"]) => void;
}

// Deliberately memory-only: neither File handles nor decoded content leave this store.
export const useLocalFilePreviewStore = create<LocalFilePreviewStore>((set, get) => ({
  entries: {},
  load: async (previewId) => {
    const entry = get().entries[previewId];
    if (!entry || entry.loading || entry.result || entry.error || !entry.file) return;
    const file = entry.file;
    set((state) => ({
      entries: { ...state.entries, [previewId]: { ...entry, loading: true } },
    }));
    // IDs are never reused. Closing invalidates pending reads, but unmounting a
    // tab does not: its result and selected mode survive remounts.
    const isCurrent = () => get().entries[previewId]?.file === file;
    const result = await readExternalPreviewFile(file, isCurrent);
    if (!result) return;
    set((state) => {
      const current = state.entries[previewId];
      if (!current || current.file !== file) return state;
      return {
        entries: { ...state.entries, [previewId]: { ...current, result, loading: false } },
      };
    });
  },
  setMode: (previewId, mode) => {
    set((state) => {
      const entry = state.entries[previewId];
      if (!entry || entry.mode === mode) return state;
      return { entries: { ...state.entries, [previewId]: { ...entry, mode } } };
    });
  },
}));

const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let nextPreviewId = 0;

export function createLocalFilePreviews(
  items: ExternalFilePreviewItem[],
): Array<{ kind: "local_file"; previewId: string; name: string }> {
  const entries: Record<string, LocalFilePreviewEntry> = {};
  const targets = items.map((item) => {
    const previewId = `local_file_${sessionId}_${++nextPreviewId}`;
    entries[previewId] = { ...item, result: null, loading: false, mode: "preview" };
    return { kind: "local_file" as const, previewId, name: item.name };
  });
  if (targets.length > 0) {
    useLocalFilePreviewStore.setState((state) => ({ entries: { ...state.entries, ...entries } }));
  }
  return targets;
}

export function releaseUnusedLocalFilePreviews(retainedIds: ReadonlySet<string>): void {
  useLocalFilePreviewStore.setState((state) => {
    let entries: Record<string, LocalFilePreviewEntry> | undefined;
    for (const previewId of Object.keys(state.entries)) {
      if (retainedIds.has(previewId)) continue;
      entries ??= { ...state.entries };
      delete entries[previewId];
    }
    return entries ? { entries } : state;
  });
}
