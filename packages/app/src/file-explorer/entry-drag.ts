import { parentExplorerPath } from "@/utils/explorer-paths";

export const EXPLORER_ENTRY_DRAG_MIME = "application/x-paseo-explorer-entry+json";

export interface ExplorerEntryDragPayload {
  version: 1;
  serverId: string;
  workspaceId: string;
  path: string;
  kind: "file" | "directory";
}

export interface ExplorerEntryMoveRequest {
  path: string;
  parentPath: string;
  kind: "file" | "directory";
}

export function serializeExplorerEntryDragPayload(payload: ExplorerEntryDragPayload): string {
  return JSON.stringify(payload);
}

export function parseExplorerEntryDragPayload(serialized: string): ExplorerEntryDragPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.serverId !== "string" ||
    record.serverId.length === 0 ||
    typeof record.workspaceId !== "string" ||
    record.workspaceId.length === 0 ||
    typeof record.path !== "string" ||
    record.path.length === 0 ||
    (record.kind !== "file" && record.kind !== "directory")
  ) {
    return null;
  }
  return {
    version: 1,
    serverId: record.serverId,
    workspaceId: record.workspaceId,
    path: record.path,
    kind: record.kind,
  };
}

export function resolveExplorerEntryMove(input: {
  payload: ExplorerEntryDragPayload;
  serverId: string;
  workspaceId: string;
  parentPath: string;
}): ExplorerEntryMoveRequest | null {
  const { payload, serverId, workspaceId, parentPath } = input;
  if (payload.serverId !== serverId || payload.workspaceId !== workspaceId) {
    return null;
  }
  if (payload.path === "." || parentExplorerPath(payload.path) === parentPath) {
    return null;
  }
  if (
    payload.kind === "directory" &&
    (parentPath === payload.path || parentPath.startsWith(`${payload.path}/`))
  ) {
    return null;
  }
  return { path: payload.path, parentPath, kind: payload.kind };
}
