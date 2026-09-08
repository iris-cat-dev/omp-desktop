import { describe, expect, it } from "vitest";
import { CloseChoiceRequestBroker, type CloseChoiceRequest } from "./close-choice-request.js";

class FakeWebContents {
  readonly sent: CloseChoiceRequest[] = [];
  destroyed = false;
  private destroyedListener: (() => void) | null = null;

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, payload: CloseChoiceRequest): void {
    expect(channel).toBe("paseo:event:close-choice-request");
    this.sent.push(payload);
  }

  once(_event: "destroyed", listener: () => void): void {
    this.destroyedListener = listener;
  }

  destroy(): void {
    this.destroyed = true;
    this.destroyedListener?.();
  }
}

describe("CloseChoiceRequestBroker", () => {
  it("holds an early request for the renderer and resolves its matching response", async () => {
    const broker = new CloseChoiceRequestBroker();
    const contents = new FakeWebContents(41);
    const response = broker.request(contents);
    const request = contents.sent[0];

    expect(broker.getPending(contents.id)).toEqual(request);
    expect(
      broker.respond(contents.id, {
        requestId: request?.requestId,
        choice: "background",
        remember: true,
      }),
    ).toBe(true);
    await expect(response).resolves.toEqual({
      requestId: request?.requestId,
      choice: "background",
      remember: true,
    });
    expect(broker.getPending(contents.id)).toBeNull();
  });

  it("rejects a response from another renderer", () => {
    const broker = new CloseChoiceRequestBroker();
    const contents = new FakeWebContents(41);
    void broker.request(contents);

    expect(
      broker.respond(99, {
        requestId: contents.sent[0]?.requestId,
        choice: "quit",
        remember: false,
      }),
    ).toBe(false);
    expect(broker.getPending(contents.id)).toEqual(contents.sent[0]);
  });

  it("cancels the pending choice when its renderer is destroyed", async () => {
    const broker = new CloseChoiceRequestBroker();
    const contents = new FakeWebContents(41);
    const response = broker.request(contents);
    contents.destroy();

    await expect(response).resolves.toMatchObject({ choice: "cancel", remember: false });
    expect(broker.getPending(contents.id)).toBeNull();
  });
});
