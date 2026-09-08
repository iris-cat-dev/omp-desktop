import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TextInputKeyPressEventData,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  RefreshCw,
  Regex,
  Search,
  WholeWord,
  X,
} from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MaterialFileIcon } from "@/components/material-file-icon";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  PaneContentToolbar,
  paneContentToolbarIconButtonStyle,
  paneContentToolbarIconSize,
} from "@/components/ui/pane-content-toolbar";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import type { EditingTextInputHandle } from "@/components/ui/text-input/types";
import {
  buildHighlightedTextSegments,
  flattenWorkspaceContentSearchResults,
  splitWorkspaceContentSearchGlobs,
  type WorkspaceContentSearchFile,
  type WorkspaceContentSearchMatch,
  type WorkspaceContentSearchRow,
} from "@/file-explorer/content-search-model";
import { describeWorkspaceFilePath } from "@/file-explorer/search-model";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceFileLocation } from "@/workspace/file-open";

const SEARCH_DEBOUNCE_MS = 180;

interface ContentSearchState {
  requestKey: string | null;
  files: readonly WorkspaceContentSearchFile[];
  matchCount: number;
  fileCount: number;
  complete: boolean;
  visibleLimitHit: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY_SEARCH_STATE: ContentSearchState = {
  requestKey: null,
  files: [],
  matchCount: 0,
  fileCount: 0,
  complete: true,
  visibleLimitHit: false,
  loading: false,
  error: null,
};

function searchErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name !== "DaemonRpcError") return error.message;
  return error.message.replace(/ requestType=\S+(?: code=\S+)?$/, "");
}

