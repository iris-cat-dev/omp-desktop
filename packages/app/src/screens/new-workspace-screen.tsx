import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet as RNStyleSheet, Text, View } from "react-native";
import ReanimatedAnimated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageSquarePlus } from "lucide-react-native";
import { Composer } from "@/composer";
import { GoalBar, type GoalControlAction } from "@/composer/goal-bar";
import {
  resolveComposerAttachmentSubmitFormat,
  splitComposerAttachmentsForSubmit,
} from "@/composer/attachments/submit";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { HEADER_INNER_HEIGHT, MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useAgentInputDraft, type AgentInputDraft } from "@/composer/draft/input-draft";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { resolveTerminalProfiles } from "@omp-desktop/protocol/terminal-profiles";
import type { TerminalProfile } from "@omp-desktop/protocol/messages";
import { CHAT_LAUNCH_TARGET } from "@/new-workspace-launch/target";
import { useTerminalComposerState } from "@/new-workspace-launch/composer-state";
import { runCreateTerminalWorkspace } from "./new-workspace-terminal";
import { getDesktopHost } from "@/desktop/host";
import { resolveDesktopDefaultTerminalShell } from "@/terminal/default-shell";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatuses,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { useHostFeature, useHostFeatureMap } from "@/runtime/host-features";
import type { HostProfile } from "@/types/host-connection";
import {
  navigateToWorkspace,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { buildNewWorkspaceDraftKey, generateDraftId } from "@/stores/draft-keys";
import { isActiveCreateFlowForDraft, useCreateFlowStore } from "@/stores/create-flow-store";
import {
  useWorkspaceDraftSubmissionStore,
  type PendingWorkspaceDraftSetup,
} from "@/stores/workspace-draft-submission-store";
import { useSidebarConversationDraftStore } from "@/stores/sidebar-conversation-draft-store";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import type { CreateAgentInitialValues } from "@/hooks/use-agent-form-state";
import { generateMessageId } from "@/types/stream";
import { toErrorMessage } from "@/utils/error-messages";
import {
  getHostProjectId,
  hostProjectFromRoute,
  hostProjectFromWorkspace,
  resolveHostProjectCandidate,
  useHostProjects,
  type HostProjectListItem,
} from "@/projects/host-projects";
import type { ComposerAttachment } from "@/attachments/types";
import { useDraftWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import type { MessagePayload } from "@/composer/types";
import type { UserComposerAttachment } from "@/attachments/types";
import type { AgentAttachment, ForgeSearchItem } from "@omp-desktop/protocol/messages";
import type { AgentProvider } from "@omp-desktop/protocol/agent-types";
import type { WorkspaceDraftTabSetup, WorkspaceTabTarget } from "@/workspace-tabs/model";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openSupportingTab } from "@/workspace-tabs/side-panel";
import {
  WorkspaceDesktopTabsRow,
  type WorkspaceDesktopTabRowItem,
} from "@/screens/workspace/workspace-desktop-tabs-row";
import { WorkspaceHeaderActions } from "./workspace/workspace-header-actions";
import { WorkspaceNewTabMenuContent } from "./workspace/workspace-new-tab-menu";
import { NewTabLauncherProvider, type NewTabLauncher } from "@/workspace-tabs/launcher";
import type { NewTabSelection } from "@/workspace-tabs/new-tab";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { getIsElectron } from "@/constants/platform";
import { isEmptyWorkspaceSubmission, runCreateEmptyWorkspace } from "./new-workspace-empty";
import {
  getWorkspaceNamingAttachments,
  remapDraftCwdToWorkspace,
} from "./new-workspace-fork-context";
import { initialPickerSelectionState, reducePickerSelection } from "./new-workspace-picker-state";
import {
  resolveNewWorkspaceAutomaticServerId,
  resolveNewWorkspaceInitialServerId,
} from "./new-workspace-initial-context";
import { useNewWorkspaceProjectPicker } from "./new-workspace/project-picker";

const noopWorkspaceTabAction = () => {};

function useIsNewWorkspaceDraftHandoffActive(input: {
  draftId: string | undefined;
  selectedServerId: string;
}): boolean {
  const normalizedDraftId = input.draftId?.trim() ?? "";
  return useCreateFlowStore((state) =>
    isActiveCreateFlowForDraft({
      draftId: normalizedDraftId,
      serverId: input.selectedServerId,
      pending: normalizedDraftId ? state.pendingByDraftId[normalizedDraftId] : null,
    }),
  );
}

function resolveVisibleDraftContextScopeKeys(input: {
  isDraftHandoffActive: boolean;
  draftContextScopeKey: string;
}): readonly string[] {
  if (input.isDraftHandoffActive || !input.draftContextScopeKey) {
    return [];
  }
  return [input.draftContextScopeKey];
}

function isNewWorkspacePending(input: {
  pendingAction: "chat" | "empty" | "terminal" | null;
  isDraftHandoffActive: boolean;
}): boolean {
  return input.pendingAction !== null || input.isDraftHandoffActive;
}

function buildFirstAgentContext(input: {
  prompt: string;
  attachments: AgentAttachment[];
}): { prompt?: string; attachments?: AgentAttachment[] } | undefined {
  const trimmedPrompt = input.prompt.trim();
  if (!trimmedPrompt && input.attachments.length === 0) {
    return undefined;
  }

  return {
    ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
    attachments: input.attachments,
  };
}

interface NewWorkspaceScreenProps {
  serverId: string;
  sourceDirectory?: string;
  projectId?: string;
  displayName?: string;
  draftId?: string;
}

// A terminal launch sends argv, not a message: there is nothing to attach and
// no draft to persist, so the composer's attachment and draft seams are inert.
const NO_TERMINAL_ATTACHMENTS: UserComposerAttachment[] = [];
function noopChangeAttachments() {}
function noopClearDraft() {}

function getContentStyle(input: { isCompact: boolean; insetBottom: number }) {
  if (input.isCompact) {
    return [styles.content, styles.contentCompact, { paddingBottom: input.insetBottom }];
  }
  return [styles.content, styles.contentCentered];
}

interface SubmitDraftInput {
  serverId: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  draftId?: string;
  initialSetup?: WorkspaceDraftTabSetup;
  workspaceId: string;
  workspaceDirectory: string;
  text: string;
  attachments: ComposerAttachment[];
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
  supportsForgeSearch: boolean;
}

type NewWorkspaceComposerState = NonNullable<
  ReturnType<typeof useAgentInputDraft>["composerState"]
>;

interface WorkspaceDraftSubmissionConfig {
  cwd: string;
  provider: AgentProvider;
  modeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown> | undefined;
  target: WorkspaceTabTarget;
}

async function createWorkspaceForConversation(input: {
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  project: HostProjectListItem;
  sourceDirectory: string;
  withInitialAgent: boolean;
  prompt: string;
  attachments: AgentAttachment[];
  mergeWorkspaces: (
    serverId: string,
    workspaces: ReturnType<typeof normalizeWorkspaceDescriptor>[],
  ) => void;
  serverId: string;
  createFailedMessage: string;
}): Promise<ReturnType<typeof normalizeWorkspaceDescriptor>> {
  const projectId = getHostProjectId(input.project, input.serverId);
  if (!projectId) throw new Error("Project is not available on the selected host");
  const firstAgentContext = buildFirstAgentContext({
    prompt: input.prompt,
    attachments: input.attachments,
  });
  const payload = await input.client.createWorkspace({
    source: {
      kind: "directory",
      path: input.sourceDirectory,
      projectId,
    },
    ...(firstAgentContext ? { firstAgentContext } : {}),
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? input.createFailedMessage);
  }
  const normalizedWorkspace = normalizeWorkspaceDescriptor(payload.workspace);
  const workspaceForInitialMerge = input.withInitialAgent
    ? { ...normalizedWorkspace, status: "running" as const, statusEnteredAt: new Date() }
    : normalizedWorkspace;
  input.mergeWorkspaces(input.serverId, [workspaceForInitialMerge]);
  return normalizedWorkspace;
}

interface CreateChatAgentInput {
  payload: MessagePayload;
  composerState: ReturnType<typeof useAgentInputDraft>["composerState"];
  forkDraftSetup?: PendingWorkspaceDraftSetup | null;
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
    withInitialAgent: boolean;
  }) => Promise<ReturnType<typeof normalizeWorkspaceDescriptor>>;
  serverId: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  draftId?: string;
  supportsForgeSearch: boolean;
  labels: {
    composerStateRequired: string;
    selectModel: string;
  };
}

