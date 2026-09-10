import { describe, expect, it } from "vitest";
import {
  parseExplorerEntryDragPayload,
  resolveExplorerEntryMove,
  serializeExplorerEntryDragPayload,
  type ExplorerEntryDragPayload,
} from "./entry-drag";

function payload(overrides: Partial<ExplorerEntryDragPayload> = {}): ExplorerEntryDragPayload {
  return {
    version: 1,
    serverId: "server-1",
    workspaceId: "workspace-1",
    path: "src/app.ts",
    kind: "file",
    ...overrides,
  };
}

describe("explorer entry drag", () => {
  it("round-trips the source workspace and entry", () => {
    const dragged = payload();
    expect(parseExplorerEntryDragPayload(serializeExplorerEntryDragPayload(dragged))).toEqual(
      dragged,
    );
    expect(parseExplorerEntryDragPayload("not json")).toBeNull();
  });

  it("resolves a move only for a different folder in the same workspace", () => {
    const dragged = payload();
    expect(
      resolveExplorerEntryMove({
        payload: dragged,
        serverId: "server-1",
        workspaceId: "workspace-1",
        parentPath: "archive",
      }),
    ).toEqual({ path: "src/app.ts", parentPath: "archive", kind: "file" });
    expect(
      resolveExplorerEntryMove({
        payload: dragged,
        serverId: "server-1",
        workspaceId: "workspace-1",
        parentPath: "src",
      }),
    ).toBeNull();
    expect(
      resolveExplorerEntryMove({
        payload: dragged,
        serverId: "server-1",
        workspaceId: "workspace-2",
        parentPath: "archive",
      }),
    ).toBeNull();
  });

  it("rejects moving a folder into itself or a descendant", () => {
    const dragged = payload({ path: "src/components", kind: "directory" });
    for (const parentPath of ["src/components", "src/components/nested"]) {
      expect(
        resolveExplorerEntryMove({
          payload: dragged,
          serverId: "server-1",
          workspaceId: "workspace-1",
          parentPath,
        }),
      ).toBeNull();
    }
  });
});
