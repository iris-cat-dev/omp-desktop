/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentToolCallItem, StreamItem } from "@/types/stream";
import type { ToolCallDetail } from "@omp-desktop/protocol/agent-types";

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === "agentStream.turnFileChanges.moreCount" ? `+${options?.count ?? 0}` : key,
  }),
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

describe("TurnFileChangesBar disclosure", () => {
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

  it("shows every file directly when the turn changes at most three files", () => {
    const { items, startIndex } = buildTurn(3);
    renderBar(items, startIndex);
    expect(chipCount()).toBe(3);
    expect(container?.querySelector('[data-testid="turn-file-changes-toggle"]')).toBeNull();
  });

  it("summarizes extra files and reveals the complete list on demand", () => {
    const { items, startIndex } = buildTurn(8);
    renderBar(items, startIndex);

    expect(chipCount()).toBe(3);
    const toggle = container?.querySelector(
      '[data-testid="turn-file-changes-toggle"]',
    ) as HTMLElement | null;
    expect(toggle?.textContent).toBe("+5");

    act(() => {
      toggle?.click();
    });
    expect(chipCount()).toBe(8);
    expect(queryChip("file-7.ts")).not.toBeNull();
    expect(toggle?.textContent).toBe("agentStream.turnFileChanges.collapse");

    act(() => {
      toggle?.click();
    });
    expect(chipCount()).toBe(3);
  });
});
