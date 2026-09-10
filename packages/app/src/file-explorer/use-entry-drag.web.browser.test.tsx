import React, { act, useCallback, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text, View } from "react-native";
import { afterEach, describe, expect, it } from "vitest";
import { WORKSPACE_FILE_DRAG_MIME } from "@/attachments/workspace-file-drag";
import { EXPLORER_ENTRY_DRAG_MIME, type ExplorerEntryMoveRequest } from "./entry-drag";
import { useExplorerEntryDrag } from "./use-entry-drag";

interface MountedHarness {
  root: Root;
  container: HTMLDivElement;
}

interface MountedDragHarness extends MountedHarness {
  source: HTMLElement;
  target: HTMLElement;
  targetState: HTMLElement;
}

interface MountedRootRoutingHarness extends MountedHarness {
  source: HTMLElement;
  rootSurface: HTMLElement;
  folderTarget: HTMLElement;
  rootState: HTMLElement;
  folderState: HTMLElement;
}

const mountedHarnesses: MountedHarness[] = [];

function DragHarness({ moves }: { moves: ExplorerEntryMoveRequest[] }) {
  const onMove = useCallback((request: ExplorerEntryMoveRequest) => moves.push(request), [moves]);
  const source = useMemo(
    () => ({
      payload: {
        version: 1 as const,
        serverId: "server-1",
        workspaceId: "workspace-1",
        path: "src/app.ts",
        kind: "file" as const,
      },
      includeChatAttachment: true,
      moveEnabled: true,
    }),
    [],
  );
  const target = useMemo(
    () => ({
      serverId: "server-1",
      workspaceId: "workspace-1",
      parentPath: "archive",
      onMove,
    }),
    [onMove],
  );
  const sourceDrag = useExplorerEntryDrag({ source });
  const targetDrag = useExplorerEntryDrag({ target });

  return (
    <View>
      <View ref={sourceDrag.ref} testID="drag-source" />
      <View ref={targetDrag.ref} testID="drop-target" />
      <Text testID="drop-target-state">{String(targetDrag.isDropTarget)}</Text>
    </View>
  );
}

function RootRoutingHarness({
  rootMoves,
  folderMoves,
}: {
  rootMoves: ExplorerEntryMoveRequest[];
  folderMoves: ExplorerEntryMoveRequest[];
}) {
  const onRootMove = useCallback(
    (request: ExplorerEntryMoveRequest) => rootMoves.push(request),
    [rootMoves],
  );
  const onFolderMove = useCallback(
    (request: ExplorerEntryMoveRequest) => folderMoves.push(request),
    [folderMoves],
  );
  const source = useMemo(
    () => ({
      payload: {
        version: 1 as const,
        serverId: "server-1",
        workspaceId: "workspace-1",
        path: "src/nested",
        kind: "directory" as const,
      },
      includeChatAttachment: false,
      moveEnabled: true,
    }),
    [],
  );
  const rootTarget = useMemo(
    () => ({
      serverId: "server-1",
      workspaceId: "workspace-1",
      parentPath: ".",
      blockedDescendantSelector: '[data-testid="folder-owner"]',
      onMove: onRootMove,
    }),
    [onRootMove],
  );
  const folderTarget = useMemo(
    () => ({
      serverId: "server-1",
      workspaceId: "workspace-1",
      parentPath: "archive",
      onMove: onFolderMove,
    }),
    [onFolderMove],
  );
  const sourceDrag = useExplorerEntryDrag({ source });
  const rootDrag = useExplorerEntryDrag({ target: rootTarget });
  const folderDrag = useExplorerEntryDrag({ target: folderTarget });

  return (
    <View>
      <View ref={sourceDrag.ref} testID="root-routing-source" />
      <View ref={rootDrag.ref} testID="root-target">
        <View testID="root-file-surface" />
        <View testID="folder-owner">
          <View ref={folderDrag.ref} testID="folder-target" />
        </View>
      </View>
      <Text testID="root-target-state">{String(rootDrag.isDropTarget)}</Text>
      <Text testID="folder-target-state">{String(folderDrag.isDropTarget)}</Text>
    </View>
  );
}

function requireElement(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`Missing ${testId}`);
  }
  return element;
}

function mountDragHarness(moves: ExplorerEntryMoveRequest[]): MountedDragHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<DragHarness moves={moves} />));
  const mounted = {
    root,
    container,
    source: requireElement(container, "drag-source"),
    target: requireElement(container, "drop-target"),
    targetState: requireElement(container, "drop-target-state"),
  };
  mountedHarnesses.push(mounted);
  return mounted;
}

function mountRootRoutingHarness(
  rootMoves: ExplorerEntryMoveRequest[],
  folderMoves: ExplorerEntryMoveRequest[],
): MountedRootRoutingHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<RootRoutingHarness rootMoves={rootMoves} folderMoves={folderMoves} />));
  const mounted = {
    root,
    container,
    source: requireElement(container, "root-routing-source"),
    rootSurface: requireElement(container, "root-file-surface"),
    folderTarget: requireElement(container, "folder-target"),
    rootState: requireElement(container, "root-target-state"),
    folderState: requireElement(container, "folder-target-state"),
  };
  mountedHarnesses.push(mounted);
  return mounted;
}

afterEach(() => {
  for (const mounted of mountedHarnesses.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("explorer entry web drag", () => {
  it("advertises chat copy and explorer move, then moves onto a folder", () => {
    const moves: ExplorerEntryMoveRequest[] = [];
    const { source, target, targetState } = mountDragHarness(moves);
    const transfer = new DataTransfer();

    act(() => {
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    });
    expect(source.draggable).toBe(true);
    expect(Array.from(transfer.types)).toEqual(
      expect.arrayContaining([EXPLORER_ENTRY_DRAG_MIME, WORKSPACE_FILE_DRAG_MIME]),
    );

    let dragOver!: DragEvent;
    act(() => {
      dragOver = new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
      target.dispatchEvent(dragOver);
    });
    expect(dragOver.defaultPrevented).toBe(true);
    expect(targetState.textContent).toBe("true");

    act(() => {
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    });
    expect(moves).toEqual([{ path: "src/app.ts", parentPath: "archive", kind: "file" }]);
    expect(targetState.textContent).toBe("false");
  });

  it("routes the whole root surface while child folders take priority", () => {
    const rootMoves: ExplorerEntryMoveRequest[] = [];
    const folderMoves: ExplorerEntryMoveRequest[] = [];
    const { source, rootSurface, folderTarget, rootState, folderState } = mountRootRoutingHarness(
      rootMoves,
      folderMoves,
    );
    const folderTransfer = new DataTransfer();

    act(() => {
      source.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer: folderTransfer }),
      );
      rootSurface.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: folderTransfer,
        }),
      );
    });
    expect(rootState.textContent).toBe("true");

    act(() => {
      folderTarget.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: folderTransfer,
        }),
      );
    });
    expect(rootState.textContent).toBe("false");
    expect(folderState.textContent).toBe("true");

    act(() => {
      folderTarget.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: folderTransfer,
        }),
      );
    });
    expect(rootMoves).toEqual([]);
    expect(folderMoves).toEqual([{ path: "src/nested", parentPath: "archive", kind: "directory" }]);

    const rootTransfer = new DataTransfer();
    act(() => {
      source.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer: rootTransfer }),
      );
      rootSurface.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: rootTransfer,
        }),
      );
      rootSurface.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: rootTransfer,
        }),
      );
    });
    expect(rootMoves).toEqual([{ path: "src/nested", parentPath: ".", kind: "directory" }]);
  });
});
