import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSubagentMetadata } from "./provider-subagent-metadata";
import { i18n } from "@/i18n/i18next";

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(async () => {
  vi.stubGlobal("React", React);
  if (!i18n.isInitialized) await i18n.init();
  await i18n.changeLanguage("en");
});

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
    ).toBe("Model: openai-codex/gpt-5.5");
  });

  it("keeps metadata visible before reporting a model and updates without duplicates", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    const metadata = () =>
      container.querySelector('[data-testid="provider-subagent-pane-subtitle"]')?.textContent;

    act(() => root.render(<ProviderSubagentMetadata model={undefined} subtitle={undefined} />));
    expect(metadata()).toBe("Model: Unknown (not reported)");

    act(() =>
      root.render(
        <ProviderSubagentMetadata
          model="openai-codex/gpt-5.5"
          subtitle="Explore · openai-codex/gpt-5.5 · High · 4.2k tokens"
        />,
      ),
    );
    expect(metadata()).toBe("Model: openai-codex/gpt-5.5 · Explore · High · 4.2k tokens");

    act(() =>
      root.render(<ProviderSubagentMetadata model=" " subtitle="Explore · 4.2k tokens" />),
    );
    expect(metadata()).toBe("Model: Unknown (not reported) · Explore · 4.2k tokens");
  });

  it("renders localized unknown metadata", async () => {
    await i18n.changeLanguage("zh-CN");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    act(() => root.render(<ProviderSubagentMetadata model={null} subtitle={null} />));
    expect(
      container.querySelector('[data-testid="provider-subagent-pane-subtitle"]')?.textContent,
    ).toBe("模型：未知（未上报）");
  });
});
