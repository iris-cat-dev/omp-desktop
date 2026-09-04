import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import type { JsonValue } from "@omp-desktop/protocol/agent-types";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  defaultWorkspaceLayoutIds,
  type WorkspaceLayoutIdSource,
} from "@/stores/workspace-layout-ids";
import {
  canDismissPaneInLayout,
  clampNormalizedSizes,
  closePaneInLayout,
  closeTabInLayout,
  collectAllPanes,
  collectAllTabs,
  convertDraftToAgentInLayout,
  createTabInLayout,
  createDefaultLayout,
  DEFAULT_PANE_ID,
  AMBIENT_PLACEMENT,
  createWorkspaceLayoutWithSidePanel,
  FOCUSED_PANE_PLACEMENT,
  SIDE_PANEL_PANE_ID,
  findPaneById,
  findBottomTerminalPaneId,
  findPaneContainingTab,
  focusPaneInLayout,
  focusTabInLayout,
  getFocusedBrowserId,
  getTreeDepth,
  insertSplit,
  moveTabToPaneInLayout,
  normalizeLayout,
  openTabInLayoutBackground,
  replaceTabTargetInLayout,
  rekeyTabInLayout,
  revealTargetInLayout,
  restoreEmptyPanesInLayout,
  reconcileWorkspaceTabs,
  removePaneFromTree,
  removeTabFromTree,
  reorderFocusedPaneTabsInLayout,
  reorderPaneTabsInLayout,
  setPaneHiddenInLayout,
  setTabStateInLayout,
  splitPaneEmptyInLayout,
  splitPaneInLayout,
  stripEphemeralTabsFromLayout,
  type SplitGroup,
  type SplitNode,
  type SplitPane,
  type WorkspaceTabPlacement,
  type WorkspaceTabReconcileState,
  type WorkspaceTabSnapshot,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
} from "@/workspace-tabs/identity";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  DEFAULT_WORKSPACE_SIDE_PANEL_TARGET,
  isWorkspaceSidePanelToolTarget,
} from "@/workspace-tabs/side-panel-target";
import { findAdjacentPane } from "@/utils/split-navigation";

export {
  AMBIENT_PLACEMENT,
  canDismissPaneInLayout,
  collectAllPanes,
  collectAllTabs,
  createDefaultLayout,
  DEFAULT_PANE_ID,
  createWorkspaceLayoutWithSidePanel,
  FOCUSED_PANE_PLACEMENT,
  findPaneById,
  findBottomTerminalPaneId,
  findPaneContainingTab,
  getFocusedBrowserId,
  getTreeDepth,
  insertSplit,
  normalizeLayout,
  removePaneFromTree,
  removeTabFromTree,
  stripEphemeralTabsFromLayout,
};
export type {
  SplitGroup,
  SplitNode,
  SplitPane,
  WorkspaceLayout,
  WorkspaceTabPlacement,
  WorkspaceTabReconcileState,
  WorkspaceTabSnapshot,
};

export type WorkspaceTabOpenIntent = "new" | "reveal" | "background";
export interface OpenWorkspaceTabInput {
  workspaceKey: string;
  target: WorkspaceTabTarget;
  intent: WorkspaceTabOpenIntent;
  placement?: WorkspaceTabPlacement;
  parentTabId?: string;
  state?: JsonValue;
}

interface WorkspaceLayoutStore {
  layoutByWorkspace: Record<string, WorkspaceLayout>;
  splitSizesByWorkspace: Record<string, Record<string, number[]>>;
  pinnedAgentIdsByWorkspace: Record<string, Set<string>>;
  pendingAgentIdsByWorkspace: Record<string, Set<string>>;
  hiddenAgentIdsByWorkspace: Record<string, Set<string>>;
  focusRestorationByWorkspace: Record<string, WorkspaceFocusRestorationState>;
  sidePanelPaneIdByWorkspace: Record<string, string | null>;
  openTab: (input: OpenWorkspaceTabInput) => string | null;
  /** Reveals the side panel without putting anything in it. Returns its pane id. */
  showSidePanel: (workspaceKey: string) => string | null;
  hideSidePanel: (workspaceKey: string) => void;
  closeTab: (workspaceKey: string, tabId: string) => void;
  focusTab: (workspaceKey: string, tabId: string) => void;
  replaceTab: (
    workspaceKey: string,
    tabId: string,
    target: WorkspaceTabTarget,
    state?: JsonValue,
  ) => string | null;
  setTabState: (workspaceKey: string, tabId: string, state: JsonValue | undefined) => void;
  convertDraftToAgent: (workspaceKey: string, tabId: string, agentId: string) => string | null;
  reconcileTabs: (workspaceKey: string, snapshot: WorkspaceTabSnapshot) => void;
  resolvePendingAgent: (workspaceKey: string, agentId: string) => void;
  reorderTabs: (workspaceKey: string, tabIds: string[]) => void;
  getWorkspaceTabs: (workspaceKey: string) => WorkspaceTab[];
  splitPane: (
    workspaceKey: string,
    input: {
      tabId: string;
      targetPaneId: string;
      position: "left" | "right" | "top" | "bottom";
    },
  ) => string | null;
  splitPaneEmpty: (
    workspaceKey: string,
    input: {
      targetPaneId: string;
      position: "left" | "right" | "top" | "bottom";
    },
  ) => string | null;
  moveTabToPane: (workspaceKey: string, tabId: string, toPaneId: string) => void;
  /**
   * Dismisses the pane along with whatever it still holds. The side panel hides so
   * the user can bring it back; every other pane is removed. Callers own tab teardown
   * (archiving agents, killing terminals) first. No-ops on the last visible pane.
   */
  closePane: (workspaceKey: string, paneId: string) => void;
  focusPane: (workspaceKey: string, paneId: string) => void;
  unfocusPane: (workspaceKey: string) => string | null;
  restorePaneFocus: (workspaceKey: string, token: string) => void;
  resizeSplit: (workspaceKey: string, groupId: string, sizes: number[]) => void;
  reorderTabsInPane: (workspaceKey: string, paneId: string, tabIds: string[]) => void;
  pinAgent: (workspaceKey: string, agentId: string) => void;
  unpinAgent: (workspaceKey: string, agentId: string) => void;
  hideAgent: (workspaceKey: string, agentId: string) => void;
  unhideAgent: (workspaceKey: string, agentId: string) => void;
  purgeWorkspace: (workspaceKey: string) => void;
}

interface WorkspaceFocusRestorationState {
  restorePaneId: string | null;
  tokens: string[];
}

// The root companion split is always present for the hidden side panel pane.
// Preserve four user-created split levels beneath it.
const MAX_TREE_DEPTH = 5;

