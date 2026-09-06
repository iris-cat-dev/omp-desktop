import { expect, test, vi } from "vitest";
import {
  createDaemonChannel,
  exportPublicKey,
  generateKeyPair,
  type Transport,
} from "@omp-desktop/relay/e2ee";
import { DaemonClient } from "./daemon-client.js";
import {
  createRelayE2eeTransportFactory,
  extractRelayMessage,
  type DaemonTransport,
} from "./daemon-client-transport.js";

function loopback() {
  let message: (data: unknown, isBinary: boolean) => void = () => {};
  let open: () => void = () => {};
  let close: (event?: unknown) => void = () => {};
  const wire: Array<string | Uint8Array | ArrayBuffer> = [];
  const peer: Transport = {
    send: (data) => {
      queueMicrotask(() => message(data, typeof data !== "string"));
    },
    close: (code, reason) => close({ code, reason }),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  const transport: DaemonTransport = {
    send: (data) => {
      wire.push(data);
      queueMicrotask(() => peer.onmessage?.(extractRelayMessage(data, typeof data !== "string")));
    },
    close: (code, reason) => peer.onclose?.(code ?? 1000, reason ?? ""),
    onOpen: (handler) => {
      open = handler;
      return () => {
        open = () => {};
      };
    },
    onMessage: (handler) => {
      message = handler;
      return () => {
        message = () => {};
      };
    },
    onClose: (handler) => {
      close = handler;
      return () => {
        close = () => {};
      };
    },
    onError: () => () => {},
  };
  return { transport, peer, wire, open: () => open() };
}

test("relay encrypts hello and correlated RPC even when e2ee.enabled is false", async () => {
  const link = loopback();
  const keys = generateKeyPair();
  const applicationMessages: unknown[] = [];
  const daemon = createDaemonChannel(link.peer, keys, {
    onmessage: (data) => {
      if (typeof data !== "string") throw new Error("Expected application JSON");
      const frame = JSON.parse(data);
      applicationMessages.push(frame);
      if (frame.type === "hello") {
        void daemon.then((channel) =>
          channel.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "status",
                payload: {
                  status: "server_info",
                  serverId: "srv_e2ee",
                  hostname: "remote",
                  version: null,
                },
              },
            }),
          ),
        );
      } else if (frame.message?.type === "daemon.get_pairing_offer.request") {
        void daemon.then((channel) =>
          channel.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "daemon.get_pairing_offer.response",
                payload: {
                  requestId: frame.message.requestId,
                  relayEnabled: true,
                  url: "https://web.test/#offer=private",
                },
              },
            }),
          ),
        );
      }
    },
  });
  const client = new DaemonClient({
    url: "wss://relay.test/ws?role=client&serverId=srv_e2ee&v=2",
    clientId: "encrypted_browser",
    transportFactory: () => link.transport,
    e2ee: { enabled: false, daemonPublicKeyB64: exportPublicKey(keys.publicKey) },
    reconnect: { enabled: false },
  });
  try {
    const connecting = client.connect();
    link.open();
    expect(link.wire).toHaveLength(1);
    expect(JSON.parse(link.wire[0] as string).type).toBe("e2ee_hello");
    expect(applicationMessages).toEqual([]);
    await connecting;
    expect(applicationMessages[0]).toMatchObject({ type: "hello" });
    const offer = await client.getDaemonPairingOffer();
    expect(offer).toMatchObject({ relayEnabled: true, url: "https://web.test/#offer=private" });
    // Only the key exchange is plaintext, never application hello or RPC.
    const plaintextTypes = link.wire
      .filter((frame): frame is string => typeof frame === "string" && frame.startsWith("{"))
      .map((frame) => JSON.parse(frame).type);
    expect(plaintextTypes).toEqual(["e2ee_hello"]);
  } finally {
    await client.close();
    (await daemon).close(1000, "Test complete");
  }
});

test("encrypted transport preserves binary terminal frames in both directions", async () => {
  const link = loopback();
  const keys = generateKeyPair();
  const receivedByDaemon: Array<string | ArrayBuffer> = [];
  const daemon = createDaemonChannel(link.peer, keys, {
    onmessage: (data) => receivedByDaemon.push(data),
  });
  const transport = createRelayE2eeTransportFactory({
    baseFactory: () => link.transport,
    daemonPublicKeyB64: exportPublicKey(keys.publicKey),
    logger: { warn: vi.fn() },
  })({ url: "wss://relay.test/ws?role=client&serverId=srv_binary&v=2" });
  const receivedByClient: unknown[] = [];
  transport.onMessage((data) => receivedByClient.push(data));
  const opened = new Promise<void>((resolve) => transport.onOpen(resolve));
  link.open();
  await opened;
  const channel = await daemon;
  try {
    const bytes = new Uint8Array([255, 0, 13, 10, 27, 91, 65, 128]);
    transport.send(bytes.subarray(1, 7));
    await vi.waitFor(() => expect(receivedByDaemon).toHaveLength(1));
    expect(new Uint8Array(receivedByDaemon[0] as ArrayBuffer)).toEqual(bytes.subarray(1, 7));
    await channel.send(bytes.buffer);
    await vi.waitFor(() => expect(receivedByClient).toHaveLength(1));
    expect(new Uint8Array(receivedByClient[0] as ArrayBuffer)).toEqual(bytes);
  } finally {
    transport.close(1000, "Test complete");
    channel.close(1000, "Test complete");
  }
});
