/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { usePublishWorkingDiffAttachment } from "./use-working-diff";
type ReviewComposerAttachment = NonNullable<
  Parameters<typeof usePublishWorkingDiffAttachment>[0]["attachment"]
>;

vi.mock("@/review", () => ({}));
vi.mock("@/git/use-diff-query", () => ({}));
vi.mock("@/git/use-status-query", () => ({}));

const scope = { serverId: "server-1", workspaceId: "workspace-1", cwd: "/repo" };
const scopeKey = buildWorkspaceAttachmentScopeKey(scope);

function review(body: string): ReviewComposerAttachment {
  return {
    kind: "review",
    reviewDraftKey: "review:key",
    commentCount: 1,
    attachment: {
      type: "review",
      mimeType: "application/paseo-review",
      cwd: scope.cwd,
      mode: "uncommitted",
      baseRef: null,
      comments: [
        {
          filePath: "src/a.ts",
          side: "new",
          lineNumber: 1,
          body,
          context: {
            hunkHeader: "@@ -1 +1 @@",
            targetLine: {
              oldLineNumber: null,
              newLineNumber: 1,
              type: "add",
              content: "const value = 1;",
            },
            lines: [
              { oldLineNumber: null, newLineNumber: 1, type: "add", content: "const value = 1;" },
            ],
          },
        },
      ],
    },
  };
}

afterEach(() => {
  cleanup();
  resetWorkspaceAttachmentsStore();
});

describe("working diff review publication", () => {
  it("retains the complete snapshot through pending details, then replaces and releases it", () => {
    const complete = review("Keep the complete context");
    interface Props {
      ready: boolean;
      attachment: ReviewComposerAttachment | null;
    }
    const { rerender, unmount } = renderHook(
      (props: Props) => usePublishWorkingDiffAttachment({ ...scope, enabled: true, ...props }),
      { initialProps: { ready: true, attachment: complete } as Props },
    );
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toEqual([
      complete,
    ]);
    rerender({ ready: false, attachment: null });
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toEqual([
      complete,
    ]);
    const updated = review("Updated with real context");
    rerender({ ready: true, attachment: updated });
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toEqual([updated]);
    unmount();
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
  });

  it("does not publish a partial pending review over another panel or clear that panel on unmount", () => {
    const otherPanel = [review("Another panel's complete review")];
    useWorkspaceAttachmentsStore
      .getState()
      .setWorkspaceAttachments({ scopeKey, attachments: otherPanel });
    const { rerender, unmount } = renderHook(
      ({ attachment }: { attachment: ReviewComposerAttachment | null }) =>
        usePublishWorkingDiffAttachment({ ...scope, enabled: true, ready: false, attachment }),
      {
        initialProps: { attachment: review("Only one loaded file") } as {
          attachment: ReviewComposerAttachment | null;
        },
      },
    );
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBe(otherPanel);
    rerender({ attachment: null });
    unmount();
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBe(otherPanel);
  });
});