const WorkspaceDraftTabSetupStorageSchema = z.strictObject({
  provider: z.string(),
  cwd: z.string(),
  modeId: z.string().nullable(),
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  featureValues: z.record(z.string(), z.union([z.boolean(), z.string(), z.null()])),
});
const WorkspaceTabTargetStorageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new_tab") }),
  z.strictObject({
    kind: z.literal("draft"),
    draftId: z.string(),
    setup: WorkspaceDraftTabSetupStorageSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("agent"), agentId: z.string() }),
  z.strictObject({
    kind: z.literal("provider_subagent"),
    parentAgentId: z.string(),
    subagentId: z.string(),
  }),
  z.strictObject({ kind: z.literal("terminal"), terminalId: z.string() }),
  z.strictObject({ kind: z.literal("browser"), browserId: z.string() }),
  z.strictObject({ kind: z.literal("files") }),
  z.strictObject({ kind: z.literal("pull_request") }),
  z.strictObject({
    kind: z.literal("file"),
    path: z.string(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  }),
  z.strictObject({
    kind: z.literal("working_diff"),
    focusPath: z.string().optional(),
    focusRequestId: z.number().optional(),
    // COMPAT(workingDiffTarget): accepted from pre-canonical tab ids; normalization removes them.
    mode: z.enum(["uncommitted", "base"]).optional(),
    baseRef: z.string().nullable().optional(),
    ignoreWhitespace: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal("setup"), workspaceId: z.string() }),
  z.strictObject({ kind: z.literal("commit_diff"), sha: z.string() }),
  z.discriminatedUnion("context", [
    z.strictObject({
      kind: z.literal("plugin"),
      pluginId: z.string(),
      panelId: z.string(),
      context: z.literal("workspace"),
    }),
    z.strictObject({
      kind: z.literal("plugin"),
      pluginId: z.string(),
      panelId: z.string(),
      context: z.literal("agent"),
      agentId: z.string(),
    }),
  ]),
]);
const WorkspaceTabStorageSchema = z.strictObject({
  tabId: z.string(),
  target: WorkspaceTabTargetStorageSchema,
  createdAt: z.number(),
  state: z.json().optional(),
});
const SplitNodeStorageSchema: z.ZodType<SplitNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("pane"),
      pane: z.strictObject({
        id: z.string(),
        tabIds: z.array(z.string()),
        focusedTabId: z.string().nullable(),
        tabs: z.array(WorkspaceTabStorageSchema).optional(),
        hidden: z.boolean().optional(),
      }),
    }),
    z.strictObject({
      kind: z.literal("group"),
      group: z.strictObject({
        id: z.string(),
        direction: z.enum(["horizontal", "vertical"]),
        children: z.array(SplitNodeStorageSchema),
        sizes: z.array(z.number()),
      }),
    }),
  ]),
);
const WorkspaceLayoutStorageSchema: z.ZodType<WorkspaceLayout> = z.strictObject({
  root: SplitNodeStorageSchema,
  focusedPaneId: z.string().nullable(),
  parentTabIdByTabId: z.record(z.string(), z.string()).optional(),
});
const WorkspaceLayoutPersistedStateSchema = z.strictObject({
  layoutByWorkspace: z.record(z.string(), WorkspaceLayoutStorageSchema),
  splitSizesByWorkspace: z.record(z.string(), z.record(z.string(), z.array(z.number()))).optional(),
  // The persisted keys keep their pre-rename spelling: the schema is strict, so a
  // rename here would fail every existing blob and wipe the layout it describes.
  explorerPaneIdByWorkspace: z.record(z.string(), z.string().nullable()).optional(),
  // COMPAT(pullRequestAutoAdd): PR detection stopped opening a tab in v0.5; accepted
  // and ignored so upgrading does not discard the layout. Remove after 2027-08-20.
  acknowledgedPullRequestByWorkspace: z.record(z.string(), z.string()).optional(),
});

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createWorkspaceTabInstanceId(): string {
  const value =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `tab_${value}`;
}

function addAgentIdToWorkspaceSet(
  state: Record<string, Set<string>>,
  workspaceKey: string,
  agentId: string,
): Record<string, Set<string>> {
  const currentAgentIds = state[workspaceKey] ?? null;
  if (currentAgentIds?.has(agentId)) {
    return state;
  }

  const nextAgentIds = new Set(currentAgentIds ?? []);
  nextAgentIds.add(agentId);
  return {
    ...state,
    [workspaceKey]: nextAgentIds,
  };
}

function removeAgentIdFromWorkspaceSet(
  state: Record<string, Set<string>>,
  workspaceKey: string,
  agentId: string,
): Record<string, Set<string>> {
  const currentAgentIds = state[workspaceKey] ?? null;
  if (!currentAgentIds?.has(agentId)) {
    return state;
  }

  if (currentAgentIds.size === 1) {
    const nextState = { ...state };
    delete nextState[workspaceKey];
    return nextState;
  }

  const nextAgentIds = new Set(currentAgentIds);
  nextAgentIds.delete(agentId);
  return {
    ...state,
    [workspaceKey]: nextAgentIds,
  };
}

function getWorkspaceLayout(
  state: Record<string, WorkspaceLayout>,
  workspaceKey: string,
): WorkspaceLayout {
  return normalizeLayout(state[workspaceKey] ?? createWorkspaceLayoutWithSidePanel());
}

type SidePanelState = Pick<
  WorkspaceLayoutStore,
  "layoutByWorkspace" | "sidePanelPaneIdByWorkspace"
>;

/**
 * The side panel's pane, on screen or not. A workspace the user has not laid out
 * yet still has one — the default layout is born with it — so this answers before
 * the first tab exists.
 */
export function selectSidePanelPaneId(state: SidePanelState, workspaceKey: string): string | null {
  const layout = getWorkspaceLayout(state.layoutByWorkspace, workspaceKey);
  return resolveSidePanelPaneId(layout, state.sidePanelPaneIdByWorkspace[workspaceKey]);
}

/** Whether the side panel pane is currently on screen. */
export function selectIsSidePanelVisible(state: SidePanelState, workspaceKey: string): boolean {
  const layout = state.layoutByWorkspace[workspaceKey];
  const paneId = layout ? selectSidePanelPaneId(state, workspaceKey) : null;
  const pane = paneId && layout ? findPaneById(layout.root, paneId) : null;
  return Boolean(pane && pane.hidden !== true);
}

export function resolveSidePanelPaneId(
  layout: WorkspaceLayout,
  registeredPaneId: string | null | undefined,
): string | null {
  const registeredPane = findPaneById(layout.root, registeredPaneId ?? null);
  if (registeredPane) {
    return registeredPane.id;
  }
  const defaultPane = findPaneById(layout.root, SIDE_PANEL_PANE_ID);
  return defaultPane?.id ?? null;
}
function findMainWorkspacePaneId(
  layout: WorkspaceLayout,
  sidePanelPaneId: string | null,
): string | null {
  const defaultPane = findPaneById(layout.root, DEFAULT_PANE_ID);
  if (defaultPane && defaultPane.id !== sidePanelPaneId && defaultPane.hidden !== true) {
    return defaultPane.id;
  }
  return collectAllPanes(layout.root).find((pane) => pane.id !== sidePanelPaneId)?.id ?? null;
}

function isWorkspaceConversationTarget(target: WorkspaceTabTarget): boolean {
  return (
    target.kind === "agent" || target.kind === "provider_subagent" || target.kind === "draft"
  );
}

interface CanonicalPaneResult {
  layout: WorkspaceLayout;
  paneId: string;
}

