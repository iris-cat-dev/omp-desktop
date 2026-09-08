import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { CommitComposer } from "./commit-composer";

const { commit, generate, toast } = vi.hoisted(() => ({
  commit: vi.fn(async () => {}),
  generate: vi.fn(
    async () =>
      "feat: add context selection\n\n- Let users include conversation context.\n- Preserve the selected option when asking about quoted text.",
  ),
  toast: { show: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        server: {
          client: { generateCheckoutCommitMessage: generate },
          serverInfo: { features: { checkoutCommitMessageGeneration: true } },
        },
      },
    }),
}));
vi.mock("@/git/actions-store", () => ({
  useCheckoutGitActionsStore: (selector: (state: unknown) => unknown) =>
    selector({
      commit,
      getStatus: () => "idle",
    }),
}));

it("preserves generated body text and inserts newlines without submitting until Commit is clicked", async () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  container.style.width = "380px";
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<CommitComposer serverId="server" cwd="/repo" branchName="main" hasChanges />),
    );
    await userEvent.click(
      container.querySelector('[data-testid="changes-generate-commit-message"]')!,
    );
    const input = container.querySelector("textarea")!;
    const generated = await generate.mock.results[0].value;
    await expect.poll(() => input.value).toBe(generated);
    await userEvent.click(input);
    input.setSelectionRange(input.value.length, input.value.length);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => input.value).toBe(`${generated}\n`);
    expect(commit).not.toHaveBeenCalled();
    await userEvent.type(input, "- Keep the context choice editable.");
    const completeMessage = input.value.trim();
    await userEvent.click(container.querySelector('[data-testid="changes-commit-button"]')!);
    await expect.poll(() => commit.mock.calls.length).toBe(1);
    expect(commit).toHaveBeenCalledWith({
      serverId: "server",
      cwd: "/repo",
      message: completeMessage,
    });
    await expect.poll(() => input.value).toBe("");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
