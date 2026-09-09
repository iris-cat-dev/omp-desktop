/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentToolCallItem, StreamItem } from "@/types/stream";
import type { ToolCallDetail } from "@omp-desktop/protocol/agent-types";

const animatedStyles = vi.hoisted(() => ({ last: {} as Record<string, number> }));

function makeRefAttacher(ref: unknown): (node: HTMLDivElement | null) => void {
  return (node: HTMLDivElement | null) => {
    if (typeof ref === "function") {
      (ref as (value: unknown) => void)({
        getScrollableNode: () => node,
      });
    }
  };
}
vi.mock("react-native-reanimated", () => {
  const CHIP_HEIGHT_MOCK = 20;
  const animatedStyle = (style: Record<string, unknown>) => style;
  const CHIP_X_STEP_MOCK = 60;
  const AnimatedView = ({
    children,
    style,
    testID,
    onLayout,
  }: {
    children?: React.ReactNode;
    style?: unknown;
    testID?: string;
    onLayout?: (event: { nativeEvent: { layout: { width: number; x?: number } } }) => void;
  }) => {
    React.useEffect(() => {
      const slot = testID?.match(/^turn-file-changes-slot-(\d+)$/);
      if (slot && onLayout) {
        onLayout({
          nativeEvent: { layout: { width: 50, x: Number(slot[1]) * CHIP_X_STEP_MOCK } },
        });
        return;
      }
      // The bar container reports a fixed 400px width in jsdom.
      if (onLayout) {
        onLayout({ nativeEvent: { layout: { width: 400 } } });
      }
    }, [testID, onLayout]);
    return (
      <div
        data-test-tag="animated-view"
        data-testid={testID}
        style={
          Array.isArray(style)
            ? (Object.assign({}, ...(style as object[])) as React.CSSProperties)
            : (style as React.CSSProperties | undefined)
        }
      >
        {children}
      </div>
    );
  };
  const AnimatedScrollView = ({
    children,
    ref,
    onContentSizeChange,
    ...rest
  }: {
    children?: React.ReactNode;
    ref?: unknown;
    onContentSizeChange?: (width: number, height: number) => void;
  }) => {
    React.useEffect(() => {
      // jsdom reports zero client widths; a positive content size stands in
      // for "the row has content and may overflow", which gates the shades.
      onContentSizeChange?.(2000, CHIP_HEIGHT_MOCK);
    }, [onContentSizeChange]);
    return (
      <div
        data-test-tag="animated-scroll-view"
        data-rest={JSON.stringify(rest ?? {})}
        ref={makeRefAttacher(ref)}
      >
        {children}
      </div>
    );
  };
  return {
    default: { View: AnimatedView, ScrollView: AnimatedScrollView },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedScrollHandler: (handler: unknown) => handler,
    useAnimatedStyle: (builder: () => Record<string, number>) => {
      const style = builder();
      animatedStyles.last = style;
      return style;
    },
    useAnimatedProps: animatedStyle,
  };
});

// RN's View renders through react-native-web in jsdom, where layout events
// never fire; stub it with the same slot-aware layout trigger as the
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<object>();
  const CHIP_X_STEP_MOCK = 60;
  const RNView = ({
    children,
    style,
    testID,
    onLayout,
  }: {
    children?: React.ReactNode;
    style?: unknown;
    testID?: string;
    onLayout?: (event: { nativeEvent: { layout: { width: number; x?: number } } }) => void;
  }) => {
    React.useEffect(() => {
      const slot = testID?.match(/^turn-file-changes-slot-(\d+)$/);
      if (slot && onLayout) {
        onLayout({
          nativeEvent: { layout: { width: 50, x: Number(slot[1]) * CHIP_X_STEP_MOCK } },
        });
        return;
      }
      if (onLayout) {
        onLayout({ nativeEvent: { layout: { width: 400 } } });
      }
    }, [testID, onLayout]);
    return (
      <div
        data-test-tag="rn-view"
        data-testid={testID}
        style={
          Array.isArray(style)
            ? (Object.assign({}, ...(style as object[])) as React.CSSProperties)
            : (style as React.CSSProperties | undefined)
        }
      >
        {children}
      </div>
    );
  };
  return {
    ...actual,
    View: RNView,
  };
});

vi.mock("react-native-svg", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Defs: ({ children }: { children?: React.ReactNode }) => <defs>{children}</defs>,
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Rect: () => <rect />,
  Stop: ({ offset }: { offset: string }) => <stop offset={offset} />,
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => false),
}));

vi.mock("@/components/message", () => ({
  STREAM_METADATA_FONT_SIZE: 13,
}));

import { TurnFileChangesBar } from "./turn-file-changes-bar";

