import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { MenuHeader } from "@/components/headers/menu-header";
import { LocalFilePreview } from "@/components/file-drop/local-file-preview";
import { LOCAL_FILE_PREVIEW_WORKSPACE_KEY } from "@/components/file-drop/external-file-drop-preview";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import type { Theme } from "@/styles/theme";

const ThemedClose = withUnistyles(X);
const closeIconTheme = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export default function LocalFilePreviewRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const layout = useWorkspaceLayoutStore(
    (state) => state.layoutByWorkspace[LOCAL_FILE_PREVIEW_WORKSPACE_KEY],
  );
  const tabs = useMemo(
    () =>
      layout ? collectAllTabs(layout.root).filter((tab) => tab.target.kind === "local_file") : [],
    [layout],
  );
  const focusedTabId = layout?.focusedPaneId
    ? findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId
    : null;
  const activeTab = tabs.find((tab) => tab.tabId === focusedTabId) ?? tabs[0];
  const focusTab = useCallback((tabId: string) => {
    useWorkspaceLayoutStore.getState().focusTab(LOCAL_FILE_PREVIEW_WORKSPACE_KEY, tabId);
  }, []);
  const closeTab = useCallback(
    (tabId: string) => {
      useWorkspaceLayoutStore.getState().closeTab(LOCAL_FILE_PREVIEW_WORKSPACE_KEY, tabId);
      if (tabs.length === 1 && router.canGoBack()) router.back();
    },
    [tabs.length, router],
  );

  return (
    <View style={styles.container} testID="local-file-preview-page">
      <MenuHeader title={t("externalFilePreview.title")} />
      <ScrollView horizontal style={styles.tabBar} contentContainerStyle={styles.tabList}>
        {tabs.map((tab) => (
          <LocalPreviewTab
            key={tab.tabId}
            tab={tab}
            active={tab.tabId === activeTab?.tabId}
            onFocus={focusTab}
            onClose={closeTab}
          />
        ))}
      </ScrollView>
      {activeTab?.target.kind === "local_file" ? (
        <LocalFilePreview previewId={activeTab.target.previewId} />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.hint}>{t("externalFilePreview.dropHint")}</Text>
        </View>
      )}
    </View>
  );
}

function LocalPreviewTab({
  tab,
  active,
  onFocus,
  onClose,
}: {
  tab: WorkspaceTab;
  active: boolean;
  onFocus: (tabId: string) => void;
  onClose: (tabId: string) => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onFocus(tab.tabId), [onFocus, tab.tabId]);
  const close = useCallback(() => onClose(tab.tabId), [onClose, tab.tabId]);
  const style = useMemo(() => [styles.tab, active && styles.activeTab], [active]);
  if (tab.target.kind !== "local_file") return null;
  return (
    <View style={style}>
      <Pressable
        accessibilityRole="tab"
        aria-selected={active}
        onPress={select}
        style={styles.selectTab}
        testID={`local-preview-tab-${tab.target.previewId}`}
      >
        <Text numberOfLines={1} style={styles.tabText}>
          {tab.target.name}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.actions.close")}
        onPress={close}
        style={styles.closeTab}
        testID={`local-preview-close-${tab.target.previewId}`}
      >
        <ThemedClose size={14} uniProps={closeIconTheme} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
  tabBar: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabList: { alignItems: "center", paddingHorizontal: theme.spacing[3], gap: theme.spacing[1] },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 280,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  activeTab: {
    backgroundColor: theme.colors.surface2,
    borderBottomColor: theme.colors.borderAccent,
  },
  selectTab: { flexShrink: 1, padding: theme.spacing[3] },
  tabText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  closeTab: { padding: theme.spacing[2] },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  hint: { color: theme.colors.foregroundMuted },
}));
