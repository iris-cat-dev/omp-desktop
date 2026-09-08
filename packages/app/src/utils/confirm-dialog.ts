import { openConfirmDialog, type ConfirmDialogInput } from "@/stores/confirm-dialog-store";

export type { ConfirmDialogInput } from "@/stores/confirm-dialog-store";

export function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  return openConfirmDialog(input);
}
