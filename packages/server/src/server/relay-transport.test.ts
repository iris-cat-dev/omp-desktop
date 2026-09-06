import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import pino from "pino";
import { generateKeyPair } from "@omp-desktop/relay/e2ee";
import { startRelayTransport } from "./relay-transport.js";

class ControlledSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  terminate = vi.fn(() => {
    this.finishClose();
  });
  ping = vi.fn();
  send(_data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) {
    callback?.();
  }
  finishClose() {
    this.readyState = 3;
    this.emit("close", 1001, "retired");
  }
}

function createTransport() {
  const sockets: ControlledSocket[] = [];
  const transport = startRelayTransport({
    logger: pino({ level: "silent" }),
    attachSocket: async () => undefined,
    relayEndpoint: "localhost:4000",
    relayUseTls: false,
    serverId: "relay-retirement-test",
    daemonKeyPair: generateKeyPair(),
    createWebSocket: () => {
      const socket = new ControlledSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const control = sockets[0];
  control.emit("open");
  control.emit("message", JSON.stringify({ type: "connected", connectionId: "client" }));
  return { transport, sockets, control, data: sockets[1] };
}

describe("relay transport retirement", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("waits for all data close handshakes before retiring control and resolving stop", async () => {
    vi.useFakeTimers();
    const { transport, sockets, control, data } = createTransport();
    const stopped = transport.stop();
    expect(transport.stop()).toBe(stopped);
    expect(data.close).toHaveBeenCalledTimes(1);
    expect(control.close).not.toHaveBeenCalled();
    control.emit("message", JSON.stringify({ type: "connected", connectionId: "late" }));
    expect(sockets).toHaveLength(2);
    data.finishClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(control.close).toHaveBeenCalledTimes(1);
    let retired = false;
    void stopped.then(() => (retired = true));
    await Promise.resolve();
    expect(retired).toBe(false);
    control.finishClose();
    await stopped;
    expect(retired).toBe(true);
    expect(data.terminate).not.toHaveBeenCalled();
    expect(control.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
  });

  test("bounds stalled data and control close handshakes with forced teardown", async () => {
    vi.useFakeTimers();
    const { transport, control, data } = createTransport();
    const stopped = transport.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(data.terminate).toHaveBeenCalledTimes(1);
    expect(control.close).toHaveBeenCalledTimes(1);
    expect(control.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await stopped;
    expect(control.terminate).toHaveBeenCalledTimes(1);
  });

  test("also retires a data socket removed from the client registry while still closing", async () => {
    vi.useFakeTimers();
    const { transport, control, data } = createTransport();
    control.emit("message", JSON.stringify({ type: "disconnected", connectionId: "client" }));
    expect(data.readyState).toBe(2);
    const stopped = transport.stop();
    expect(control.close).not.toHaveBeenCalled();
    data.finishClose();
    await vi.advanceTimersByTimeAsync(0);
    control.finishClose();
    await stopped;
    expect(data.terminate).not.toHaveBeenCalled();
  });
});