function buildWorkspaceDraftSetupFromComposer(input: {
  cwd: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
}): WorkspaceDraftTabSetup {
  return {
    provider: input.provider,
    cwd: input.cwd,
    modeId: input.composerState.selectedMode || null,
    model: input.composerState.effectiveModelId || null,
    thinkingOptionId: input.composerState.effectiveThinkingOptionId || null,
    featureValues: input.composerState.featureValues ?? {},
  };
}

function buildWorkspaceDraftSetupForCreatedWorkspace(input: {
  forkDraftSetup: PendingWorkspaceDraftSetup | null | undefined;
  workspaceDirectory: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
}): WorkspaceDraftTabSetup | undefined {
  if (!input.forkDraftSetup) {
    return undefined;
  }
  return buildWorkspaceDraftSetupFromComposer({
    cwd: remapDraftCwdToWorkspace({
      cwd: input.forkDraftSetup.setup.cwd,
      sourceDirectory: input.forkDraftSetup.sourceDirectory,
      workspaceDirectory: input.workspaceDirectory,
    }),
    provider: input.provider,
    composerState: input.composerState,
  });
}

function buildComposerInitialValues(input: {
  workingDir: string | undefined;
  initialSetup?: WorkspaceDraftTabSetup | null;
}): CreateAgentInitialValues | undefined {
  if (input.initialSetup) {
    return {
      workingDir: input.workingDir ?? input.initialSetup.cwd,
      provider: input.initialSetup.provider,
      modeId: input.initialSetup.modeId,
      model: input.initialSetup.model,
      thinkingOptionId: input.initialSetup.thinkingOptionId,
    };
  }
  if (input.workingDir) {
    return { workingDir: input.workingDir };
  }
  return undefined;
}

async function runCreateChatAgent(input: CreateChatAgentInput): Promise<void> {
  const { payload, composerState, ensureWorkspace, serverId, clearDraft } = input;
  const { text, attachments, cwd } = payload;
  if (!composerState) {
    throw new Error(input.labels.composerStateRequired);
  }
  const provider = composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.labels.selectModel);
  }
  const attachmentSubmitFormat = resolveComposerAttachmentSubmitFormat({
    supportsForgeAttachments: input.supportsForgeSearch,
  });
  const { attachments: reviewAttachments } = splitComposerAttachmentsForSubmit(attachments, {
    format: attachmentSubmitFormat,
  });
  const workspaceNamingAttachments = getWorkspaceNamingAttachments(reviewAttachments);
  const ensuredWorkspace = await ensureWorkspace({
    cwd,
    prompt: text,
    attachments: workspaceNamingAttachments,
    withInitialAgent: true,
  });
  const initialSetup = buildWorkspaceDraftSetupForCreatedWorkspace({
    forkDraftSetup: input.forkDraftSetup,
    workspaceDirectory: ensuredWorkspace.workspaceDirectory,
    provider,
    composerState,
  });
  submitWorkspaceDraft({
    serverId,
    clearDraft,
    draftId: input.draftId,
    initialSetup,
    workspaceId: ensuredWorkspace.id,
    workspaceDirectory: ensuredWorkspace.workspaceDirectory,
    text,
    attachments,
    provider,
    composerState,
    supportsForgeSearch: input.supportsForgeSearch,
  });
}