function ensureMainWorkspacePane(input: {
  layout: WorkspaceLayout;
  sidePanelPaneId: string | null;
  ids: WorkspaceLayoutIdSource;
}): CanonicalPaneResult | null {
  const existingPaneId = findMainWorkspacePaneId(input.layout, input.sidePanelPaneId);
  if (existingPaneId) {
    return { layout: input.layout, paneId: existingPaneId };
  }

  const sidePanel = findPaneById(input.layout.root, input.sidePanelPaneId);
  if (!sidePanel) {
    return null;
  }
  const split = splitPaneEmptyInLayout({
    layout: input.layout,
    targetPaneId: sidePanel.id,
    position: "left",
    createNodeId: input.ids.createNodeId,
    maxTreeDepth: MAX_TREE_DEPTH,
  });
  if (!split) {
    return null;
  }
  return {
    layout: { ...split.layout, focusedPaneId: input.layout.focusedPaneId },
    paneId: split.paneId,
  };
}

function ensureBottomTerminalPane(input: {
  layout: WorkspaceLayout;
  mainPaneId: string;
  sidePanelPaneId: string | null;
  ids: WorkspaceLayoutIdSource;
}): CanonicalPaneResult | null {
  const existingPaneId = findBottomTerminalPaneId({
    layout: input.layout,
    tabs: collectAllTabs(input.layout.root),
  });
  if (existingPaneId) {
    return { layout: input.layout, paneId: existingPaneId };
  }

  const adjacentPaneId = findAdjacentPane(input.layout.root, input.mainPaneId, "down");
  if (adjacentPaneId && adjacentPaneId !== input.sidePanelPaneId) {
    return { layout: input.layout, paneId: adjacentPaneId };
  }

  const split = splitPaneEmptyInLayout({
    layout: input.layout,
    targetPaneId: input.mainPaneId,
    position: "bottom",
    createNodeId: input.ids.createNodeId,
    maxTreeDepth: MAX_TREE_DEPTH,
  });
  if (!split) {
    return null;
  }
  return {
    layout: { ...split.layout, focusedPaneId: input.layout.focusedPaneId },
    paneId: split.paneId,
  };
}

function moveTabsToCanonicalPane(input: {
  layout: WorkspaceLayout;
  tabs: WorkspaceTab[];
  paneId: string;
  preservedPaneIds: ReadonlySet<string>;
}): WorkspaceLayout {
  const targetPane = findPaneById(input.layout.root, input.paneId);
  const targetTabsById = new Map(
    collectAllTabs(input.layout.root).map((tab) => [tab.tabId, tab]),
  );
  const placeholderTabId =
    targetPane?.tabIds.length === 1 &&
    targetTabsById.get(targetPane.tabIds[0] ?? "")?.target.kind === "new_tab"
      ? (targetPane.tabIds[0] ?? null)
      : null;
  let nextLayout = input.layout;
  let movedAnyTab = false;

  for (const tab of input.tabs) {
    const sourcePane = findPaneContainingTab(nextLayout.root, tab.tabId);
    if (!sourcePane || sourcePane.id === input.paneId) {
      continue;
    }
    const movedLayout = moveTabToPaneInLayout({
      layout: nextLayout,
      tabId: tab.tabId,
      toPaneId: input.paneId,
      preserveEmptyPaneId: input.preservedPaneIds.has(sourcePane.id) ? sourcePane.id : null,
    });
    if (movedLayout) {
      nextLayout = movedLayout;
      movedAnyTab = true;
    }
  }

  if (movedAnyTab && placeholderTabId) {
    nextLayout =
      closeTabInLayout({
        layout: nextLayout,
        tabId: placeholderTabId,
        preserveEmptyPaneId: input.paneId,
      }) ?? nextLayout;
  }
  return nextLayout;
}

function enforceWorkspaceTabZones(input: {
  layout: WorkspaceLayout;
  sidePanelPaneId: string | null;
  ids: WorkspaceLayoutIdSource;
}): WorkspaceLayout {
  const originalFocusedPane = findPaneById(input.layout.root, input.layout.focusedPaneId);
  const originalFocusedTabId = originalFocusedPane?.focusedTabId ?? null;
  const initialTabs = collectAllTabs(input.layout.root);
  const conversationTabs = initialTabs.filter((tab) => isWorkspaceConversationTarget(tab.target));
  const terminalTabs = initialTabs.filter((tab) => tab.target.kind === "terminal");
  if (conversationTabs.length === 0 && terminalTabs.length === 0) {
    return input.layout;
  }

  const mainPane = ensureMainWorkspacePane(input);
  if (!mainPane) {
    return input.layout;
  }

  const preservedPaneIds = new Set(
    [mainPane.paneId, input.sidePanelPaneId].filter((paneId): paneId is string => Boolean(paneId)),
  );
  let nextLayout = moveTabsToCanonicalPane({
    layout: mainPane.layout,
    tabs: conversationTabs,
    paneId: mainPane.paneId,
    preservedPaneIds,
  });

  if (terminalTabs.length > 0) {
    const terminalPane = ensureBottomTerminalPane({
      layout: nextLayout,
      mainPaneId: mainPane.paneId,
      sidePanelPaneId: input.sidePanelPaneId,
      ids: input.ids,
    });
    if (terminalPane) {
      nextLayout = moveTabsToCanonicalPane({
        layout: terminalPane.layout,
        tabs: terminalTabs,
        paneId: terminalPane.paneId,
        preservedPaneIds,
      });
    } else {
      for (const tab of terminalTabs) {
        const sourcePane = findPaneContainingTab(nextLayout.root, tab.tabId);
        nextLayout =
          closeTabInLayout({
            layout: nextLayout,
            tabId: tab.tabId,
            preserveEmptyPaneId:
              sourcePane && preservedPaneIds.has(sourcePane.id) ? sourcePane.id : null,
          }) ?? nextLayout;
      }
    }
  }

  if (originalFocusedTabId && findPaneContainingTab(nextLayout.root, originalFocusedTabId)) {
    return focusTabInLayout({ layout: nextLayout, tabId: originalFocusedTabId }) ?? nextLayout;
  }
  const originalPane = findPaneById(nextLayout.root, originalFocusedPane?.id);
  if (originalPane && originalPane.hidden !== true) {
    return focusPaneInLayout({ layout: nextLayout, paneId: originalPane.id }) ?? nextLayout;
  }
  return nextLayout;
}

function migrateLegacyWorkingDiffDocumentIds(layout: WorkspaceLayout): WorkspaceLayout {
  let nextLayout = layout;
  for (const tab of collectAllTabs(layout.root)) {
    if (
      tab.tabId !== "working_diff" ||
      tab.target.kind !== "working_diff" ||
      isWorkspaceSidePanelToolTarget(tab.target)
    ) {
      continue;
    }
    nextLayout =
      rekeyTabInLayout({
        layout: nextLayout,
        tabId: tab.tabId,
        nextTabId: buildDeterministicWorkspaceTabId(tab.target),
      }) ?? nextLayout;
  }
  return nextLayout;
}

