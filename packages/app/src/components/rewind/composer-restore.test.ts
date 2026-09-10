import { describe, expect, test } from "vitest";
import { createRewoundComposerAttachments } from "./composer-restore";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";

describe("createRewoundComposerAttachments", () => {
  const rewoundImage = {
    id: "message-1:image:0",
    mimeType: "image/png",
    storageType: "inline-data" as const,
    storageKey: "base64-image",
    createdAt: 1,
  };
  const uploadedFile = {
    type: "uploaded_file" as const,
    id: "file-1",
    fileName: "context.json",
    mimeType: "application/json",
    size: 42,
    path: "/tmp/context.json",
  };

  test("restores image and uploaded-file attachments", () => {
    expect(
      createRewoundComposerAttachments({
        images: [rewoundImage],
        attachments: [uploadedFile],
      }),
    ).toEqual([
      { kind: "image", metadata: rewoundImage },
      { kind: "file", attachment: uploadedFile },
    ]);
  });

  test("restores workspace file and directory references", () => {
    expect(
      createRewoundComposerAttachments({
        images: [],
        attachments: [
          {
            type: "text",
            mimeType: "text/plain",
            title: "message.tsx",
            text: "Workspace file: packages/app/src/components/message.tsx\nLines: 10-20",
          },
          {
            type: "text",
            mimeType: "text/plain",
            contextKind: "directory",
            title: "rewind",
            text: "Directory: packages/app/src/components/rewind",
          },
        ],
      }),
    ).toEqual([
      {
        kind: "workspace_file",
        path: "packages/app/src/components/message.tsx",
        selection: { kind: "line_range", startLine: 10, endLine: 20 },
      },
      {
        kind: "directory",
        path: "packages/app/src/components/rewind",
      },
    ]);
  });

  test("preserves unstructured text attachments as quoted content", () => {
    expect(
      createRewoundComposerAttachments({
        images: [],
        attachments: [
          {
            type: "text",
            mimeType: "text/plain",
            title: "Reference",
            text: "Keep this context",
          },
        ],
      }),
    ).toEqual([
      {
        kind: "quoted_content",
        id: expect.any(String),
        text: "Keep this context",
      },
    ]);
  });
});

describe("shouldRestoreComposerForRewindMode", () => {
  test("restores only conversation-mutating rewind modes", () => {
    expect(shouldRestoreComposerForRewindMode("conversation")).toBe(true);
    expect(shouldRestoreComposerForRewindMode("files")).toBe(false);
    expect(shouldRestoreComposerForRewindMode("both")).toBe(true);
  });
});