function buildComposerConfig(input: {
  serverId: string;
  isConnected: boolean;
  workspaceDirectory: string | null;
  sourceDirectory: string | null;
  initialSetup?: WorkspaceDraftTabSetup | null;
}): Parameters<typeof useAgentInputDraft>[0]["composer"] {
  const { serverId, isConnected, workspaceDirectory, sourceDirectory, initialSetup } = input;
  const workingDir = workspaceDirectory || sourceDirectory || undefined;
  return {
    initialServerId: serverId || null,
    initialValues: buildComposerInitialValues({ workingDir, initialSetup }),
    initialFeatureValues: initialSetup?.featureValues,
    isVisible: true,
    onlineServerIds: isConnected && serverId ? [serverId] : [],
    lockedWorkingDir: workingDir,
  };
}

function usePendingWorkspaceDraftSetup(
  draftId: string | undefined,
): PendingWorkspaceDraftSetup | null {
  const normalizedDraftId = draftId?.trim() ?? "";
  return useWorkspaceDraftSubmissionStore((state) => {
    if (!normalizedDraftId) {
      return null;
    }
    return state.setupByDraftId[normalizedDraftId] ?? null;
  });
}

function resolveWorkspaceDraftSubmissionConfig(input: {
  draftId: string;
  workspaceDirectory: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
  initialSetup?: WorkspaceDraftTabSetup;
}): WorkspaceDraftSubmissionConfig {
  const { draftId, workspaceDirectory, provider, composerState, initialSetup } = input;
  if (initialSetup) {
    return {
      cwd: initialSetup.cwd,
      provider: initialSetup.provider,
      modeId: initialSetup.modeId,
      model: initialSetup.model,
      thinkingOptionId: initialSetup.thinkingOptionId,
      featureValues: initialSetup.featureValues,
      target: { kind: "draft", draftId, setup: initialSetup },
    };
  }
  return {
    cwd: workspaceDirectory,
    provider,
    modeId: composerState.selectedMode || null,
    model: composerState.effectiveModelId || null,
    thinkingOptionId: composerState.effectiveThinkingOptionId || null,
    featureValues: composerState.featureValues,
    target: { kind: "draft", draftId },
  };
}

function submitWorkspaceDraft(input: SubmitDraftInput): void {
  const {
    serverId,
    clearDraft,
    draftId: draftIdInput,
    workspaceId,
    workspaceDirectory,
    text,
    attachments,
    provider,
    composerState,
    initialSetup,
  } = input;
  const draftId = draftIdInput?.trim() || generateDraftId();
  const clientMessageId = generateMessageId();
  const timestamp = Date.now();
  const wirePayload = splitComposerAttachmentsForSubmit(attachments, {
    format: resolveComposerAttachmentSubmitFormat({
      supportsForgeAttachments: input.supportsForgeSearch,
    }),
  });
  const submission = resolveWorkspaceDraftSubmissionConfig({
    draftId,
    workspaceDirectory,
    provider,
    composerState,
    initialSetup,
  });
  useCreateFlowStore.getState().setPending({
    serverId,
    draftId,
    workspaceId,
    agentId: null,
    clientMessageId,
    text: text.trim(),
    timestamp,
    ...(wirePayload.images.length > 0 ? { images: wirePayload.images } : {}),
    ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
  });
  useWorkspaceDraftSubmissionStore.getState().setPending({
    serverId,
    workspaceId,
    draftId,
    text: text.trim(),
    attachments,
    cwd: submission.cwd,
    provider: submission.provider,
    clientMessageId,
    timestamp,
    ...(submission.modeId ? { modeId: submission.modeId } : {}),
    ...(submission.model ? { model: submission.model } : {}),
    ...(submission.thinkingOptionId ? { thinkingOptionId: submission.thinkingOptionId } : {}),
    ...(submission.featureValues ? { featureValues: submission.featureValues } : {}),
    allowEmptyText: true,
  });
  clearDraft("sent");
  navigateToWorkspace({
    serverId,
    workspaceId,
    target: submission.target,
  });
}

