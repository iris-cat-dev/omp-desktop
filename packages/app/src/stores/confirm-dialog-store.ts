import { create } from "zustand";

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ConfirmDialogRequest extends ConfirmDialogInput {
  id: number;
}

interface PendingConfirmDialog extends ConfirmDialogRequest {
  resolve: (confirmed: boolean) => void;
}

interface ConfirmDialogStoreState {
  request: ConfirmDialogRequest | null;
  open: (input: ConfirmDialogInput) => Promise<boolean>;
  respond: (confirmed: boolean) => void;
}

let nextRequestId = 1;
let activeRequest: PendingConfirmDialog | null = null;
const pendingRequests: PendingConfirmDialog[] = [];

function toPublicRequest(request: PendingConfirmDialog): ConfirmDialogRequest {
  const { resolve: _resolve, ...publicRequest } = request;
  return publicRequest;
}

export const useConfirmDialogStore = create<ConfirmDialogStoreState>((set) => ({
  request: null,
  open: (input) =>
    new Promise<boolean>((resolve) => {
      const request: PendingConfirmDialog = {
        ...input,
        id: nextRequestId++,
        resolve,
      };
      if (activeRequest) {
        pendingRequests.push(request);
        return;
      }
      activeRequest = request;
      set({ request: toPublicRequest(request) });
    }),
  respond: (confirmed) => {
    if (!activeRequest) return;

    const completedRequest = activeRequest;
    activeRequest = pendingRequests.shift() ?? null;
    set({ request: activeRequest ? toPublicRequest(activeRequest) : null });
    completedRequest.resolve(confirmed);
  },
}));

export function openConfirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  return useConfirmDialogStore.getState().open(input);
}
