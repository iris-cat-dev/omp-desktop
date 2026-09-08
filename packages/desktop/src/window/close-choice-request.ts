export type CloseChoice = "background" | "quit" | "cancel";

export interface CloseChoiceRequest {
  requestId: number;
}

export interface CloseChoiceResponse extends CloseChoiceRequest {
  choice: CloseChoice;
  remember: boolean;
}

interface CloseChoiceWebContents {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: CloseChoiceRequest): void;
  once(event: "destroyed", listener: () => void): void;
}

interface PendingCloseChoice {
  request: CloseChoiceRequest;
  promise: Promise<CloseChoiceResponse>;
  resolve: (response: CloseChoiceResponse) => void;
}

const CLOSE_CHOICE_REQUEST_EVENT = "paseo:event:close-choice-request";

function readResponse(input: unknown): CloseChoiceResponse | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<CloseChoiceResponse>;
  if (!Number.isSafeInteger(candidate.requestId)) return null;
  if (
    candidate.choice !== "background" &&
    candidate.choice !== "quit" &&
    candidate.choice !== "cancel"
  ) {
    return null;
  }
  if (typeof candidate.remember !== "boolean") return null;
  return candidate as CloseChoiceResponse;
}

export class CloseChoiceRequestBroker {
  private readonly pendingByWebContentsId = new Map<number, PendingCloseChoice>();
  private nextRequestId = 1;

  request(webContents: CloseChoiceWebContents): Promise<CloseChoiceResponse> {
    if (webContents.isDestroyed()) {
      return Promise.resolve({ requestId: 0, choice: "cancel", remember: false });
    }

    const existing = this.pendingByWebContentsId.get(webContents.id);
    if (existing) return existing.promise;

    const request = { requestId: this.nextRequestId++ };
    let resolveResponse!: (response: CloseChoiceResponse) => void;
    const promise = new Promise<CloseChoiceResponse>((resolve) => {
      resolveResponse = resolve;
    });
    this.pendingByWebContentsId.set(webContents.id, {
      request,
      promise,
      resolve: resolveResponse,
    });
    webContents.once("destroyed", () => {
      this.cancel(webContents.id, request.requestId);
    });
    webContents.send(CLOSE_CHOICE_REQUEST_EVENT, request);
    return promise;
  }

  getPending(webContentsId: number): CloseChoiceRequest | null {
    return this.pendingByWebContentsId.get(webContentsId)?.request ?? null;
  }

  respond(webContentsId: number, input: unknown): boolean {
    const response = readResponse(input);
    const pending = this.pendingByWebContentsId.get(webContentsId);
    if (!response || !pending || response.requestId !== pending.request.requestId) {
      return false;
    }

    this.pendingByWebContentsId.delete(webContentsId);
    pending.resolve(response);
    return true;
  }

  private cancel(webContentsId: number, requestId: number): void {
    const pending = this.pendingByWebContentsId.get(webContentsId);
    if (!pending || pending.request.requestId !== requestId) return;

    this.pendingByWebContentsId.delete(webContentsId);
    pending.resolve({ requestId, choice: "cancel", remember: false });
  }
}
