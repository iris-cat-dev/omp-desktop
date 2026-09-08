import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { SharedValue } from "react-native-reanimated";
import type { ImageAttachment } from "@/composer/types";
import { getDesktopHost } from "@/desktop/host";
import { persistAttachmentFromBlob } from "@/attachments/service";
import { isRasterImageFile, resolveRasterImageMimeType } from "@/attachments/file-types";
import { isWeb } from "@/constants/platform";
import type { FileDropSink } from "./types";
import {
  parseWorkspaceFileDragPayload,
  WORKSPACE_FILE_DRAG_MIME,
} from "@/attachments/workspace-file-drag";
import { createDroppedItems } from "./desktop-dropped-items";

async function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  const mimeType = resolveRasterImageMimeType({ mimeType: file.type, path: file.name });
  if (!mimeType) {
    throw new Error(`Unsupported image type for '${file.name}'.`);
  }
  return await persistAttachmentFromBlob({
    blob: file,
    mimeType,
    fileName: file.name,
  });
}

interface UseDropListenersOptions {
  isDragging: SharedValue<boolean>;
  /** Active sink can't accept right now: reject drops without showing acceptance. */
  suppressed: SharedValue<boolean>;
  /** Whether a consumer is mounted: with none, don't advertise or accept drops. */
  hasSink: SharedValue<boolean>;
  /** Stable getter for the currently registered sink. */
  getSink: () => FileDropSink | null;
  disabled: boolean;
}

/**
 * Attaches web/desktop drag-and-drop listeners to the returned element ref. Drag state is
 * written to a shared value (no React renders); dropped files are routed to the active sink.
 */
export function useDropListeners({
  isDragging,
  suppressed,
  hasSink,
  getSink,
  disabled,
}: UseDropListenersOptions): RefObject<HTMLElement | null> {
  const containerRef = useRef<HTMLElement | null>(null);
  const dragCounter = useRef(0);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  // Clear an in-progress drag when the zone becomes disabled.
  useEffect(() => {
    if (disabled) {
      isDragging.value = false;
      dragCounter.current = 0;
    }
  }, [disabled, isDragging]);

  useEffect(() => {
    if (!isWeb) return;

    let cleanup: (() => void) | undefined;

    function setupDomDragDrop() {
      const element = containerRef.current;
      if (!element) {
        return;
      }

      function handleDragEnter(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (disabledRef.current) return;

        dragCounter.current++;
        if (suppressed.value || !hasSink.value) return;
        const types = new Set(e.dataTransfer?.types ?? []);
        const acceptsWorkspaceFile =
          types.has(WORKSPACE_FILE_DRAG_MIME) && Boolean(getSink()?.onWorkspaceFile);
        if (types.has("Files") || acceptsWorkspaceFile) {
          isDragging.value = true;
        }
      }

      function handleDragOver(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (!e.dataTransfer) return;
        // Only advertise "copy" when the drop would actually be accepted, so the cursor doesn't
        // promise a drop that the handler then discards (suppressed/archived/no consumer mounted).
        const types = new Set(e.dataTransfer.types);
        const acceptsWorkspaceFile =
          types.has(WORKSPACE_FILE_DRAG_MIME) && Boolean(getSink()?.onWorkspaceFile);
        const acceptsDrop = types.has("Files") || acceptsWorkspaceFile;
        const canAccept = acceptsDrop && !disabledRef.current && !suppressed.value && hasSink.value;
        e.dataTransfer.dropEffect = canAccept ? "copy" : "none";
      }

      function handleDragLeave(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (disabledRef.current) return;

        dragCounter.current--;
        if (dragCounter.current === 0) {
          isDragging.value = false;
        }
      }

      async function handleDrop(e: DragEvent) {
        // Claim input-area drops even when disabled; never fall through to document preview.
        e.preventDefault();
        e.stopPropagation();

        isDragging.value = false;
        dragCounter.current = 0;

        if (disabledRef.current || suppressed.value) return;

        const sink = getSink();
        if (!sink) return;

        const serializedWorkspaceFile = e.dataTransfer?.getData(WORKSPACE_FILE_DRAG_MIME);
        if (serializedWorkspaceFile && sink.onWorkspaceFile) {
          const payload = parseWorkspaceFileDragPayload(serializedWorkspaceFile);
          if (payload) {
            sink.onWorkspaceFile(payload);
          }
        }

        const files = Array.from(e.dataTransfer?.files ?? []);
        const transferItems = Array.from(e.dataTransfer?.items ?? []).filter(
          (item) => item.kind === "file",
        );
        const genericItems = createDroppedItems({
          files,
          transferItems,
          getPathForFile: getDesktopHost()?.webUtils?.getPathForFile,
        });

        if (sink.onGenericFiles && genericItems.length > 0) {
          sink.onGenericFiles(genericItems);
        }

        const imageFiles = files.filter(isRasterImageFile);

        if (imageFiles.length === 0) return;

        try {
          const attachments = await Promise.all(imageFiles.map(fileToImageAttachment));
          // No post-persist busy re-check: a mixed drop's own generic upload flips the busy flag,
          // and re-checking would discard the image from the same drop. The guard at drop start
          // already rejects drops that begin while busy.
          sink.onFiles(attachments);
        } catch (error) {
          console.error("[useDropListeners] Failed to process dropped files:", error);
        }
      }

      element.addEventListener("dragenter", handleDragEnter);
      element.addEventListener("dragover", handleDragOver);
      element.addEventListener("dragleave", handleDragLeave);
      element.addEventListener("drop", handleDrop);

      cleanup = () => {
        element.removeEventListener("dragenter", handleDragEnter);
        element.removeEventListener("dragover", handleDragOver);
        element.removeEventListener("dragleave", handleDragLeave);
        element.removeEventListener("drop", handleDrop);
      };
    }

    // Window-scoped desktop events cannot identify the intended input. Electron uses DOM
    // events here, with native paths resolved through webUtils when processing the drop.
    setupDomDragDrop();
    return () => cleanup?.();
  }, [isDragging, suppressed, hasSink, getSink]);

  return containerRef;
}