function relocateContentOutOfSidePanel(
  layout: WorkspaceLayout,
  sidePanelPaneId: string,
): WorkspaceLayout {
  const sidePanel = findPaneById(layout.root, sidePanelPaneId);
  const mainPaneId = findMainWorkspacePaneId(layout, sidePanelPaneId);
  if (!sidePanel || !mainPaneId) {
    return layout;
  }

  const tabsById = new Map(collectAllTabs(layout.root).map((tab) => [tab.tabId, tab]));
  let nextLayout = layout;
  for (const tabId of sidePanel.tabIds) {
    const tab = tabsById.get(tabId);
    if (!tab || tab.target.kind === "new_tab" || isWorkspaceSidePanelToolTarget(tab.target)) {
      continue;
    }
    nextLayout =
      moveTabToPaneInLayout({
        layout: nextLayout,
        tabId,
        toPaneId: mainPaneId,
        preserveEmptyPaneId: sidePanelPaneId,
      }) ?? nextLayout;
  }
  return nextLayout;
}

function ensurePersistedSidePanelPane(input: {
  layout: WorkspaceLayout;
  registeredPaneId: string | null | undefined;
  ids: WorkspaceLayoutIdSource;
}): { layout: WorkspaceLayout; paneId: string } | null {
  const migratedLayout = migrateLegacyWorkingDiffDocumentIds(input.layout);
  const existingPaneId = resolveSidePanelPaneId(migratedLayout, input.registeredPaneId);
  if (existingPaneId) {
    return {
      layout: relocateContentOutOfSidePanel(migratedLayout, existingPaneId),
      paneId: existingPaneId,
    };
  }
  const targetPaneId =
    findPaneById(migratedLayout.root, migratedLayout.focusedPaneId)?.id ??
    collectAllPanes(migratedLayout.root)[0]?.id;
  if (!targetPaneId) {
    return null;
  }
  const split = splitPaneEmptyInLayout({
    layout: migratedLayout,
    targetPaneId,
    position: "right",
    createNodeId: input.ids.createNodeId,
    maxTreeDepth: MAX_TREE_DEPTH,
  });
  if (!split) {
    return null;
  }
  const hiddenLayout = setPaneHiddenInLayout({
    layout: split.layout,
    paneId: split.paneId,
    hidden: true,
  });
  return { layout: hiddenLayout ?? split.layout, paneId: split.paneId };
}

function getOpenTabPlacement(
  state: WorkspaceLayoutStore,
  workspaceKey: string,
  target: WorkspaceTabTarget,
  placement: WorkspaceTabPlacement | undefined,
  ids: WorkspaceLayoutIdSource,
): {
  layout: WorkspaceLayout;
  placement: WorkspaceTabPlacement;
  sidePanelPaneId: string | null;
} | null {
  const layout = getWorkspaceLayout(state.layoutByWorkspace, workspaceKey);
  const sidePanelPaneId = resolveSidePanelPaneId(
    layout,
    state.sidePanelPaneIdByWorkspace[workspaceKey],
  );
  if (!isWorkspaceConversationTarget(target) && target.kind !== "terminal") {
    return {
      layout,
      placement: placement ?? AMBIENT_PLACEMENT,
      sidePanelPaneId,
    };
  }

  const mainPane = ensureMainWorkspacePane({ layout, sidePanelPaneId, ids });
  if (!mainPane) {
    return null;
  }
  if (target.kind !== "terminal") {
    return {
      layout: mainPane.layout,
      placement: { mode: "prefer", paneId: mainPane.paneId },
      sidePanelPaneId,
    };
  }

  const terminalPane = ensureBottomTerminalPane({
    layout: mainPane.layout,
    mainPaneId: mainPane.paneId,
    sidePanelPaneId,
    ids,
  });
  return terminalPane
    ? {
        layout: terminalPane.layout,
        placement: { mode: "prefer", paneId: terminalPane.paneId },
        sidePanelPaneId,
      }
    : null;
}

function withoutFocusRestoration(
  state: WorkspaceLayoutStore,
  workspaceKey: string,
): Pick<WorkspaceLayoutStore, "focusRestorationByWorkspace"> | null {
  if (!(workspaceKey in state.focusRestorationByWorkspace)) {
    return null;
  }
  const { [workspaceKey]: _removed, ...focusRestorationByWorkspace } =
    state.focusRestorationByWorkspace;
  return { focusRestorationByWorkspace };
}

function attachParentTab(input: {
  layout: WorkspaceLayout;
  childTabId: string | null;
  parentTabId: string | null;
}): WorkspaceLayout {
  const childTabId = trimNonEmpty(input.childTabId);
  const parentTabId = trimNonEmpty(input.parentTabId);
  if (!childTabId || !parentTabId || childTabId === parentTabId) {
    return normalizeLayout(input.layout);
  }

  const openTabIds = new Set(collectAllTabs(input.layout.root).map((tab) => tab.tabId));
  if (!openTabIds.has(childTabId) || !openTabIds.has(parentTabId)) {
    return normalizeLayout(input.layout);
  }

  return normalizeLayout({
    ...input.layout,
    parentTabIdByTabId: {
      ...input.layout.parentTabIdByTabId,
      [childTabId]: parentTabId,
    },
  });
}

/**
 * Splits a side panel out of the pane the user is in. Only reached by layouts saved
 * before the side panel became part of the default tree; new ones are born with it.
 */
function createSidePanelPane(
  workspaceKey: string,
  layout: WorkspaceLayout,
  splitPaneEmpty: WorkspaceLayoutStore["splitPaneEmpty"],
): string | null {
  const targetPaneId =
    findPaneById(layout.root, layout.focusedPaneId)?.id ?? collectAllPanes(layout.root)[0]?.id;
  return targetPaneId ? splitPaneEmpty(workspaceKey, { targetPaneId, position: "right" }) : null;
}

