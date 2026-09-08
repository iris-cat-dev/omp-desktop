import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PanelBottom, PanelRight, Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import type { ShortcutKey } from "@/utils/format-shortcut";
import type { Theme } from "@/styles/theme";

const ThemedPanelBottom = withUnistyles(PanelBottom);
const ThemedPanelRight = withUnistyles(PanelRight);
const ThemedPlus = withUnistyles(Plus);
const foreground = (theme: Theme) => ({ color: theme.colors.foreground });
const muted = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

export function WorkspaceHeaderActions({
  showPanels,
  showNewTab,
  bottomPaneOpen,
  onToggleBottomPane,
  bottomPaneKeys,
  onToggleSidePanel,
  sidePanelLabel,
  sidePanelOpen,
  sidePanelKeys,
  children,
  disabled = false,
}: {
  showPanels: boolean;
  showNewTab: boolean;
  bottomPaneOpen: boolean;
  onToggleBottomPane: () => void;
  bottomPaneKeys: ShortcutKey[];
  onToggleSidePanel: () => void;
  sidePanelLabel: string;
  sidePanelOpen?: boolean;
  sidePanelKeys: ShortcutKey[];
  children: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const bottomLabel = t(
    bottomPaneOpen ? "workspace.tabs.actions.closePane" : "workspace.tabs.actions.splitDown",
  );
  const bottomState = useMemo(
    () => ({ expanded: bottomPaneOpen, disabled }),
    [bottomPaneOpen, disabled],
  );
  const sideState = useMemo(
    () => ({ expanded: sidePanelOpen, disabled }),
    [sidePanelOpen, disabled],
  );
  return (
    <>
      {showPanels ? (
        <>
          <HeaderToggleButton
            testID="workspace-header-split-pane-down"
            onPress={onToggleBottomPane}
            tooltipLabel={bottomLabel}
            tooltipKeys={bottomPaneOpen ? [] : bottomPaneKeys}
            tooltipSide="left"
            style={styles.action}
            disabled={disabled}
            accessible
            accessibilityRole="button"
            accessibilityLabel={bottomLabel}
            accessibilityState={bottomState}
          >
            {({ hovered }) => (
              <ThemedPanelBottom size={16} uniProps={hovered ? foreground : muted} />
            )}
          </HeaderToggleButton>
          <HeaderToggleButton
            testID="workspace-explorer-toggle"
            onPress={onToggleSidePanel}
            tooltipLabel={t("workspace.tabs.sidePanel.toggle")}
            tooltipKeys={sidePanelKeys}
            tooltipSide="left"
            style={styles.action}
            disabled={disabled}
            accessible
            accessibilityRole="button"
            accessibilityLabel={sidePanelLabel}
            accessibilityState={sideState}
          >
            {({ hovered }) => (
              <ThemedPanelRight size={16} uniProps={hovered ? foreground : muted} />
            )}
          </HeaderToggleButton>
        </>
      ) : null}
      {showNewTab ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            testID="workspace-header-new-tab"
            style={styles.action}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.tabs.actions.newTab")}
          >
            {({ hovered, open }) => (
              <ThemedPlus size={16} uniProps={hovered || open ? foreground : muted} />
            )}
          </DropdownMenuTrigger>
          {children}
        </DropdownMenu>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  action: {
    width: { xs: theme.spacing[8], md: buttonControlHeight.xs },
    height: { xs: theme.spacing[8], md: buttonControlHeight.xs },
    padding: 0,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
}));