function toolCallItem(name: string, filePath: string, index: number): AgentToolCallItem {

  return {
    kind: "tool_call",
    id: `${name}-id-${index}`,
    turnId: "turn-1",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: `${name}-call-${index}`,
        name,
        status: "completed",
        error: null,
        detail: { type: "write", filePath } satisfies ToolCallDetail,
      },
    },
  } as AgentToolCallItem;
}

const messageItem = {
  kind: "assistant_message",
  id: "assistant-1",
  turnId: "turn-1",
  timestamp: new Date("2026-01-01T00:00:01Z"),
} as unknown as StreamItem;

function buildTurn(fileCount: number): { items: StreamItem[]; startIndex: number } {
  const items: StreamItem[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    items.push(toolCallItem("write", `src/file-${index}.ts`, index));
  }
  items.push(messageItem);
  return { items, startIndex: items.length - 1 };
}

describe("TurnFileChangesBar scrolling collapse", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
  });

  function renderBar(items: StreamItem[], startIndex: number) {
    act(() => {
      root?.render(<TurnFileChangesBar items={items} startIndex={startIndex} rawItems={items} />);
    });
  }

  function chipCount(): number {
    return container?.querySelectorAll('[data-testid^="turn-file-change-"]').length ?? 0;
  }

  function queryChip(label: string): Element | null {
    return (
      container
        ?.querySelectorAll('[data-testid^="turn-file-change-"]')
        .values()
        .find((node) => node.textContent === label) ?? null
    );
  }

  it("renders up to three chips in the plain wrapped row without shades", () => {
    const { items, startIndex } = buildTurn(3);
    renderBar(items, startIndex);
    expect(chipCount()).toBe(3);
    expect(container?.querySelector('[data-test-tag="animated-scroll-view"]')).toBeNull();
    expect(container?.querySelector('[data-test-tag="turn-file-changes-shade-left"]')).toBeNull();
  });

  it("collapses more than three chips into the scrollable row", () => {
    const { items, startIndex } = buildTurn(5);
    renderBar(items, startIndex);
    expect(chipCount()).toBe(5);
    expect(container?.querySelector('[data-test-tag="animated-scroll-view"]')).not.toBeNull();
  });

  it("pins the scroll viewport to exactly three chips wide", () => {
    const { items, startIndex } = buildTurn(6);
    renderBar(items, startIndex);
    const viewport = container?.querySelector('[data-testid="turn-file-changes-viewport"]');
    expect(viewport).not.toBeNull();
    // Chip #3 (0-based) reports x = 3 * CHIP_X_STEP = 180; that x pins the
    // viewport so exactly the first three chips are visible.
    expect(viewport?.getAttribute("style")).toContain("180");
  });

  it("keeps the pinned width within the bar when the bar is narrower", () => {
    const { items, startIndex } = buildTurn(6);
    renderBar(items, startIndex);
    const viewport = container?.querySelector('[data-testid="turn-file-changes-viewport"]');
    // Container mock (scrollContainer onLayout) reports 400 in the mock below;
    // clamping only kicks in under the pinned width, 180 < 400 keeps 180.
    expect(viewport?.getAttribute("style")).toContain("180");
  });

  it("renders the plain row without a pinned viewport at three chips", () => {
    const { items, startIndex } = buildTurn(3);
    renderBar(items, startIndex);
    expect(container?.querySelector('[data-testid="turn-file-changes-viewport"]')).toBeNull();
  });
  it("starts the left shade fully transparent at scroll offset zero", () => {
    const { items, startIndex } = buildTurn(6);
    renderBar(items, startIndex);
    const leftShade = container?.querySelector('[data-testid="turn-file-changes-shade-left"]');
    expect(leftShade).not.toBeNull();
    // The reanimated style builder is evaluated with offset 0 and viewport
    // 400 / content 2000, so only the right edge is clipped: left opacity 0.
    expect(animatedStyles.last).toEqual({ opacity: 0 });
  });

  it("exposes the scroll view without a scrollbar and without shade overflow", () => {
    const { items, startIndex } = buildTurn(6);
    renderBar(items, startIndex);
    const scrollView = container?.querySelector('[data-test-tag="animated-scroll-view"]');
    expect(scrollView).not.toBeNull();
    const rest = JSON.parse(scrollView?.getAttribute("data-rest") ?? "{}") as {
      showsHorizontalScrollIndicator?: boolean;
      showsVerticalScrollIndicator?: boolean;
    };
    expect(rest.showsHorizontalScrollIndicator).toBe(false);
    expect(rest.showsVerticalScrollIndicator).toBe(false);
  });

  it("keeps every file chip accessible inside the scrollable row", () => {
    const { items, startIndex } = buildTurn(8);
    renderBar(items, startIndex);
    expect(chipCount()).toBe(8);
    expect(queryChip("file-7.ts")).not.toBeNull();
  });
});
