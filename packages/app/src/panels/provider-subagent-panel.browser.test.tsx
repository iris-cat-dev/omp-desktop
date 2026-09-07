import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSubagentMetadata } from "./provider-subagent-metadata";

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => vi.stubGlobal("React", React));

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("provider subagent metadata", () => {
  it("shows the resolved model name when the subagent is opened", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    act(() =>
      root.render(<ProviderSubagentMetadata model="openai-codex/gpt-5.5" subtitle={null} />),
    );

    expect(
      container.querySelector('[data-testid="provider-subagent-pane-subtitle"]')?.textContent,
    ).toBe("openai-codex/gpt-5.5");
  });
});
