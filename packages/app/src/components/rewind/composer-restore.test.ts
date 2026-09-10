import { describe, expect, test } from "vitest";
import { restoreComposerAttachmentsIfEmpty, restoreComposerTextIfEmpty } from "./composer-restore";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";

describe("restoreComposerTextIfEmpty", () => {
  test("restores the rewound message when the composer is empty", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "",
        rewoundText: "message before rewind",
      }),
    ).toBe("message before rewind");
  });

  test("preserves an existing composer draft", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "keep this draft",
        rewoundText: "message before rewind",
      }),
    ).toBe("keep this draft");
  });
});

describe("restoreComposerAttachmentsIfEmpty", () => {
  const rewoundImage = {
    id: "message-1:image:0",
    mimeType: "image/png",
    storageType: "inline-data" as const,
    storageKey: "base64-image",
    createdAt: 1,
  };

  test("restores rewound images when the composer has no attachments", () => {
    expect(
      restoreComposerAttachmentsIfEmpty({
        currentAttachments: [],
        rewoundImages: [rewoundImage],
      }),
    ).toEqual([{ kind: "image", metadata: rewoundImage }]);
  });

  test("preserves existing composer attachments", () => {
    const currentAttachments = [{ kind: "quoted_content" as const, id: "quote-1", text: "draft" }];

    expect(
      restoreComposerAttachmentsIfEmpty({
        currentAttachments,
        rewoundImages: [rewoundImage],
      }),
    ).toBe(currentAttachments);
  });
});

describe("shouldRestoreComposerForRewindMode", () => {
  test("restores only conversation-mutating rewind modes", () => {
    expect(shouldRestoreComposerForRewindMode("conversation")).toBe(true);
    expect(shouldRestoreComposerForRewindMode("files")).toBe(false);
    expect(shouldRestoreComposerForRewindMode("both")).toBe(true);
  });
});
