import { afterEach, describe, expect, it } from "vitest";
import { useConfirmDialogStore } from "@/stores/confirm-dialog-store";
import { confirmDialog } from "./confirm-dialog";

function dismissAllDialogs(): void {
  while (useConfirmDialogStore.getState().request) {
    useConfirmDialogStore.getState().respond(false);
  }
}

describe("confirmDialog", () => {
  afterEach(dismissAllDialogs);

  it("publishes the custom dialog request and resolves from its response", async () => {
    const confirmed = confirmDialog({
      title: "Delete conversation?",
      message: "This permanently deletes the conversation history.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });

    expect(useConfirmDialogStore.getState().request).toMatchObject({
      title: "Delete conversation?",
      message: "This permanently deletes the conversation history.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });

    useConfirmDialogStore.getState().respond(true);
    await expect(confirmed).resolves.toBe(true);
    expect(useConfirmDialogStore.getState().request).toBeNull();
  });

  it("queues simultaneous confirmations without replacing an unresolved dialog", async () => {
    const first = confirmDialog({
      title: "First dialog",
      message: "First message",
    });
    const second = confirmDialog({
      title: "Second dialog",
      message: "Second message",
    });

    expect(useConfirmDialogStore.getState().request?.title).toBe("First dialog");
    useConfirmDialogStore.getState().respond(false);
    await expect(first).resolves.toBe(false);
    expect(useConfirmDialogStore.getState().request?.title).toBe("Second dialog");

    useConfirmDialogStore.getState().respond(true);
    await expect(second).resolves.toBe(true);
    expect(useConfirmDialogStore.getState().request).toBeNull();
  });
});