function useWorkspaceContentSearch({
  serverId,
  workspaceRoot,
  query,
  caseSensitive,
  wholeWord,
  regexp,
  include,
  exclude,
  refreshRevision,
}: {
  serverId: string;
  workspaceRoot: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  include: string;
  exclude: string;
  refreshRevision: number;
}): ContentSearchState {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const normalizedQuery = query.trim();
  const includeGlobs = useMemo(() => splitWorkspaceContentSearchGlobs(include), [include]);
  const excludeGlobs = useMemo(() => splitWorkspaceContentSearchGlobs(exclude), [exclude]);
  const requestKey = useMemo(
    () =>
      client && workspaceRoot && normalizedQuery
        ? JSON.stringify([
            serverId,
            workspaceRoot,
            normalizedQuery,
            caseSensitive,
            wholeWord,
            regexp,
            includeGlobs,
            excludeGlobs,
            refreshRevision,
          ])
        : null,
    [
      caseSensitive,
      client,
      excludeGlobs,
      includeGlobs,
      normalizedQuery,
      refreshRevision,
      regexp,
      serverId,
      wholeWord,
      workspaceRoot,
    ],
  );
  const [state, setState] = useState<ContentSearchState>(EMPTY_SEARCH_STATE);

  useEffect(() => {
    if (!requestKey || !client) {
      setState(EMPTY_SEARCH_STATE);
      return;
    }

    const activeClient = client;
    const searchId = `${serverId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
    let disposed = false;
    let started = false;
    setState({ ...EMPTY_SEARCH_STATE, requestKey, loading: true });

    const timer = setTimeout(() => {
      started = true;
      void activeClient
        .searchWorkspaceText({
          cwd: workspaceRoot,
          query: normalizedQuery,
          searchId,
          caseSensitive,
          wholeWord,
          regexp,
          includeGlobs,
          excludeGlobs,
        })
        .then((payload) => {
          if (disposed || payload.cancelled) return;
          setState({
            requestKey,
            files: payload.files,
            matchCount: payload.matchCount,
            fileCount: payload.fileCount,
            complete: payload.complete,
            visibleLimitHit: payload.visibleLimitHit,
            loading: false,
            error: payload.error,
          });
        })
        .catch((error: unknown) => {
          if (disposed) return;
          setState({
            ...EMPTY_SEARCH_STATE,
            requestKey,
            complete: false,
            error: searchErrorMessage(error),
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      disposed = true;
      clearTimeout(timer);
      if (started) {
        try {
          activeClient.cancelWorkspaceTextSearch(searchId);
        } catch {
          // A disconnect already cancelled the daemon request.
        }
      }
    };
  }, [
    caseSensitive,
    client,
    excludeGlobs,
    includeGlobs,
    normalizedQuery,
    regexp,
    requestKey,
    serverId,
    wholeWord,
    workspaceRoot,
  ]);

  if (!requestKey) return EMPTY_SEARCH_STATE;
  if (state.requestKey !== requestKey) return { ...EMPTY_SEARCH_STATE, requestKey, loading: true };
  return state;
}

interface FileExplorerContentSearchProps {
  serverId: string;
  workspaceRoot: string;
  isCompact: boolean;
  onOpenFile?: (location: WorkspaceFileLocation) => void;
  onClose: () => void;
}

export function FileExplorerContentSearch({
  serverId,
  workspaceRoot,
  isCompact,
  onOpenFile,
  onClose,
}: FileExplorerContentSearchProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const result = useWorkspaceContentSearch({
    serverId,
    workspaceRoot,
    query,
    caseSensitive,
    wholeWord,
    regexp,
    include,
    exclude,
    refreshRevision,
  });
  const rows = useMemo(
    () => flattenWorkspaceContentSearchResults(result.files, collapsedPaths),
    [collapsedPaths, result.files],
  );

  const iconButtonStyle = useCallback(
    (state: PressableStateCallbackType) =>
      paneContentToolbarIconButtonStyle(state, false, isCompact),
    [isCompact],
  );
  const toggleButtonStyle = useCallback(
    (active: boolean) => (state: PressableStateCallbackType) => [
      paneContentToolbarIconButtonStyle(state, active, isCompact),
      active && styles.toggleActive,
    ],
    [isCompact],
  );
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key !== "Escape") return;
      if (query) {
        inputRef.current?.replaceText("");
        setQuery("");
      } else {
        onClose();
      }
    },
    [onClose, query],
  );
  const openFirstMatch = useCallback(() => {
    const file = result.files[0];
    const match = file?.matches[0];
    if (file && match) {
      onOpenFile?.({ path: file.path, lineStart: match.lineNumber, lineEnd: match.lineNumber });
    }
  }, [onOpenFile, result.files]);
  const toggleFile = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const collapseAll = useCallback(
    () => setCollapsedPaths(new Set(result.files.map((file) => file.path))),
    [result.files],
  );
  const expandAll = useCallback(() => setCollapsedPaths(new Set()), []);
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<WorkspaceContentSearchRow>) =>
      item.type === "file" ? (
        <ContentSearchFileRow row={item} onToggle={() => toggleFile(item.file.path)} />
      ) : (
        <ContentSearchMatchRow
          path={item.path}
          match={item.match}
          onOpen={() =>
            onOpenFile?.({
              path: item.path,
              lineStart: item.match.lineNumber,
              lineEnd: item.match.lineNumber,
            })
          }
        />
      ),
    [onOpenFile, toggleFile],
  );

  const hasQuery = query.trim().length > 0;
  const summary = t("workspace.fileExplorer.contentSearch.summary", {
    matches: result.matchCount,
    files: result.fileCount,
  });
  const partial = result.visibleLimitHit || (!result.complete && !result.error);

  return (
    <View style={styles.container}>
      <PaneContentToolbar
        style={styles.searchToolbar}
        testID="file-explorer-content-search-toolbar"
      >
        <View style={styles.queryField}>
          <TextInput
            ref={inputRef}
            autoFocus
            initialValue=""
            onChangeText={setQuery}
            onKeyPress={handleKeyPress}
            onSubmitEditing={openFirstMatch}
            placeholder={t("workspace.fileExplorer.contentSearch.placeholder")}
            placeholderTextColor={theme.colors.foregroundExtraMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={t("workspace.fileExplorer.contentSearch.placeholder")}
            style={styles.searchInput}
            testID="file-explorer-content-search-input"
          />
          <SearchOptionButton
            label={t("workspace.fileExplorer.contentSearch.matchCase")}
            active={caseSensitive}
            onPress={() => setCaseSensitive((value) => !value)}
            style={toggleButtonStyle(caseSensitive)}
            testID="content-search-match-case"
          >
            <CaseSensitive size={14} color={theme.colors.foregroundMuted} />
          </SearchOptionButton>
          <SearchOptionButton
            label={t("workspace.fileExplorer.contentSearch.matchWholeWord")}
            active={wholeWord}
            onPress={() => setWholeWord((value) => !value)}
            style={toggleButtonStyle(wholeWord)}
            testID="content-search-whole-word"
          >
            <WholeWord size={14} color={theme.colors.foregroundMuted} />
          </SearchOptionButton>
          <SearchOptionButton
            label={t("workspace.fileExplorer.contentSearch.useRegularExpression")}
            active={regexp}
            onPress={() => setRegexp((value) => !value)}
            style={toggleButtonStyle(regexp)}
            testID="content-search-regexp"
          >
            <Regex size={14} color={theme.colors.foregroundMuted} />
          </SearchOptionButton>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={iconButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("common.actions.close")}
          testID="file-explorer-content-search-close"
        >
          <X size={paneContentToolbarIconSize(isCompact)} color={theme.colors.foregroundMuted} />
        </Pressable>
      </PaneContentToolbar>

      <View style={styles.filters}>
        <TextInput
          initialValue=""
          onChangeText={setInclude}
          placeholder={t("workspace.fileExplorer.contentSearch.includePlaceholder")}
          placeholderTextColor={theme.colors.foregroundExtraMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.filterInput}
          testID="content-search-include"
        />
        <TextInput
          initialValue=""
          onChangeText={setExclude}
          placeholder={t("workspace.fileExplorer.contentSearch.excludePlaceholder")}
          placeholderTextColor={theme.colors.foregroundExtraMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.filterInput}
          testID="content-search-exclude"
        />
      </View>

      {hasQuery ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText} numberOfLines={1}>
            {summary}
            {partial ? ` · ${t("workspace.fileExplorer.contentSearch.partial")}` : ""}
          </Text>
          {result.loading ? (
            <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
          ) : null}
          {result.files.length > 0 ? (
            <>
              <SearchOptionButton
                label={t("workspace.fileExplorer.contentSearch.collapseAll")}
                active={false}
                onPress={collapseAll}
                style={iconButtonStyle}
              >
                <ChevronsUp size={14} color={theme.colors.foregroundMuted} />
              </SearchOptionButton>
              <SearchOptionButton
                label={t("workspace.fileExplorer.contentSearch.expandAll")}
                active={false}
                onPress={expandAll}
                style={iconButtonStyle}
              >
                <ChevronsDown size={14} color={theme.colors.foregroundMuted} />
              </SearchOptionButton>
            </>
          ) : null}
          <SearchOptionButton
            label={t("workspace.fileExplorer.contentSearch.refresh")}
            active={false}
            onPress={() => setRefreshRevision((revision) => revision + 1)}
            style={iconButtonStyle}
          >
            <RefreshCw size={14} color={theme.colors.foregroundMuted} />
          </SearchOptionButton>
        </View>
      ) : null}

      {result.error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{result.error}</Text>
        </View>
      ) : null}

      <View style={styles.results}>
        {!hasQuery ? (
          <View style={styles.centerState}>
            <Search size={20} color={theme.colors.foregroundExtraMuted} />
            <Text style={styles.stateText}>
              {t("workspace.fileExplorer.contentSearch.startTyping")}
            </Text>
          </View>
        ) : !result.loading && !result.error && rows.length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.stateText}>
              {t("workspace.fileExplorer.contentSearch.noMatches")}
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            renderItem={renderRow}
            keyExtractor={(row) => row.key}
            keyboardShouldPersistTaps="handled"
            testID="file-explorer-content-search-results"
            contentContainerStyle={styles.resultsContent}
            initialNumToRender={40}
            maxToRenderPerBatch={80}
            windowSize={16}
          />
        )}
      </View>
    </View>
  );
}

function SearchOptionButton({
  label,
  active,
  onPress,
  style,
  testID,
  children,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  style: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

function ContentSearchFileRow({
  row,
  onToggle,
}: {
  row: Extract<WorkspaceContentSearchRow, { type: "file" }>;
  onToggle: () => void;
}) {
  const { theme } = useUnistyles();
  const entry = describeWorkspaceFilePath(row.file.path);
  return (
    <Pressable
      onPress={onToggle}
      style={({ hovered, pressed }) => [
        styles.fileRow,
        (Boolean(hovered) || pressed) && styles.rowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={row.file.path}
      accessibilityState={{ expanded: !row.collapsed }}
      testID={`content-search-file-${row.file.path}`}
    >
      {row.collapsed ? (
        <ChevronRight size={14} color={theme.colors.foregroundMuted} />
      ) : (
        <ChevronDown size={14} color={theme.colors.foregroundMuted} />
      )}
      <MaterialFileIcon fileName={entry.name} size={16} />
      <Text style={styles.fileName} numberOfLines={1}>
        {entry.name}
      </Text>
      {entry.directory ? (
        <Text style={styles.directory} numberOfLines={1}>
          {entry.directory}
        </Text>
      ) : null}
      <Text style={styles.matchCount}>{row.matchCount}</Text>
    </Pressable>
  );
}

function ContentSearchMatchRow({
  path,
  match,
  onOpen,
}: {
  path: string;
  match: WorkspaceContentSearchMatch;
  onOpen: () => void;
}) {
  const segments = useMemo(
    () => buildHighlightedTextSegments(match.text, match.ranges),
    [match.ranges, match.text],
  );
  return (
    <Pressable
      onPress={onOpen}
      style={({ hovered, pressed }) => [
        styles.matchRow,
        (Boolean(hovered) || pressed) && styles.rowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${path}:${match.lineNumber}`}
      testID={`content-search-match-${path}-${match.lineNumber}`}
    >
      <Text style={styles.lineNumber}>{match.lineNumber}</Text>
      <Text style={styles.preview} numberOfLines={1}>
        {segments.map((segment, index) => (
          <Text
            key={`${index}:${segment.text}`}
            style={segment.matched ? styles.highlight : undefined}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  searchToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
  },
  queryField: {
    flex: 1,
    minWidth: 0,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.base,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 26,
    paddingHorizontal: 0,
    paddingVertical: 0,
    outlineWidth: 0,
    outlineColor: "transparent",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  toggleActive: {
    backgroundColor: theme.colors.surface2,
  },
  filters: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  filterInput: {
    height: 28,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  summaryRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  summaryText: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorBanner: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  results: {
    flex: 1,
    minHeight: 0,
  },
  resultsContent: {
    paddingBottom: theme.spacing[4],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  fileRow: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  fileName: {
    maxWidth: "45%",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  directory: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  matchCount: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  matchRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[8],
    paddingRight: theme.spacing[3],
  },
  lineNumber: {
    width: 42,
    paddingRight: theme.spacing[2],
    color: theme.colors.foregroundExtraMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    textAlign: "right",
  },
  preview: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  highlight: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
    backgroundColor: theme.colors.surface3,
  },
}));
