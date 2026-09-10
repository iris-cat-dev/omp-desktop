import { useCallback, useEffect, useState, type RefCallback } from "react";
import type { View } from "react-native";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import {
  serializeWorkspaceFileDragPayload,
  WORKSPACE_FILE_DRAG_MIME,
} from "@/attachments/workspace-file-drag";
import {
  EXPLORER_ENTRY_DRAG_MIME,
  parseExplorerEntryDragPayload,
  resolveExplorerEntryMove,
  serializeExplorerEntryDragPayload,
  type ExplorerEntryDragPayload,
  type ExplorerEntryMoveRequest,
} from "@/file-explorer/entry-drag";
import type {
  ExplorerEntryDragBinding,
  ExplorerEntryDropTarget,
  UseExplorerEntryDragInput,
} from "./use-entry-drag.types";

let activeExplorerDrag: ExplorerEntryDragPayload | null = null;

function includesExplorerEntry(transfer: DataTransfer | null): transfer is DataTransfer {
  return Boolean(transfer && Array.from(transfer.types).includes(EXPLORER_ENTRY_DRAG_MIME));
}

function readExplorerEntryPayload(transfer: DataTransfer): ExplorerEntryDragPayload | null {
  const serialized = transfer.getData(EXPLORER_ENTRY_DRAG_MIME);
  return serialized ? parseExplorerEntryDragPayload(serialized) : activeExplorerDrag;
}

function isBlockedTarget(event: DragEvent, target: ExplorerEntryDropTarget): boolean {
  if (!target.blockedDescendantSelector || !(event.target instanceof Element)) {
    return false;
  }
  return event.target.closest(target.blockedDescendantSelector) !== null;
}

function resolveMove(
  event: DragEvent,
  target: ExplorerEntryDropTarget,
): ExplorerEntryMoveRequest | null {
  if (!includesExplorerEntry(event.dataTransfer)) {
    return null;
  }
  const payload = readExplorerEntryPayload(event.dataTransfer);
  return payload
    ? resolveExplorerEntryMove({
        payload,
        serverId: target.serverId,
        workspaceId: target.workspaceId,
        parentPath: target.parentPath,
      })
    : null;
}

export function useExplorerEntryDrag({
  source,
  target,
}: UseExplorerEntryDragInput): ExplorerEntryDragBinding {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const dragRef = useCallback<RefCallback<View>>((node) => {
    setElement(node as unknown as HTMLElement | null);
  }, []);

  useEffect(() => {
    if (!element) {
      return;
    }

    const sourceEnabled = Boolean(source && (source.moveEnabled || source.includeChatAttachment));
    element.draggable = sourceEnabled;

    function handleDragStart(event: DragEvent) {
      if (!source || !event.dataTransfer) {
        return;
      }
      if (source.moveEnabled) {
        event.dataTransfer.effectAllowed = source.includeChatAttachment ? "copyMove" : "move";
      } else {
        event.dataTransfer.effectAllowed = "copy";
      }
      if (source.moveEnabled) {
        activeExplorerDrag = source.payload;
        event.dataTransfer.setData(
          EXPLORER_ENTRY_DRAG_MIME,
          serializeExplorerEntryDragPayload(source.payload),
        );
      }
      if (source.includeChatAttachment) {
        event.dataTransfer.setData(
          WORKSPACE_FILE_DRAG_MIME,
          serializeWorkspaceFileDragPayload({
            version: 1,
            serverId: source.payload.serverId,
            workspaceId: source.payload.workspaceId,
            attachment: createWorkspaceFileAttachment({ path: source.payload.path }),
          }),
        );
      }
    }

    function clearDragState() {
      if (source && activeExplorerDrag === source.payload) {
        activeExplorerDrag = null;
      }
      setIsDropTarget(false);
    }

    function handleDragEnter(event: DragEvent) {
      if (!target || isBlockedTarget(event, target) || !includesExplorerEntry(event.dataTransfer)) {
        return;
      }
      event.stopPropagation();
      const request = resolveMove(event, target);
      if (!request) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        setIsDropTarget(false);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setIsDropTarget(true);
    }

    function handleDragOver(event: DragEvent) {
      if (!target || isBlockedTarget(event, target) || !includesExplorerEntry(event.dataTransfer)) {
        return;
      }
      event.stopPropagation();
      const request = resolveMove(event, target);
      if (!request) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        setIsDropTarget(false);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setIsDropTarget(true);
    }

    function handleDragLeave(event: DragEvent) {
      if (!target || !includesExplorerEntry(event.dataTransfer)) {
        return;
      }
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && element?.contains(relatedTarget)) {
        return;
      }
      setIsDropTarget(false);
    }

    function handleDrop(event: DragEvent) {
      if (!target || isBlockedTarget(event, target) || !includesExplorerEntry(event.dataTransfer)) {
        return;
      }
      event.stopPropagation();
      setIsDropTarget(false);
      const request = resolveMove(event, target);
      if (!request) {
        return;
      }
      event.preventDefault();
      target.onMove(request);
    }

    element.addEventListener("dragstart", handleDragStart);
    element.addEventListener("dragend", clearDragState);
    element.addEventListener("dragenter", handleDragEnter);
    element.addEventListener("dragover", handleDragOver);
    element.addEventListener("dragleave", handleDragLeave);
    element.addEventListener("drop", handleDrop);
    return () => {
      element.draggable = false;
      element.removeEventListener("dragstart", handleDragStart);
      element.removeEventListener("dragend", clearDragState);
      element.removeEventListener("dragenter", handleDragEnter);
      element.removeEventListener("dragover", handleDragOver);
      element.removeEventListener("dragleave", handleDragLeave);
      element.removeEventListener("drop", handleDrop);
      if (source && activeExplorerDrag === source.payload) {
        activeExplorerDrag = null;
      }
    };
  }, [element, source, target]);

  return { ref: dragRef, isDropTarget };
}
