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
  const AnimatedView = ({
    children,
    style,
    testID,
  }: {
    children?: React.ReactNode;
    style?: unknown;
    testID?: string;
  }) => (
    <div
      data-test-tag="animated-view"
      data-testid={testID}
      style={Array.isArray(style) ? style[0] : style}
    >
      {children}
    </div>
  );
  const AnimatedScrollView = ({
    children,
    ref,
    onContentSizeChange,
    onLayout,
    ...rest
  }: {
    children?: React.ReactNode;
    ref?: unknown;
    onContentSizeChange?: (width: number, height: number) => void;
    onLayout?: (event: { nativeEvent: { layout: { width: number } } }) => void;
  }) => {
    React.useEffect(() => {
      // jsdom reports zero client widths; a positive content size stands in
      // for "the row has content and may overflow", which gates the shades.
      onContentSizeChange?.(2000, CHIP_HEIGHT_MOCK);
      onLayout?.({ nativeEvent: { layout: { width: 400 } } });
    }, [onContentSizeChange, onLayout]);
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
