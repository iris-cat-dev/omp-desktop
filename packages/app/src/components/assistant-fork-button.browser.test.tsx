import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { AssistantForkButton } from "./assistant-fork-button";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it("forks directly into a new workspace without opening a target menu", async () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onFork = vi.fn(async () => {});

  try {
    await act(async () => root.render(<AssistantForkButton onFork={onFork} />));

    const button = container.querySelector('[data-testid="assistant-fork-button"]');
    expect(button).toHaveAttribute("aria-label", "message.actions.forkInNewWorkspace");
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await userEvent.click(button!);

    await expect.poll(() => onFork.mock.calls.length).toBe(1);
    expect(container.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