function useNewWorkspaceHostSelector(input: {
  initialServerId: string;
  allServerIds: string[];
  projects: HostProjectListItem[];
  lastActiveProject: HostProjectListItem | null;
  hostConnectionStatusByServerId: ReadonlyMap<string, HostRuntimeConnectionStatus>;
  workspaceMultiplicityByServerId: ReadonlyMap<string, boolean>;
}) {
  const routeServerId = input.initialServerId.trim();
  const defaultServerId = useMemo(
    () =>
      resolveNewWorkspaceInitialServerId({
        allServerIds: input.allServerIds,
        routeServerId: input.initialServerId,
        lastActiveProject: input.lastActiveProject,
        projects: input.projects,
        hostConnectionStatusByServerId: input.hostConnectionStatusByServerId,
        workspaceMultiplicityByServerId: input.workspaceMultiplicityByServerId,
      }),
    [
      input.allServerIds,
      input.hostConnectionStatusByServerId,
      input.initialServerId,
      input.lastActiveProject,
      input.projects,
      input.workspaceMultiplicityByServerId,
    ],
  );
  const [automaticSelection, setAutomaticSelection] = useState(() => ({
    routeServerId,
    serverId: defaultServerId,
  }));
  const [manualSelection, setManualSelection] = useState<{
    routeServerId: string;
    serverId: string;
  } | null>(null);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);

  useEffect(() => {
    setAutomaticSelection((current) => {
      const nextServerId =
        current.routeServerId === routeServerId
          ? resolveNewWorkspaceAutomaticServerId({
              allServerIds: input.allServerIds,
              routeServerId: input.initialServerId,
              lastActiveProject: input.lastActiveProject,
              projects: input.projects,
              hostConnectionStatusByServerId: input.hostConnectionStatusByServerId,
              workspaceMultiplicityByServerId: input.workspaceMultiplicityByServerId,
              currentServerId: current.serverId,
              nextServerId: defaultServerId,
            })
          : defaultServerId;

      if (current.routeServerId === routeServerId && current.serverId === nextServerId) {
        return current;
      }

      return { routeServerId, serverId: nextServerId };
    });
  }, [
    defaultServerId,
    input.allServerIds,
    input.hostConnectionStatusByServerId,
    input.initialServerId,
    input.lastActiveProject,
    input.projects,
    input.workspaceMultiplicityByServerId,
    routeServerId,
  ]);

  const automaticServerId =
    automaticSelection.routeServerId === routeServerId &&
    input.allServerIds.includes(automaticSelection.serverId)
      ? automaticSelection.serverId
      : defaultServerId;
  const selectedServerId =
    manualSelection?.routeServerId === routeServerId &&
    input.allServerIds.includes(manualSelection.serverId)
      ? manualSelection.serverId
      : automaticServerId;

  const handleSelectHost = useCallback(
    (id: string) => {
      setManualSelection({ routeServerId, serverId: id });
      setHostPickerOpen(false);
    },
    [routeServerId],
  );

  const handleHostPickerOpenChange = useCallback((open: boolean) => {
    setHostPickerOpen(open);
  }, []);

  const openHostPicker = useCallback(() => {
    setHostPickerOpen(true);
  }, []);

  return {
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
  };
}

interface NewWorkspaceInitialContextState {
  allHosts: HostProfile[];
  selectedServerId: string;
  hostPickerOpen: boolean;
  handleSelectHost: (id: string) => void;
  handleHostPickerOpenChange: (open: boolean) => void;
  openHostPicker: () => void;
  projects: HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  routeProjectContextViewKey: string | null;
  lastActiveProject: HostProjectListItem | null;
}

function useNewWorkspaceInitialContext({
  serverId,
  sourceDirectory: sourceDirectoryProp,
  projectId,
  displayName: displayNameProp,
}: NewWorkspaceScreenProps): NewWorkspaceInitialContextState {
  const allHosts = useHosts();
  const allServerIds = useMemo(() => allHosts.map((h) => h.serverId), [allHosts]);
  const projects = useHostProjects(allServerIds);
  const routeDisplayName = displayNameProp?.trim() ?? "";
  const routePlacement = useMemo(
    () =>
      hostProjectFromRoute({
        serverId,
        projectId,
        displayName: routeDisplayName,
        sourceDirectory: sourceDirectoryProp,
      }),
    [projectId, routeDisplayName, serverId, sourceDirectoryProp],
  );
  const routeProject = useMemo(() => {
    if (!routePlacement) return null;
    return (
      resolveHostProjectCandidate({
        candidate: routePlacement,
        projects,
        serverId,
      }) ?? routePlacement
    );
  }, [projects, routePlacement, serverId]);
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const lastWorkspaceServerId = useMemo(
    () =>
      lastWorkspaceSelection && allServerIds.includes(lastWorkspaceSelection.serverId)
        ? lastWorkspaceSelection.serverId
        : null,
    [allServerIds, lastWorkspaceSelection],
  );
  const lastWorkspaceId = lastWorkspaceServerId ? lastWorkspaceSelection!.workspaceId : null;
  const lastWorkspace = useWorkspace(lastWorkspaceServerId, lastWorkspaceId);
  const lastActiveProject = useMemo(
    () =>
      lastWorkspaceServerId
        ? hostProjectFromWorkspace({ serverId: lastWorkspaceServerId, workspace: lastWorkspace })
        : null,
    [lastWorkspace, lastWorkspaceServerId],
  );
  const hostConnectionStatusByServerId = useHostRuntimeConnectionStatuses(allServerIds);
  const workspaceMultiplicityByServerId = useHostFeatureMap(allServerIds, "workspaceMultiplicity");
  const {
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
  } = useNewWorkspaceHostSelector({
    initialServerId: serverId,
    allServerIds,
    projects,
    lastActiveProject,
    hostConnectionStatusByServerId,
    workspaceMultiplicityByServerId,
  });

  return {
    allHosts,
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
    projects,
    routeProject,
    routeProjectContextViewKey: routePlacement?.viewKey ?? null,
    lastActiveProject,
  };
}

