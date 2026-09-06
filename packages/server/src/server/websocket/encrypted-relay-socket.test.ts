import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import { createEncryptedRelaySocket } from "./encrypted-relay-socket.js";

function pendingSend() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("encrypted relay socket retirement", () => {
  test("flushes every accepted encrypted send before closing and rejects later frames", async () => {
    const response = pendingSend();
    const notification = pendingSend();
    const close = vi.fn();
    const emitter = new EventEmitter();
    const send = vi
      .fn()
      .mockReturnValueOnce(notification.promise)
      .mockReturnValueOnce(response.promise);
    const socket = createEncryptedRelaySocket({
      channel: { setState: vi.fn(), send, outboundWireByteLength: () => 64, close },
      emitter,
      getTransportBufferedAmount: () => 0,
      terminateTransport: vi.fn(),
    });
    const first = socket.send("config changed");
    const second = socket.send("set_daemon_config_response");
    socket.close(1001, "Relay configuration changed");
    expect(socket.readyState).toBe(2);
    await expect(socket.send("late frame")).rejects.toThrow();
    response.resolve();
    await second;
    expect(close).not.toHaveBeenCalled();
    notification.resolve();
    await first;
    await Promise.resolve();
    expect(close).toHaveBeenCalledWith(1001, "Relay configuration changed");
    emitter.emit("close", 1001);
    expect(socket.readyState).toBe(3);
  });

  test("forced teardown remains available while a graceful close is waiting on a send", async () => {
    const response = pendingSend();
    const close = vi.fn();
    const terminateTransport = vi.fn();
    const socket = createEncryptedRelaySocket({
      channel: {
        setState: vi.fn(),
        send: () => response.promise,
        outboundWireByteLength: () => 64,
        close,
      },
      emitter: new EventEmitter(),
      getTransportBufferedAmount: () => 0,
      terminateTransport,
    });
    const sent = socket.send("response");
    socket.close();
    socket.terminate();
    expect(terminateTransport).toHaveBeenCalledTimes(1);
    response.resolve();
    await sent;
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(3);
  });
});