export function createWorkspaceLayoutStore(
  ids: WorkspaceLayoutIdSource = defaultWorkspaceLayoutIds,
) {
  return create<WorkspaceLayoutStore>()(
    persist(
      (set, get) => ({
        layoutByWorkspace: {},
        splitSizesByWorkspace: {},
        pinnedAgentIdsByWorkspace: {},
        pendingAgentIdsByWorkspace: {},
        hiddenAgentIdsByWorkspace: {},
        focusRestorationByWorkspace: {},
        sidePanelPaneIdByWorkspace: {},
        openTab: (input) => {
          const normalizedWorkspaceKey = trimNonEmpty(input.workspaceKey);
          const normalizedTarget = normalizeWorkspaceTabTarget(input.target);
          if (!normalizedWorkspaceKey || !normalizedTarget) {
            return null;
          }
          const placement = getOpenTabPlacement(
            get(),
            normalizedWorkspaceKey,
            normalizedTarget,
            input.placement,
            ids,
          );
          if (!placement) {
            return null;
          }
          let result;
          if (input.intent === "new") {
            result = createTabInLayout({
              ...placement,
              target: normalizedTarget,
              now: Date.now(),
              createTabId: createWorkspaceTabInstanceId,
              state: input.state,
            });
          } else if (input.intent === "background") {
            result = openTabInLayoutBackground({
              ...placement,
              target: normalizedTarget,
              now: Date.now(),
            });
          } else {
            result = revealTargetInLayout({
              ...placement,
              target: normalizedTarget,
              now: Date.now(),
              createTabId: createWorkspaceTabInstanceId,
            });
          }
          const zonedLayout = enforceWorkspaceTabZones({
            layout: result.layout,
            sidePanelPaneId: placement.sidePanelPaneId,
            ids,
          });
          const nextLayout = input.parentTabId
            ? attachParentTab({
                layout: zonedLayout,
                childTabId: result.tabId,
                parentTabId: input.parentTabId,
              })
            : zonedLayout;
          set((state) => ({
            ...withoutFocusRestoration(state, normalizedWorkspaceKey),
            hiddenAgentIdsByWorkspace:
              normalizedTarget.kind !== "agent"
                ? state.hiddenAgentIdsByWorkspace
                : removeAgentIdFromWorkspaceSet(
                    state.hiddenAgentIdsByWorkspace,
                    normalizedWorkspaceKey,
                    normalizedTarget.agentId,
                  ),
            layoutByWorkspace: {
              ...state.layoutByWorkspace,
              [normalizedWorkspaceKey]: nextLayout,
            },
          }));
          return result.tabId;
        },
        showSidePanel: (workspaceKey) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return null;
          }

          const layout = getWorkspaceLayout(get().layoutByWorkspace, normalizedWorkspaceKey);
          const paneId =
            resolveSidePanelPaneId(
              layout,
              get().sidePanelPaneIdByWorkspace[normalizedWorkspaceKey],
            ) ?? createSidePanelPane(normalizedWorkspaceKey, layout, get().splitPaneEmpty);
          if (!paneId) {
            return null;
          }
          if (!get().layoutByWorkspace[normalizedWorkspaceKey]) {
            set((state) => ({
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: layout,
              },
            }));
          }
          const currentLayout = getWorkspaceLayout(get().layoutByWorkspace, normalizedWorkspaceKey);
          const sidePanel = findPaneById(currentLayout.root, paneId);
          if (sidePanel?.tabIds.length === 1) {
            const tabId = sidePanel.tabIds[0];
            const tab = collectAllTabs(currentLayout.root).find(
              (candidate) => candidate.tabId === tabId,
            );
            if (tabId && tab?.target.kind === "new_tab") {
              get().replaceTab(normalizedWorkspaceKey, tabId, DEFAULT_WORKSPACE_SIDE_PANEL_TARGET);
            }
          }

          set((state) =>
            state.sidePanelPaneIdByWorkspace[normalizedWorkspaceKey] === paneId
              ? state
              : {
                  sidePanelPaneIdByWorkspace: {
                    ...state.sidePanelPaneIdByWorkspace,
                    [normalizedWorkspaceKey]: paneId,
                  },
                },
          );
          // Focusing a hidden pane reveals it, so this is both halves of "show".
          get().focusPane(normalizedWorkspaceKey, paneId);
          return paneId;
        },
        hideSidePanel: (workspaceKey) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return;
          }

          set((state) => {
            const layout = getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey);
            const paneId = resolveSidePanelPaneId(
              layout,
              state.sidePanelPaneIdByWorkspace[normalizedWorkspaceKey],
            );
            const nextLayout = paneId
              ? setPaneHiddenInLayout({ layout, paneId, hidden: true })
              : null;
            if (!nextLayout) {
              return state;
            }

            return {
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        closeTab: (workspaceKey, tabId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedTabId = trimNonEmpty(tabId);
          if (!normalizedWorkspaceKey || !normalizedTabId) {
            return;
          }

          set((state) => {
            const layout = getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey);
            const sidePanelPaneId = resolveSidePanelPaneId(
              layout,
              state.sidePanelPaneIdByWorkspace[normalizedWorkspaceKey],
            );
            const closingPane = findPaneContainingTab(layout.root, normalizedTabId);
            const closingTab = collectAllTabs(layout.root).find(
              (tab) => tab.tabId === normalizedTabId,
            );
            if (
              closingPane?.tabIds.length === 1 &&
              closingTab?.target.kind === "new_tab" &&
              closingPane.id !== sidePanelPaneId
            ) {
              const nextLayout = closePaneInLayout({ layout, paneId: closingPane.id });
              if (!nextLayout) {
                return state;
              }
              return {
                ...withoutFocusRestoration(state, normalizedWorkspaceKey),
                layoutByWorkspace: {
                  ...state.layoutByWorkspace,
                  [normalizedWorkspaceKey]: nextLayout,
                },
              };
            }
            const preserveEmptyPaneId =
              closingPane?.id === DEFAULT_PANE_ID || closingPane?.id === sidePanelPaneId
                ? closingPane.id
                : null;
            const closedLayout = closeTabInLayout({
              layout,
              tabId: normalizedTabId,
              preserveEmptyPaneId,
            });
            const nextLayout =
              closedLayout && closingPane?.id === sidePanelPaneId && closingPane.tabIds.length === 1
                ? (setPaneHiddenInLayout({
                    layout: closedLayout,
                    paneId: sidePanelPaneId,
                    hidden: true,
                  }) ?? closedLayout)
                : closedLayout;
            if (!nextLayout) {
              return state;
            }

            return {
              ...withoutFocusRestoration(state, normalizedWorkspaceKey),
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        focusTab: (workspaceKey, tabId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedTabId = trimNonEmpty(tabId);
          if (!normalizedWorkspaceKey || !normalizedTabId) {
            return;
          }

          set((state) => {
            const nextLayout = focusTabInLayout({
              layout: getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey),
              tabId: normalizedTabId,
            });
            if (!nextLayout) {
              return state;
            }

            return {
              ...withoutFocusRestoration(state, normalizedWorkspaceKey),
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        replaceTab: (workspaceKey, tabId, target, tabState) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedTabId = trimNonEmpty(tabId);
          const normalizedTarget = normalizeWorkspaceTabTarget(target);
          if (!normalizedWorkspaceKey || !normalizedTabId || !normalizedTarget) return null;
          const prepared = getOpenTabPlacement(
            get(),
            normalizedWorkspaceKey,
            normalizedTarget,
            undefined,
            ids,
          );
          if (!prepared) return null;
          const sourcePane = findPaneContainingTab(prepared.layout.root, normalizedTabId);
          const result = replaceTabTargetInLayout({
            layout: prepared.layout,
            tabId: normalizedTabId,
            target: normalizedTarget,
            createTabId: createWorkspaceTabInstanceId,
            state: tabState,
          });
          if (!result) return null;
          let nextLayout = result.layout;
          if (
            prepared.sidePanelPaneId &&
            sourcePane?.id === prepared.sidePanelPaneId &&
            !isWorkspaceSidePanelToolTarget(normalizedTarget)
          ) {
            const mainPaneId = findMainWorkspacePaneId(
              nextLayout,
              prepared.sidePanelPaneId,
            );
            if (mainPaneId) {
              nextLayout =
                moveTabToPaneInLayout({
                  layout: nextLayout,
                  tabId: result.tabId,
                  toPaneId: mainPaneId,
                  preserveEmptyPaneId: prepared.sidePanelPaneId,
                }) ?? nextLayout;
            }
          }
          nextLayout = enforceWorkspaceTabZones({
            layout: nextLayout,
            sidePanelPaneId: prepared.sidePanelPaneId,
            ids,
          });
          set((state) => ({
            ...withoutFocusRestoration(state, normalizedWorkspaceKey),
            hiddenAgentIdsByWorkspace:
              normalizedTarget.kind !== "agent"
                ? state.hiddenAgentIdsByWorkspace
                : removeAgentIdFromWorkspaceSet(
                    state.hiddenAgentIdsByWorkspace,
                    normalizedWorkspaceKey,
                    normalizedTarget.agentId,
                  ),
            layoutByWorkspace: {
              ...state.layoutByWorkspace,
              [normalizedWorkspaceKey]: nextLayout,
            },
          }));
          return result.tabId;
        },
        setTabState: (workspaceKey, tabId, tabState) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedTabId = trimNonEmpty(tabId);
          if (!normalizedWorkspaceKey || !normalizedTabId) return;
          set((state) => {
            const layout = setTabStateInLayout({
              layout: getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey),
              tabId: normalizedTabId,
              state: tabState,
            });
            if (!layout) return state;
            return {
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: layout,
              },
            };
          });
        },
        convertDraftToAgent: (workspaceKey, tabId, agentId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedTabId = trimNonEmpty(tabId);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedTabId || !normalizedAgentId) {
            return null;
          }

          const prepared = getOpenTabPlacement(
            get(),
            normalizedWorkspaceKey,
            { kind: "agent", agentId: normalizedAgentId },
            undefined,
            ids,
          );
          if (!prepared) {
            return null;
          }
          const result = convertDraftToAgentInLayout({
            layout: prepared.layout,
            tabId: normalizedTabId,
            agentId: normalizedAgentId,
          });
          if (!result) {
            return null;
          }
          const nextLayout = enforceWorkspaceTabZones({
            layout: result.layout,
            sidePanelPaneId: prepared.sidePanelPaneId,
            ids,
          });

          set((state) => ({
            ...(nextLayout.focusedPaneId !== null
              ? (withoutFocusRestoration(state, normalizedWorkspaceKey) ?? {})
              : {}),
            hiddenAgentIdsByWorkspace: removeAgentIdFromWorkspaceSet(
              state.hiddenAgentIdsByWorkspace,
              normalizedWorkspaceKey,
              normalizedAgentId,
            ),
            layoutByWorkspace: {
              ...state.layoutByWorkspace,
              [normalizedWorkspaceKey]: nextLayout,
            },
          }));

          return result.tabId;
        },
        reconcileTabs: (workspaceKey, snapshot) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return;
          }

          set((state) => {
            const currentLayout = getWorkspaceLayout(
              state.layoutByWorkspace,
              normalizedWorkspaceKey,
            );
            const sidePanelPaneId = resolveSidePanelPaneId(
              currentLayout,
              state.sidePanelPaneIdByWorkspace[normalizedWorkspaceKey],
            );
            const nextState = reconcileWorkspaceTabs(
              {
                layout: currentLayout,
                pinnedAgentIds: state.pinnedAgentIdsByWorkspace[normalizedWorkspaceKey] ?? null,
                pendingAgentIds: state.pendingAgentIdsByWorkspace[normalizedWorkspaceKey] ?? null,
                hiddenAgentIds: state.hiddenAgentIdsByWorkspace[normalizedWorkspaceKey] ?? null,
                sidePanelPaneId,
              },
              snapshot,
            );
            const nextLayout = enforceWorkspaceTabZones({
              layout: nextState.layout,
              sidePanelPaneId,
              ids,
            });
            if (nextLayout === currentLayout) {
              return state;
            }

            return {
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        resolvePendingAgent: (workspaceKey, agentId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedAgentId) {
            return;
          }

          set((state) => {
            const pendingAgentIdsByWorkspace = removeAgentIdFromWorkspaceSet(
              state.pendingAgentIdsByWorkspace,
              normalizedWorkspaceKey,
              normalizedAgentId,
            );
            if (pendingAgentIdsByWorkspace === state.pendingAgentIdsByWorkspace) {
              return state;
            }
            return { pendingAgentIdsByWorkspace };
          });
        },
        reorderTabs: (workspaceKey, tabIds) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return;
          }

          set((state) => {
            const nextLayout = reorderFocusedPaneTabsInLayout({
              layout: getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey),
              tabIds,
            });
            if (!nextLayout) {
              return state;
            }

            return {
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        getWorkspaceTabs: (workspaceKey) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return [];
          }
          return collectAllTabs(
            getWorkspaceLayout(get().layoutByWorkspace, normalizedWorkspaceKey).root,
          );
        },
        splitPane: (workspaceKey, input) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedTabId = trimNonEmpty(input.tabId);
          const normalizedTargetPaneId = trimNonEmpty(input.targetPaneId);
          if (!normalizedWorkspaceKey || !normalizedTabId || !normalizedTargetPaneId) {
            return null;
          }

          const currentLayout = getWorkspaceLayout(
            get().layoutByWorkspace,
            normalizedWorkspaceKey,
          );
          const result = splitPaneInLayout({
            layout: currentLayout,
            tabId: normalizedTabId,
            targetPaneId: normalizedTargetPaneId,
            position: input.position,
            maxTreeDepth: MAX_TREE_DEPTH,
            createNodeId: ids.createNodeId,
          });
          if (!result) {
            return null;
          }

          set((state) => ({
            ...withoutFocusRestoration(state, normalizedWorkspaceKey),
            layoutByWorkspace: {
              ...state.layoutByWorkspace,
              [normalizedWorkspaceKey]: result.layout,
            },
          }));

          return result.paneId;
        },
        splitPaneEmpty: (workspaceKey, input) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedTargetPaneId = trimNonEmpty(input.targetPaneId);
          if (!normalizedWorkspaceKey || !normalizedTargetPaneId) {
            return null;
          }

          const result = splitPaneEmptyInLayout({
            layout: getWorkspaceLayout(get().layoutByWorkspace, normalizedWorkspaceKey),
            targetPaneId: normalizedTargetPaneId,
            position: input.position,
            maxTreeDepth: MAX_TREE_DEPTH,
            createNodeId: ids.createNodeId,
          });
          if (!result) {
            return null;
          }

          set((state) => ({
            ...withoutFocusRestoration(state, normalizedWorkspaceKey),
            layoutByWorkspace: {
              ...state.layoutByWorkspace,
              [normalizedWorkspaceKey]: result.layout,
            },
          }));

          return result.paneId;
        },
        moveTabToPane: (workspaceKey, tabId, toPaneId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedTabId = trimNonEmpty(tabId);
          const normalizedToPaneId = trimNonEmpty(toPaneId);
          if (!normalizedWorkspaceKey || !normalizedTabId || !normalizedToPaneId) {
            return;
          }

          set((state) => {
            const layout = getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey);
            const sidePanelPaneId = resolveSidePanelPaneId(
              layout,
              state.sidePanelPaneIdByWorkspace[normalizedWorkspaceKey],
            );
            const sourcePane = findPaneContainingTab(layout.root, normalizedTabId);
            if (
              sidePanelPaneId &&
              sourcePane?.id !== normalizedToPaneId &&
              (sourcePane?.id === sidePanelPaneId || normalizedToPaneId === sidePanelPaneId)
            ) {
              return state;
            }
            const nextLayout = moveTabToPaneInLayout({
              layout,
              tabId: normalizedTabId,
              toPaneId: normalizedToPaneId,
              preserveEmptyPaneId: sidePanelPaneId,
            });
            if (!nextLayout) {
              return state;
            }

            return {
              ...withoutFocusRestoration(state, normalizedWorkspaceKey),
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        closePane: (workspaceKey, paneId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedPaneId = trimNonEmpty(paneId);
          if (!normalizedWorkspaceKey || !normalizedPaneId) {
            return;
          }

          set((state) => {
            const layout = getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey);
            // The side panel is a surface the user summons, so closing it puts it
            // away rather than dismantling the split it lives in.
            const isSidePanel =
              resolveSidePanelPaneId(
                layout,
                state.sidePanelPaneIdByWorkspace[normalizedWorkspaceKey],
              ) === normalizedPaneId;
            const nextLayout = isSidePanel
              ? setPaneHiddenInLayout({ layout, paneId: normalizedPaneId, hidden: true })
              : closePaneInLayout({ layout, paneId: normalizedPaneId });
            if (!nextLayout) {
              return state;
            }

            return {
              ...withoutFocusRestoration(state, normalizedWorkspaceKey),
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        focusPane: (workspaceKey, paneId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedPaneId = trimNonEmpty(paneId);
          if (!normalizedWorkspaceKey || !normalizedPaneId) {
            return;
          }

          set((state) => {
            const nextLayout = focusPaneInLayout({
              layout: getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey),
              paneId: normalizedPaneId,
            });
            if (!nextLayout) {
              return state;
            }

            return {
              ...withoutFocusRestoration(state, normalizedWorkspaceKey),
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        unfocusPane: (workspaceKey) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return null;
          }

          const token = ids.createFocusRestorationToken();
          set((state) => {
            const layout = getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey);
            const currentRestoration = state.focusRestorationByWorkspace[normalizedWorkspaceKey];
            const restorePaneId = currentRestoration?.restorePaneId ?? layout.focusedPaneId;

            return {
              focusRestorationByWorkspace: {
                ...state.focusRestorationByWorkspace,
                [normalizedWorkspaceKey]: {
                  restorePaneId,
                  tokens: [...(currentRestoration?.tokens ?? []), token],
                },
              },
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]:
                  layout.focusedPaneId === null ? layout : { ...layout, focusedPaneId: null },
              },
            };
          });
          return token;
        },
        restorePaneFocus: (workspaceKey, token) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedToken = trimNonEmpty(token);
          if (!normalizedWorkspaceKey || !normalizedToken) {
            return;
          }

          set((state) => {
            const restoration = state.focusRestorationByWorkspace[normalizedWorkspaceKey];
            if (!restoration?.tokens.includes(normalizedToken)) {
              return state;
            }

            const nextTokens = restoration.tokens.filter((entry) => entry !== normalizedToken);
            const { [normalizedWorkspaceKey]: _removed, ...remainingRestorations } =
              state.focusRestorationByWorkspace;
            const layout = getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey);

            if (layout.focusedPaneId !== null) {
              return {
                focusRestorationByWorkspace: remainingRestorations,
              };
            }

            if (nextTokens.length > 0) {
              return {
                focusRestorationByWorkspace: {
                  ...remainingRestorations,
                  [normalizedWorkspaceKey]: {
                    restorePaneId: restoration.restorePaneId,
                    tokens: nextTokens,
                  },
                },
              };
            }

            const restorePane = findPaneById(layout.root, restoration.restorePaneId);
            const restorePaneId = restorePane?.hidden === true ? null : (restorePane?.id ?? null);
            if (!restorePaneId) {
              return {
                focusRestorationByWorkspace: remainingRestorations,
              };
            }

            return {
              focusRestorationByWorkspace: remainingRestorations,
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: {
                  ...layout,
                  focusedPaneId: restorePaneId,
                },
              },
            };
          });
        },
        resizeSplit: (workspaceKey, groupId, sizes) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedGroupId = trimNonEmpty(groupId);
          if (!normalizedWorkspaceKey || !normalizedGroupId) {
            return;
          }

          set((state) => ({
            splitSizesByWorkspace: {
              ...state.splitSizesByWorkspace,
              [normalizedWorkspaceKey]: {
                ...state.splitSizesByWorkspace[normalizedWorkspaceKey],
                [normalizedGroupId]: clampNormalizedSizes(sizes),
              },
            },
          }));
        },
        reorderTabsInPane: (workspaceKey, paneId, tabIds) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedPaneId = trimNonEmpty(paneId);
          if (!normalizedWorkspaceKey || !normalizedPaneId) {
            return;
          }

          set((state) => {
            const nextLayout = reorderPaneTabsInLayout({
              layout: getWorkspaceLayout(state.layoutByWorkspace, normalizedWorkspaceKey),
              paneId: normalizedPaneId,
              tabIds,
            });
            if (!nextLayout) {
              return state;
            }

            return {
              ...withoutFocusRestoration(state, normalizedWorkspaceKey),
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [normalizedWorkspaceKey]: nextLayout,
              },
            };
          });
        },
        pinAgent: (workspaceKey, agentId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedAgentId) {
            return;
          }

          set((state) => {
            const currentPinnedAgentIds =
              state.pinnedAgentIdsByWorkspace[normalizedWorkspaceKey] ?? null;
            const currentPendingAgentIds =
              state.pendingAgentIdsByWorkspace[normalizedWorkspaceKey] ?? null;
            if (
              currentPinnedAgentIds?.has(normalizedAgentId) &&
              currentPendingAgentIds?.has(normalizedAgentId)
            ) {
              return state;
            }

            const nextPinnedAgentIds = new Set(currentPinnedAgentIds ?? []);
            nextPinnedAgentIds.add(normalizedAgentId);

            return {
              hiddenAgentIdsByWorkspace: removeAgentIdFromWorkspaceSet(
                state.hiddenAgentIdsByWorkspace,
                normalizedWorkspaceKey,
                normalizedAgentId,
              ),
              pinnedAgentIdsByWorkspace: {
                ...state.pinnedAgentIdsByWorkspace,
                [normalizedWorkspaceKey]: nextPinnedAgentIds,
              },
              pendingAgentIdsByWorkspace: addAgentIdToWorkspaceSet(
                state.pendingAgentIdsByWorkspace,
                normalizedWorkspaceKey,
                normalizedAgentId,
              ),
            };
          });
        },
        unpinAgent: (workspaceKey, agentId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedAgentId) {
            return;
          }

          set((state) => {
            const currentPinnedAgentIds =
              state.pinnedAgentIdsByWorkspace[normalizedWorkspaceKey] ?? null;
            if (!currentPinnedAgentIds?.has(normalizedAgentId)) {
              return state;
            }

            if (currentPinnedAgentIds.size === 1) {
              const nextPinnedAgentIdsByWorkspace = {
                ...state.pinnedAgentIdsByWorkspace,
              };
              delete nextPinnedAgentIdsByWorkspace[normalizedWorkspaceKey];
              return {
                pinnedAgentIdsByWorkspace: nextPinnedAgentIdsByWorkspace,
                pendingAgentIdsByWorkspace: removeAgentIdFromWorkspaceSet(
                  state.pendingAgentIdsByWorkspace,
                  normalizedWorkspaceKey,
                  normalizedAgentId,
                ),
              };
            }

            const nextPinnedAgentIds = new Set(currentPinnedAgentIds);
            nextPinnedAgentIds.delete(normalizedAgentId);

            return {
              pinnedAgentIdsByWorkspace: {
                ...state.pinnedAgentIdsByWorkspace,
                [normalizedWorkspaceKey]: nextPinnedAgentIds,
              },
              pendingAgentIdsByWorkspace: removeAgentIdFromWorkspaceSet(
                state.pendingAgentIdsByWorkspace,
                normalizedWorkspaceKey,
                normalizedAgentId,
              ),
            };
          });
        },
        hideAgent: (workspaceKey, agentId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedAgentId) {
            return;
          }

          set((state) => {
            const nextHiddenAgentIdsByWorkspace = addAgentIdToWorkspaceSet(
              state.hiddenAgentIdsByWorkspace,
              normalizedWorkspaceKey,
              normalizedAgentId,
            );
            if (nextHiddenAgentIdsByWorkspace === state.hiddenAgentIdsByWorkspace) {
              return state;
            }

            return {
              hiddenAgentIdsByWorkspace: nextHiddenAgentIdsByWorkspace,
            };
          });
        },
        unhideAgent: (workspaceKey, agentId) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedAgentId) {
            return;
          }

          set((state) => {
            const nextHiddenAgentIdsByWorkspace = removeAgentIdFromWorkspaceSet(
              state.hiddenAgentIdsByWorkspace,
              normalizedWorkspaceKey,
              normalizedAgentId,
            );
            if (nextHiddenAgentIdsByWorkspace === state.hiddenAgentIdsByWorkspace) {
              return state;
            }

            return {
              hiddenAgentIdsByWorkspace: nextHiddenAgentIdsByWorkspace,
            };
          });
        },
        purgeWorkspace: (workspaceKey) => {
          const normalizedWorkspaceKey = trimNonEmpty(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return;
          }

          set((state) => {
            const hasAny =
              normalizedWorkspaceKey in state.layoutByWorkspace ||
              normalizedWorkspaceKey in state.splitSizesByWorkspace ||
              normalizedWorkspaceKey in state.pinnedAgentIdsByWorkspace ||
              normalizedWorkspaceKey in state.pendingAgentIdsByWorkspace ||
              normalizedWorkspaceKey in state.hiddenAgentIdsByWorkspace ||
              normalizedWorkspaceKey in state.focusRestorationByWorkspace ||
              normalizedWorkspaceKey in state.sidePanelPaneIdByWorkspace;
            if (!hasAny) {
              return state;
            }
            const { [normalizedWorkspaceKey]: _layout, ...layoutByWorkspace } =
              state.layoutByWorkspace;
            const { [normalizedWorkspaceKey]: _splits, ...splitSizesByWorkspace } =
              state.splitSizesByWorkspace;
            const { [normalizedWorkspaceKey]: _pinned, ...pinnedAgentIdsByWorkspace } =
              state.pinnedAgentIdsByWorkspace;
            const { [normalizedWorkspaceKey]: _pending, ...pendingAgentIdsByWorkspace } =
              state.pendingAgentIdsByWorkspace;
            const { [normalizedWorkspaceKey]: _hidden, ...hiddenAgentIdsByWorkspace } =
              state.hiddenAgentIdsByWorkspace;
            const { [normalizedWorkspaceKey]: _restoration, ...focusRestorationByWorkspace } =
              state.focusRestorationByWorkspace;
            const { [normalizedWorkspaceKey]: _sidePanelPane, ...sidePanelPaneIdByWorkspace } =
              state.sidePanelPaneIdByWorkspace;
            return {
              layoutByWorkspace,
              splitSizesByWorkspace,
              pinnedAgentIdsByWorkspace,
              pendingAgentIdsByWorkspace,
              hiddenAgentIdsByWorkspace,
              focusRestorationByWorkspace,
              sidePanelPaneIdByWorkspace,
            };
          });
        },
      }),
      {
        name: "workspace-layout-state",
        version: 1,
        storage: createValidatedPersistStorage(AsyncStorage, WorkspaceLayoutPersistedStateSchema),
        partialize: (state) => {
          const layoutByWorkspace: Record<string, WorkspaceLayout> = {};
          for (const key in state.layoutByWorkspace) {
            // Strip ephemeral (commit diff) tabs before persisting so they are
            // dropped on reload rather than restored pointing at a rebased SHA.
            layoutByWorkspace[key] = stripEphemeralTabsFromLayout(
              normalizeLayout(state.layoutByWorkspace[key]),
            );
          }
          return {
            layoutByWorkspace,
            splitSizesByWorkspace: state.splitSizesByWorkspace,
            explorerPaneIdByWorkspace: state.sidePanelPaneIdByWorkspace,
          };
        },
        merge: (persistedState, currentState) => {
          const result = WorkspaceLayoutPersistedStateSchema.safeParse(persistedState);
          if (!result.success) {
            return currentState;
          }
          const layoutByWorkspace: Record<string, WorkspaceLayout> = {};
          const sidePanelPaneIdByWorkspace: Record<string, string | null> = {
            ...result.data.explorerPaneIdByWorkspace,
          };
          for (const [workspaceKey, persistedLayout] of Object.entries(
            result.data.layoutByWorkspace,
          )) {
            const restoredLayout = restoreEmptyPanesInLayout(
              stripEphemeralTabsFromLayout(persistedLayout),
            );
            const sidePanel = ensurePersistedSidePanelPane({
              layout: restoredLayout,
              registeredPaneId: sidePanelPaneIdByWorkspace[workspaceKey],
              ids,
            });
            const nextSidePanelPaneId = sidePanel?.paneId ?? null;
            const nextLayout = enforceWorkspaceTabZones({
              layout: sidePanel?.layout ?? restoredLayout,
              sidePanelPaneId: nextSidePanelPaneId,
              ids,
            });
            layoutByWorkspace[workspaceKey] = nextLayout;
            if (sidePanel) {
              sidePanelPaneIdByWorkspace[workspaceKey] = sidePanel.paneId;
            }
          }
          return {
            ...currentState,
            layoutByWorkspace,
            splitSizesByWorkspace: result.data.splitSizesByWorkspace ?? {},
            sidePanelPaneIdByWorkspace,
          };
        },
      },
    ),
  );
}

export const useWorkspaceLayoutStore = createWorkspaceLayoutStore();

export function useWorkspaceLayoutStoreHydrated(): boolean {
  const [hasHydrated, setHasHydrated] = useState(() =>
    useWorkspaceLayoutStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (useWorkspaceLayoutStore.persist.hasHydrated()) {
      setHasHydrated(true);
      return;
    }

    return useWorkspaceLayoutStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
  }, []);

  return hasHydrated;
}