export function NewWorkspaceScreen({
  serverId,
  sourceDirectory: sourceDirectoryProp,
  projectId,
  displayName: displayNameProp,
  draftId,
}: NewWorkspaceScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompact = useIsCompactFormFactor();
  const lastWorkspaceSelectionForHeader = useLastWorkspaceSelection();
  const toast = useToast();
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const {
    selectedServerId,
    projects,
    routeProject,
    routeProjectContextViewKey,
    lastActiveProject,
  } = useNewWorkspaceInitialContext({
    serverId,
    sourceDirectory: sourceDirectoryProp,
    projectId,
    displayName: displayNameProp,
  });
  const terminalActiveConnection =
    useHostRuntimeSnapshot(selectedServerId)?.activeConnection ?? null;
  // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
  const supportsForgeSearch = useHostFeature(selectedServerId, "forgeSearch");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<ReturnType<
    typeof normalizeWorkspaceDescriptor
  > | null>(null);
  const [pendingAction, setPendingAction] = useState<"chat" | "empty" | "terminal" | null>(null);
  const isDraftHandoffActive = useIsNewWorkspaceDraftHandoffActive({ draftId, selectedServerId });

  const { updatePreferences: updateFormPreferences } = useFormPreferences();
  const { config: daemonConfig } = useDaemonConfig(selectedServerId);
  const terminalProfiles: readonly TerminalProfile[] = useMemo(
    () => resolveTerminalProfiles(daemonConfig?.terminalProfiles),
    [daemonConfig?.terminalProfiles],
  );
  const launchTarget = CHAT_LAUNCH_TARGET;
  const [terminalPromptText, setTerminalPromptText] = useState("");
  const {
    isTerminalLaunch,
    selectedTerminalProfile,
    terminalTakesPrompt,
    terminalComposerValue,
    terminalPlaceholder,
    terminalSubmitLabel,
    launchFocusKey,
  } = useTerminalComposerState({ launchTarget, terminalProfiles, terminalPromptText });

  const workspace = createdWorkspace;
  const client = useHostRuntimeClient(selectedServerId);
  const isConnected = useHostRuntimeIsConnected(selectedServerId);
  const { selectedProject, selectedSourceDirectory } = useNewWorkspaceProjectPicker({
    selectedServerId,
    projects,
    routeProject,
    routeProjectContextViewKey,
    lastActiveProject,
    allowAllProjects: true,
  });

  const draftKey = buildNewWorkspaceDraftKey(draftId);
  const forkDraftSetup = usePendingWorkspaceDraftSetup(draftId);
  const draftContextScopeKey = useDraftWorkspaceAttachmentScopeKey(draftId);
  const visibleDraftContextScopeKeys = useMemo(
    () => resolveVisibleDraftContextScopeKeys({ isDraftHandoffActive, draftContextScopeKey }),
    [draftContextScopeKey, isDraftHandoffActive],
  );
  const chatDraft = useAgentInputDraft({
    draftKey,
    composer: buildComposerConfig({
      serverId: selectedServerId,
      isConnected,
      workspaceDirectory: workspace?.workspaceDirectory ?? null,
      sourceDirectory: selectedSourceDirectory,
      initialSetup: forkDraftSetup?.setup,
    }),
  });
  const setSidebarDraftHasContent = useSidebarConversationDraftStore(
    (state) => state.setDraftHasContent,
  );
  const removeSidebarConversationDraft = useSidebarConversationDraftStore(
    (state) => state.removeDraft,
  );
  const sidebarDraftHasContentRef = useRef(
    draftId
      ? useSidebarConversationDraftStore.getState().drafts[draftId]?.hasContent === true
      : false,
  );
  const publishSidebarDraftContent = useCallback(
    (hasContent: boolean) => {
      sidebarDraftHasContentRef.current = hasContent;
      if (draftId) {
        setSidebarDraftHasContent(draftId, hasContent);
      }
    },
    [draftId, setSidebarDraftHasContent],
  );
  const handleChatDraftTextChange = useCallback(
    (text: string) => {
      publishSidebarDraftContent(text.length > 0 || chatDraft.attachments.length > 0);
      chatDraft.editText(text);
    },
    [chatDraft, publishSidebarDraftContent],
  );
  const handleChatDraftAttachmentsChange = useCallback<AgentInputDraft["setAttachments"]>(
    (updater) => {
      const nextAttachments =
        typeof updater === "function" ? updater(chatDraft.attachments) : updater;
      publishSidebarDraftContent(chatDraft.text.length > 0 || nextAttachments.length > 0);
      chatDraft.setAttachments(nextAttachments);
    },
    [chatDraft, publishSidebarDraftContent],
  );
  const completeSidebarConversationDraft = useCallback(() => {
    if (draftId) {
      removeSidebarConversationDraft(draftId);
    }
  }, [draftId, removeSidebarConversationDraft]);

  useEffect(() => {
    if (!chatDraft.isHydrated) {
      return;
    }
    publishSidebarDraftContent(chatDraft.text.length > 0 || chatDraft.attachments.length > 0);
  }, [
    chatDraft.attachments.length,
    chatDraft.isHydrated,
    chatDraft.text.length,
    publishSidebarDraftContent,
  ]);

  useEffect(
    () => () => {
      if (draftId && !sidebarDraftHasContentRef.current) {
        removeSidebarConversationDraft(draftId);
      }
    },
    [draftId, removeSidebarConversationDraft],
  );
  const composerState = chatDraft.composerState;
  const [hoveredCloseTabKey, setHoveredCloseTabKey] = useState<string | null>(null);
  const newConversationTabs = useMemo<WorkspaceDesktopTabRowItem[]>(
    () => [
      {
        tab: {
          key: draftKey,
          tabId: draftKey,
          kind: "draft",
          target: { kind: "draft", draftId: draftKey },
        },
        isActive: true,
        isCloseHovered: hoveredCloseTabKey === draftKey,
        isClosingTab: false,
        presentation: {
          key: draftKey,
          kind: "draft",
          label: t("newWorkspace.title"),
          subtitle: t("newWorkspace.title"),
          tooltip: t("newWorkspace.title"),
          modified: chatDraft.text.length > 0 || chatDraft.attachments.length > 0,
          titleState: "ready",
          icon: MessageSquarePlus,
          statusBucket: null,
        },
      },
    ],
    [chatDraft.attachments.length, chatDraft.text.length, draftKey, hoveredCloseTabKey, t],
  );
  const [, dispatchPickerSelection] = useReducer(
    reducePickerSelection,
    initialPickerSelectionState,
  );

  const handleGithubPrDetected = useCallback(() => {
    dispatchPickerSelection({ type: "pr-detected" });
  }, []);

  const handleGithubPrAutoAttach = useCallback((item: ForgeSearchItem) => {
    dispatchPickerSelection({
      type: "pr-added",
      item: { kind: "github-pr", item },
    });
  }, []);

  const withConnectedClient = useCallback(() => {
    if (!client || !isConnected) {
      throw new Error(t("newWorkspace.errors.hostDisconnected"));
    }
    return client;
  }, [client, isConnected, t]);

  const isPending = isNewWorkspacePending({ pendingAction, isDraftHandoffActive });

  const handleClearDraft = useCallback(() => {
    // No-op: screen navigates away on success, text should stay for retry on error
  }, []);

  const ensureWorkspace = useCallback(
    async (input: {
      cwd: string;
      prompt: string;
      attachments: AgentAttachment[];
      withInitialAgent: boolean;
    }) => {
      if (createdWorkspace) return createdWorkspace;
      if (!selectedProject) throw new Error("Choose a project");
      if (!selectedSourceDirectory) throw new Error("Choose a host for this project");
      const normalizedWorkspace = await createWorkspaceForConversation({
        client: withConnectedClient(),
        project: selectedProject,
        sourceDirectory: selectedSourceDirectory,
        withInitialAgent: input.withInitialAgent,
        prompt: input.prompt,
        attachments: input.attachments,
        mergeWorkspaces,
        serverId: selectedServerId,
        createFailedMessage: t("newWorkspace.errors.createWorkspaceFailed"),
      });
      setCreatedWorkspace(normalizedWorkspace);
      return normalizedWorkspace;
    },
    [
      createdWorkspace,
      mergeWorkspaces,
      selectedProject,
      selectedServerId,
      selectedSourceDirectory,
      t,
      withConnectedClient,
    ],
  );

  const handleSubmitNewWorkspace = useCallback(
    async (payload: MessagePayload) => {
      try {
        setErrorMessage(null);
        await composerState?.persistFormPreferences();
        await updateFormPreferences({ launchTarget });
        if (isEmptyWorkspaceSubmission(payload)) {
          setPendingAction("empty");
          await runCreateEmptyWorkspace({
            payload,
            ensureWorkspace,
            serverId: selectedServerId,
            navigate: (targetServerId, workspaceId) => {
              completeSidebarConversationDraft();
              navigateToWorkspace({ serverId: targetServerId, workspaceId });
            },
          });
          return;
        }

        setPendingAction("chat");
        await runCreateChatAgent({
          payload,
          composerState,
          forkDraftSetup,
          ensureWorkspace,
          serverId: selectedServerId,
          clearDraft: chatDraft.clear,
          draftId,
          supportsForgeSearch,
          labels: {
            composerStateRequired: t("newWorkspace.errors.composerStateRequired"),
            selectModel: t("newWorkspace.errors.selectModel"),
          },
        });
        completeSidebarConversationDraft();
      } catch (error) {
        const message = toErrorMessage(error);
        setPendingAction(null);
        setErrorMessage(message);
        toast.error(message);
      }
    },
    [
      composerState,
      draftId,
      chatDraft.clear,
      completeSidebarConversationDraft,
      ensureWorkspace,
      forkDraftSetup,
      launchTarget,
      selectedServerId,
      supportsForgeSearch,
      t,
      toast,
      updateFormPreferences,
    ],
  );

  const launchTerminal = useCallback(
    async (profile: TerminalProfile | null, prompt: string, preserveDraft = false) => {
      try {
        setErrorMessage(null);
        await updateFormPreferences({ launchTarget });
        setPendingAction("terminal");
        await runCreateTerminalWorkspace({
          cwd: selectedSourceDirectory ?? "",
          prompt,
          profile,
          profileName: profile?.name,
          ensureWorkspace,
          createTerminal: async (input) => {
            const connectedClient = withConnectedClient();
            const createdTerminal = await connectedClient.createTerminal(
              input.workspaceDirectory,
              input.name,
              undefined,
              {
                command:
                  input.command ??
                  resolveDesktopDefaultTerminalShell({
                    activeConnection: terminalActiveConnection,
                    loginShell: getDesktopHost()?.loginShell,
                  }),
                args: input.args,
                workspaceId: input.workspaceId,
              },
            );
            if (!createdTerminal.terminal) {
              throw new Error(
                createdTerminal.error ?? t("newWorkspace.errors.createWorkspaceFailed"),
              );
            }
            return { terminalId: createdTerminal.terminal.id };
          },
          sendTerminalInput: (terminalId, data) => {
            withConnectedClient().sendTerminalInput(terminalId, { type: "input", data });
          },
          serverId: selectedServerId,
          navigate: (targetServerId, workspaceId, target) => {
            if (!preserveDraft) completeSidebarConversationDraft();
            navigateToWorkspace({ serverId: targetServerId, workspaceId, target });
          },
        });
      } catch (error) {
        const message = toErrorMessage(error);
        setPendingAction(null);
        setErrorMessage(message);
        toast.error(message);
      }
    },
    [
      ensureWorkspace,
      completeSidebarConversationDraft,
      launchTarget,
      selectedServerId,
      terminalActiveConnection,
      selectedSourceDirectory,
      t,
      toast,
      updateFormPreferences,
      withConnectedClient,
    ],
  );
  const handleSubmitTerminalLaunch = useCallback(
    () => launchTerminal(selectedTerminalProfile, terminalPromptText),
    [launchTerminal, selectedTerminalProfile, terminalPromptText],
  );

  const contentStyle = useMemo(
    () => getContentStyle({ isCompact, insetBottom: insets.bottom }),
    [isCompact, insets.bottom],
  );

  const { style: composerKeyboardStyle } = useKeyboardShiftStyle({
    mode: "translate",
  });

  const centeredStyle = useMemo(
    () => [animatedStaticStyles.centered, composerKeyboardStyle],
    [composerKeyboardStyle],
  );

  const agentControlsWithDisabled = useMemo(
    () =>
      composerState
        ? {
            ...composerState.agentControls,
            disabled: isPending,
          }
        : undefined,
    [composerState, isPending],
  );
  const draftGoalEnabled = composerState?.featureValues?.workflow_mode === "goal";
  const draftGoalObjective =
    typeof composerState?.featureValues?.goal_objective === "string"
      ? composerState.featureValues.goal_objective
      : "";
  const setDraftFeature = composerState?.agentControls.onSetFeature;
  const saveDraftGoal = useCallback(
    async (objective: string) => {
      setDraftFeature?.("goal_objective", objective);
    },
    [setDraftFeature],
  );
  const controlDraftGoal = useCallback(
    async (action: GoalControlAction) => {
      if (action === "delete") {
        setDraftFeature?.("goal_objective", "");
        setDraftFeature?.("goal_status", "paused");
        setDraftFeature?.("workflow_mode", "standard");
        return;
      }
      setDraftFeature?.("goal_status", action === "start" ? "active" : "paused");
    },
    [setDraftFeature],
  );

  const screenHeaderLeft = useMemo(() => <SidebarMenuToggle />, []);
  const handleCloseNewConversationTab = useCallback(() => {
    if (lastWorkspaceSelectionForHeader) {
      navigateToWorkspace(lastWorkspaceSelectionForHeader);
      return;
    }
    router.replace("/");
  }, [lastWorkspaceSelectionForHeader]);
  const launchHeaderTab = useCallback(
    async (selection: NewTabSelection) => {
      if (isPending) return;
      if (selection.kind === "terminal") {
        await launchTerminal(selection.profile ?? null, "", true);
        return;
      }
      setPendingAction("empty");
      try {
        const nextWorkspace = await ensureWorkspace({
          cwd: selectedSourceDirectory ?? "",
          prompt: "",
          attachments: [],
          withInitialAgent: false,
        });
        let target: WorkspaceTabTarget;
        if (selection.kind === "target") {
          target = selection.target;
        } else if (selection.kind === "browser") {
          target = { kind: "browser", browserId: createWorkspaceBrowser().browserId };
        } else {
          target = { kind: "draft", draftId: generateDraftId() };
        }
        const workspaceKey = buildWorkspaceTabPersistenceKey({
          serverId: selectedServerId,
          workspaceId: nextWorkspace.id,
        });
        if (selection.kind === "target") {
          openSupportingTab({ isCompact: false, workspaceKey, target });
        }
        navigateToWorkspace({ serverId: selectedServerId, workspaceId: nextWorkspace.id, target });
      } catch (error) {
        const message = toErrorMessage(error);
        setErrorMessage(message);
        toast.error(message);
      } finally {
        setPendingAction(null);
      }
    },
    [ensureWorkspace, isPending, launchTerminal, selectedServerId, selectedSourceDirectory, toast],
  );
  const headerLauncher = useMemo<NewTabLauncher>(
    () => ({
      showChanges: false,
      showPullRequest: false,
      showBrowser: getIsElectron(),
      terminalDisabled: isPending,
      launch: (selection) => {
        void launchHeaderTab(selection);
      },
    }),
    [isPending, launchHeaderTab],
  );
  const handleOpenHeaderTerminal = useCallback(() => {
    void launchHeaderTab({ kind: "terminal" });
  }, [launchHeaderTab]);
  const handleOpenHeaderExplorer = useCallback(() => {
    void launchHeaderTab({ kind: "target", target: { kind: "files" } });
  }, [launchHeaderTab]);
  const screenHeaderRight = useMemo(
    () =>
      !isCompact ? (
        <NewTabLauncherProvider value={headerLauncher}>
          <View style={styles.headerRight}>
            <WorkspaceHeaderActions
              showPanels
              showNewTab
              bottomPaneOpen={false}
              onToggleBottomPane={handleOpenHeaderTerminal}
              bottomPaneKeys={[]}
              onToggleSidePanel={handleOpenHeaderExplorer}
              sidePanelLabel={t("workspace.tabs.sidePanel.open")}
              sidePanelOpen={false}
              sidePanelKeys={[]}
              disabled={isPending || !selectedSourceDirectory || !isConnected}
            >
              <WorkspaceNewTabMenuContent
                serverId={selectedServerId}
                purpose="primary"
                align="end"
              />
            </WorkspaceHeaderActions>
          </View>
        </NewTabLauncherProvider>
      ) : null,
    [
      headerLauncher,
      isCompact,
      isConnected,
      isPending,
      handleOpenHeaderTerminal,
      handleOpenHeaderExplorer,
      selectedServerId,
      selectedSourceDirectory,
      t,
    ],
  );

  return (
    <View style={styles.container}>
      <ScreenHeader left={screenHeaderLeft} right={screenHeaderRight} borderless />
      {!isCompact ? (
        <View style={styles.newConversationTabs}>
          <TitlebarDragRegion />
          <WorkspaceDesktopTabsRow
            isFocused
            newTabShortcutEnabled={false}
            tabs={newConversationTabs}
            normalizedServerId={selectedServerId}
            normalizedWorkspaceId=""
            setHoveredCloseTabKey={setHoveredCloseTabKey}
            onNavigateTab={noopWorkspaceTabAction}
            onCloseTab={handleCloseNewConversationTab}
            onCopyResumeCommand={noopWorkspaceTabAction}
            onCopyAgentId={noopWorkspaceTabAction}
            onCopyTerminalId={noopWorkspaceTabAction}
            onCopyFilePath={noopWorkspaceTabAction}
            onReloadAgent={noopWorkspaceTabAction}
            onRenameTab={noopWorkspaceTabAction}
            onCloseTabsToLeft={noopWorkspaceTabAction}
            onCloseTabsToRight={noopWorkspaceTabAction}
            onCloseOtherTabs={noopWorkspaceTabAction}
            onCreateNewTab={noopWorkspaceTabAction}
            onReorderTabs={noopWorkspaceTabAction}
            focusModeEnabled={false}
            onExitFocusMode={noopWorkspaceTabAction}
          />
        </View>
      ) : null}
      <View style={contentStyle}>
        <TitlebarDragRegion />
        <ReanimatedAnimated.View style={centeredStyle}>
          <View style={styles.composerTitleContainer}>
            <Text style={styles.composerTitle}>{t("newWorkspace.title")}</Text>
          </View>
          {isTerminalLaunch ? (
            <Composer
              externalKeyboardShift
              inputMode="terminal"
              readOnly={!terminalTakesPrompt}
              placeholder={terminalPlaceholder}
              submitLabel={terminalSubmitLabel}
              agentId={draftKey}
              serverId={selectedServerId}
              isPaneFocused={true}
              onSubmitMessage={handleSubmitTerminalLaunch}
              allowEmptySubmit={true}
              submitButtonAccessibilityLabel={t("newWorkspace.launch.submit")}
              submitButtonTestID="new-workspace-launch-submit"
              isSubmitLoading={isPending}
              submitBehavior="preserve-and-lock"
              blurOnSubmit={true}
              value={terminalComposerValue}
              onChangeText={setTerminalPromptText}
              textReplacementKey={launchFocusKey}
              attachments={NO_TERMINAL_ATTACHMENTS}
              onChangeAttachments={noopChangeAttachments}
              cwd={selectedSourceDirectory ?? ""}
              clearDraft={noopClearDraft}
              autoFocus={terminalTakesPrompt}
              autoFocusKey={launchFocusKey}
            />
          ) : (
            <>
              {draftGoalEnabled ? (
                <GoalBar
                  goal={null}
                  initialObjective={draftGoalObjective}
                  disabled={isPending}
                  onSave={saveDraftGoal}
                  onAction={controlDraftGoal}
                />
              ) : null}
              <Composer
                externalKeyboardShift
                agentId={draftKey}
                serverId={selectedServerId}
                isPaneFocused={true}
                onSubmitMessage={handleSubmitNewWorkspace}
                allowEmptySubmit={true}
                submitButtonAccessibilityLabel={t("newWorkspace.create")}
                submitButtonTestID="workspace-create-submit"
                submitIcon="return"
                isSubmitLoading={isPending}
                waitForGithubAutoAttachOnSubmit
                submitBehavior="preserve-and-lock"
                blurOnSubmit={true}
                value={chatDraft.text}
                onChangeText={handleChatDraftTextChange}
                textReplacementKey={chatDraft.textReplacementKey}
                attachments={chatDraft.attachments}
                attachmentScopeKeys={visibleDraftContextScopeKeys}
                onChangeAttachments={handleChatDraftAttachmentsChange}
                onGithubPrDetected={handleGithubPrDetected}
                onGithubPrAutoAttach={handleGithubPrAutoAttach}
                cwd={selectedSourceDirectory ?? ""}
                clearDraft={handleClearDraft}
                autoFocus
                autoFocusKey={launchFocusKey}
                commandDraftConfig={composerState?.commandDraftConfig}
                agentControls={agentControlsWithDisabled}
              />
            </>
          )}
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        </ReanimatedAnimated.View>
      </View>
    </View>
  );
}

const animatedStaticStyles = RNStyleSheet.create({
  centered: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
  },
});

const styles = StyleSheet.create((theme) => ({
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  newConversationTabs: {
    position: "relative",
    minWidth: 0,
  },
  content: {
    position: "relative",
    flex: 1,
    alignItems: "center",
  },
  contentCentered: {
    justifyContent: "center",
    paddingBottom: HEADER_INNER_HEIGHT + theme.spacing[6],
  },
  contentCompact: {
    justifyContent: "flex-end",
  },
  composerTitleContainer: {
    marginBottom: theme.spacing[8],
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[4],
  },
  composerTitle: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.destructive,
    lineHeight: 20,
  },
}));
