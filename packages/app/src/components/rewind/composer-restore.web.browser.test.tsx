import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import type { UserComposerAttachment } from "@/attachments/types";
import type { UserMessageImageAttachment } from "@/types/stream";
import { RewindComposerRestoreProvider, useRewindComposerRestore } from "./composer-restore";
import { useRewindAgentMutation } from "./use-rewind-agent-mutation";

const { fetchAgentTimelineMock, rewindAgentMock, toastErrorMock } = vi.hoisted(() => ({
  fetchAgentTimelineMock: vi.fn(),
  rewindAgentMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ fetchAgentTimeline: fetchAgentTimelineMock }),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: toastErrorMock }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const rewoundImage: UserMessageImageAttachment = {
  id: "message-1:image:0",
  mimeType: "image/png",
  storageType: "inline-data",
  storageKey: "base64-image",
  createdAt: 1,
};

const rewoundFile = {
  type: "uploaded_file" as const,
  id: "file-1",
  fileName: "context.json",
  mimeType: "application/json",
  size: 42,
  path: "/tmp/context.json",
};

function RestoreControl() {
  const restore = useRewindComposerRestore();
  return (
    <button
      type="button"
      onClick={() =>
        restore?.restoreIfComposerEmpty({
          text: "rewound",
          images: [rewoundImage],
          attachments: [rewoundFile],
        })
      }
    >
      Restore
    </button>
  );
}

function RewindControl() {
  const rewind = useRewindAgentMutation({
    serverId: "server-1",
    agentId: "agent-1",
    messageId: "message-1",
    client: { rewindAgent: rewindAgentMock } as unknown as DaemonClient,
  });
  return (
    <button
      type="button"
      data-testid="rewind"
      onClick={() => {
        void rewind.rewindAgent({
          mode: "conversation",
          rewoundText: "rewound",
          rewoundImages: [rewoundImage],
          rewoundAttachments: [rewoundFile],
        });
      }}
    >
      Rewind
    </button>
  );
}

function ComposerHarness() {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<UserComposerAttachment[]>([]);
  return (
    <RewindComposerRestoreProvider
      restoreDraftIfEmpty={(draft) => {
        if (text.length > 0 || attachments.length > 0) return;
        setText(draft.text);
        setAttachments(draft.attachments);
      }}
    >
      <RestoreControl />
      <output data-testid="composer-text">{text}</output>
      <output data-testid="composer-images">
        {attachments
          .filter((attachment) => attachment.kind === "image")
          .map((attachment) => attachment.metadata.id)
          .join(",")}
      </output>
      <output data-testid="composer-files">
        {attachments
          .filter((attachment) => attachment.kind === "file")
          .map((attachment) => attachment.attachment.id)
          .join(",")}
      </output>
    </RewindComposerRestoreProvider>
  );
}

function RewindMutationHarness() {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<UserComposerAttachment[]>([]);
  return (
    <RewindComposerRestoreProvider
      restoreDraftIfEmpty={(draft) => {
        if (text.length > 0 || attachments.length > 0) return;
        setText(draft.text);
        setAttachments(draft.attachments);
      }}
    >
      <RewindControl />
      <output data-testid="rewind-text">{text}</output>
      <output data-testid="rewind-images">
        {attachments
          .filter((attachment) => attachment.kind === "image")
          .map((attachment) => attachment.metadata.id)
          .join(",")}
      </output>
      <output data-testid="rewind-files">
        {attachments
          .filter((attachment) => attachment.kind === "file")
          .map((attachment) => attachment.attachment.id)
          .join(",")}
      </output>
    </RewindComposerRestoreProvider>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("rewind composer restore", () => {
  it("returns the rewound text and image to an empty composer", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<ComposerHarness />));

    const restoreButton = container.querySelector("button");
    if (!restoreButton) throw new Error("Restore button did not render");
    act(() => restoreButton.click());

    expect(container.querySelector('[data-testid="composer-text"]')?.textContent).toBe("rewound");
    expect(container.querySelector('[data-testid="composer-images"]')?.textContent).toBe(
      rewoundImage.id,
    );
    expect(container.querySelector('[data-testid="composer-files"]')?.textContent).toBe(
      rewoundFile.id,
    );
  });

  it("restores the composer before the post-rewind timeline refresh settles", async () => {
    let resolveTimelineRefresh: (() => void) | undefined;
    rewindAgentMock.mockResolvedValue({ ok: true });
    fetchAgentTimelineMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveTimelineRefresh = resolve;
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        <QueryClientProvider client={queryClient}>
          <RewindMutationHarness />
        </QueryClientProvider>,
      ),
    );

    const rewindButton = container.querySelector('[data-testid="rewind"]');
    if (!(rewindButton instanceof HTMLButtonElement)) {
      throw new Error("Rewind button did not render");
    }
    act(() => rewindButton.click());

    await vi.waitFor(() => {
      expect(container?.querySelector('[data-testid="rewind-text"]')?.textContent).toBe("rewound");
      expect(container?.querySelector('[data-testid="rewind-images"]')?.textContent).toBe(
        rewoundImage.id,
      );
      expect(container?.querySelector('[data-testid="rewind-files"]')?.textContent).toBe(
        rewoundFile.id,
      );
    });
    expect(fetchAgentTimelineMock).toHaveBeenCalledOnce();
    expect(toastErrorMock).not.toHaveBeenCalled();

    await act(async () => resolveTimelineRefresh?.());
    queryClient.clear();
  });
});
