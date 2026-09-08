import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  collectAllTabs,
  FOCUSED_PANE_PLACEMENT,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import { collectExternalPreviewItems, isExternalFileTransfer } from "./external-file-preview";
import {
  createLocalFilePreviews,
  releaseUnusedLocalFilePreviews,
} from "./local-file-preview-store";

// A local-only tab collection for drops made before a workspace is open.
export const LOCAL_FILE_PREVIEW_WORKSPACE_KEY = "local-file-previews";

export function ExternalFileDropPreview() {
  return isWeb ? <WebExternalFileDropPreview /> : null;
}

function WebExternalFileDropPreview() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const routeRef = useRef(pathname);
  routeRef.current = pathname;
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let pending = false;
    let active = true;
    const unsubscribe = useWorkspaceLayoutStore.subscribe((state, previous) => {
      if (state.layoutByWorkspace === previous.layoutByWorkspace || pending) return;
      pending = true;
      // A multi-file drop inserts all tabs synchronously before collection runs.
      queueMicrotask(() => {
        pending = false;
        if (!active) return;
        const retained = new Set<string>();
        for (const layout of Object.values(useWorkspaceLayoutStore.getState().layoutByWorkspace)) {
          for (const tab of collectAllTabs(layout.root)) {
            if (tab.target.kind === "local_file") retained.add(tab.target.previewId);
          }
        }
        releaseUnusedLocalFilePreviews(retained);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let hintTimeout: number | undefined;
    const clearHint = () => {
      window.clearTimeout(hintTimeout);
      setDragging(false);
    };
    function hasDropOwner(event: DragEvent) {
      for (const target of event.composedPath()) {
        if (target instanceof Element && target.hasAttribute("data-file-drop-owner")) return true;
      }
      return false;
    }
    const onDragOver = (event: DragEvent) => {
      if (hasDropOwner(event) || !isExternalFileTransfer(event.dataTransfer)) {
        clearHint();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
      window.clearTimeout(hintTimeout);
      // Clear the hint even if the drag ends outside this document.
      hintTimeout = window.setTimeout(clearHint, 200);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) clearHint();
    };
    const onDrop = (event: DragEvent) => {
      clearHint();
      if (hasDropOwner(event) || !isExternalFileTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      const items = collectExternalPreviewItems(event.dataTransfer);
      if (!items.length) items.push({ name: "", error: "unreadable" });
      for (const item of items) {
        if (!item.name) item.name = t("externalFilePreview.unnamed");
      }
      const targets = createLocalFilePreviews(items);
      const workspace = parseHostWorkspaceRouteFromPathname(routeRef.current);
      const workspaceKey = workspace
        ? buildWorkspaceTabPersistenceKey(workspace)
        : LOCAL_FILE_PREVIEW_WORKSPACE_KEY;
      if (!workspaceKey) return;
      ensurePanelsRegistered();
      const store = useWorkspaceLayoutStore.getState();
      let firstTabId: string | null = null;
      for (const target of targets) {
        const tabId = store.openTab({
          workspaceKey,
          target,
          intent: "new",
          placement: FOCUSED_PANE_PLACEMENT,
        });
        firstTabId ??= tabId;
      }
      if (firstTabId) store.focusTab(workspaceKey, firstTabId);
      if (!workspace && routeRef.current !== "/file-preview") router.push("/file-preview");
    };
    // Route by ownership before editors can swallow drops or insert file text.
    // Attachment inputs (including disabled ones) and terminals keep their own handlers.
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", clearHint);
    return () => {
      window.clearTimeout(hintTimeout);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", clearHint);
    };
  }, [router, t]);

  if (!dragging) return null;
  return (
    <View pointerEvents="none" style={styles.hint} testID="external-file-drop-hint">
      <Text style={styles.hintText}>{t("externalFilePreview.dropHint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hint: {
    position: "absolute",
    top: 64,
    alignSelf: "center",
    zIndex: 1000,
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  hintText: { color: theme.colors.foreground },
}));
