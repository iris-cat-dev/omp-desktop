import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import { runQuickAsk } from "./run-quick-ask";

function createClient(result: string | Error) {
  const quickAsk = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    client: { quickAsk } as unknown as DaemonClient,
    quickAsk,
  };
}

const source = {
  provider: "codex" as const,
  cwd: "/repo",
  currentModeId: "default",
  model: "gpt-5",
  thinkingOptionId: "medium",
};

describe("runQuickAsk", () => {
  it("sends the selected content through the one-off quick ask RPC", async () => {
    const harness = createClient("The answer.");

    await expect(
      runQuickAsk({
        client: harness.client,
        source,
        selectedText: "selected text",
        question: "What does this mean?",
      }),
    ).resolves.toBe("The answer.");

    expect(harness.quickAsk).toHaveBeenCalledWith({
      config: {
        provider: "codex",
        cwd: "/repo",
        modeId: "default",
        model: "gpt-5",
        thinkingOptionId: "medium",
      },
      selectedText: "selected text",
      question: "What does this mean?",
    });
  });

  it("surfaces generation failures", async () => {
    const harness = createClient(new Error("provider failed"));

    await expect(
      runQuickAsk({
        client: harness.client,
        source,
        selectedText: "selected text",
        question: "Why?",
      }),
    ).rejects.toThrow("provider failed");
  });
});
