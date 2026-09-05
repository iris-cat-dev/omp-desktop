/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassifiedCheckoutCommit, CheckoutCommitsData } from "@/git/use-commits-query";
import { CommitsSection } from "./commits-section";

const mocks = vi.hoisted(() => ({
  useCheckoutCommitsQuery: vi.fn(),
}));

vi.mock("@/components/retained-panel", () => ({
  useRetainedPanelActive: () => true,
}));

vi.mock("@/git/use-commits-query", () => ({
  useCheckoutCommitsQuery: mocks.useCheckoutCommitsQuery,
}));

vi.mock("react-native-gesture-handler", () => {
  const pan = {
    hitSlop: () => pan,
    activeOffsetY: () => pan,
    failOffsetX: () => pan,
    onBegin: () => pan,
    onStart: () => pan,
    onUpdate: () => pan,
    onEnd: () => pan,
    onFinalize: () => pan,
  };
  return {
    Gesture: { Pan: () => pan },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock("react-native-reanimated", () => ({
  default: { View: "div" },
  runOnJS: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  useAnimatedStyle: (callback: () => object) => callback(),
  useSharedValue: (value: number) => ({ value }),
}));

vi.mock("react-native-worklets", () => ({
  scheduleOnRN: <T extends (...args: never[]) => unknown>(callback: T, ...args: Parameters<T>) =>
    callback(...args),
}));

vi.mock("@/git/themed-chevron", () => ({
  ThemedChevron: () => <span data-testid="chevron" />,
  chevronColorMapping: {},
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => {
      const labels: Record<string, string> = {
        "workspace.git.diff.commits.title": "Commits",
        "workspace.git.diff.commits.loading": "Loading commits",
        "workspace.git.diff.commits.loadError": "Failed to load commits",
        "workspace.git.diff.commits.empty": "No commits",
      };
      if (key === "workspace.git.diff.commits.countLabel") {
        return `${values?.count ?? 0} commits on the current branch`;
      }
      return labels[key] ?? key;
    },
  }),
}));

function createCommit(
  overrides: Partial<ClassifiedCheckoutCommit> & Pick<ClassifiedCheckoutCommit, "sha" | "subject">,
): ClassifiedCheckoutCommit {
  return {
    sha: overrides.sha,
    shortSha: overrides.shortSha ?? overrides.sha.slice(0, 7),
    subject: overrides.subject,
    authorName: overrides.authorName ?? "Test User",
    authorDate: overrides.authorDate ?? "2026-09-01T12:00:00.000Z",
    isOnRemote: overrides.isOnRemote ?? true,
    isOnBase: overrides.isOnBase ?? false,
    files: overrides.files ?? [],
  };
}

function loadCommits(data: CheckoutCommitsData): void {
  mocks.useCheckoutCommitsQuery.mockReturnValue({ status: "loaded", data });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CommitsSection", () => {
  it("shows branch commits and base ancestors and opens either commit", () => {
    const branchCommit = createCommit({
      sha: "1111111111111111111111111111111111111111",
      shortSha: "1111111",
      subject: "Feature work",
    });
    const baseCommit = createCommit({
      sha: "2222222222222222222222222222222222222222",
      shortSha: "2222222",
      subject: "Shared base",
      isOnBase: true,
    });
    loadCommits({ baseRef: "main", commits: [branchCommit, baseCommit] });
    const onCommitPress = vi.fn();

    render(
      <CommitsSection
        serverId="server"
        cwd="/repo"
        currentBranchName="feature"
        collapsed={false}
        onCommitPress={onCommitPress}
        availableHeight={640}
        onHeightChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Feature work")).toBeTruthy();
    expect(screen.getByText("Shared base")).toBeTruthy();
    expect(screen.getByText("feature")).toBeTruthy();
    expect(screen.getByLabelText("2 commits on the current branch")).toBeTruthy();
    expect(screen.queryByText("No commits")).toBeNull();

    fireEvent.click(screen.getByTestId("commit-row-2222222"));
    expect(onCommitPress).toHaveBeenCalledWith(baseCommit.sha);
  });

  it("shows base-only history instead of an ahead-of-base empty state", () => {
    loadCommits({
      baseRef: "main",
      commits: [
        createCommit({
          sha: "3333333333333333333333333333333333333333",
          subject: "Current HEAD",
          isOnBase: true,
        }),
      ],
    });

    render(
      <CommitsSection
        serverId="server"
        cwd="/repo"
        currentBranchName="main"
        collapsed={false}
        onCommitPress={vi.fn()}
        availableHeight={640}
        onHeightChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Current HEAD")).toBeTruthy();
    expect(screen.queryByText("No commits")).toBeNull();
  });

  it("shows the generic empty state only when the branch has no commits", () => {
    loadCommits({ baseRef: null, commits: [] });

    render(
      <CommitsSection
        serverId="server"
        cwd="/repo"
        currentBranchName="main"
        collapsed={false}
        onCommitPress={vi.fn()}
        availableHeight={640}
        onHeightChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No commits")).toBeTruthy();
    expect(screen.getByLabelText("0 commits on the current branch")).toBeTruthy();
  });

  it("keeps loaded rows hidden while collapsed", () => {
    loadCommits({
      baseRef: null,
      commits: [
        createCommit({
          sha: "4444444444444444444444444444444444444444",
          subject: "Hidden commit",
          isOnBase: true,
        }),
      ],
    });

    render(
      <CommitsSection
        serverId="server"
        cwd="/repo"
        currentBranchName="main"
        collapsed
        onCommitPress={vi.fn()}
        availableHeight={640}
        onHeightChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("Hidden commit")).toBeNull();
    expect(mocks.useCheckoutCommitsQuery).toHaveBeenCalledWith({
      serverId: "server",
      cwd: "/repo",
      enabled: false,
    });
  });
});
