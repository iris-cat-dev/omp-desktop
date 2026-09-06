import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { generateKeyPair } from "@omp-desktop/relay/e2ee";
import { createRelayRuntime } from "./relay-runtime.js";

const config = {
  enabled: false,
  endpoint: "relay.example.test:443",
  publicEndpoint: "relay.example.test:443",
  useTls: true,
  publicUseTls: true,
};

function runtimeOptions() {
  return {
    config,
    logger: pino({ level: "silent" }),
    attachSocket: async () => undefined,
    serverId: "relay-runtime-test",
    daemonKeyPair: generateKeyPair(),
  };
}

const dispatchBoundary = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("relay runtime rotation", () => {
  test("editing a disabled relay never registers, and public-only edits do not rotate", async () => {
    const stop = vi.fn(async () => undefined);
    const startTransport = vi.fn(() => ({ stop }));
    const runtime = createRelayRuntime({ ...runtimeOptions(), startTransport });
    const next = { ...config, endpoint: "localhost:4001", useTls: false };
    runtime.updateConfig(next);
    await dispatchBoundary();
    expect(startTransport).not.toHaveBeenCalled();
    runtime.updateConfig({ ...next, enabled: true });
    await dispatchBoundary();
    expect(startTransport).toHaveBeenCalledTimes(1);
    runtime.updateConfig({ ...next, enabled: true, publicEndpoint: "public.example.test:443" });
    await dispatchBoundary();
    expect(stop).not.toHaveBeenCalled();
    expect(runtime.getConfig().publicEndpoint).toBe("public.example.test:443");
    await runtime.stop();
  });

  test("defers teardown past response dispatch and registers only the latest address after retirement", async () => {
    const retirement = deferred();
    const order: string[] = [];
    const startTransport = vi.fn(({ relayEndpoint }: { relayEndpoint: string }) => {
      order.push(`register:${relayEndpoint}`);
      return {
        stop: () => {
          order.push(`stop:${relayEndpoint}`);
          return retirement.promise;
        },
      };
    });
    const runtime = createRelayRuntime({
      ...runtimeOptions(),
      config: { ...config, enabled: true },
      startTransport,
    });
    runtime.updateConfig({ ...config, enabled: true, endpoint: "localhost:4001" });
    runtime.updateConfig({ ...config, enabled: true, endpoint: "localhost:4002" });
    order.push("response");
    await Promise.resolve();
    expect(order).toEqual([`register:${config.endpoint}`, "response"]);
    await dispatchBoundary();
    expect(order).toEqual([`register:${config.endpoint}`, "response", `stop:${config.endpoint}`]);
    runtime.updateConfig({ ...config, enabled: true, endpoint: "localhost:4003" });
    retirement.resolve();
    await dispatchBoundary();
    expect(startTransport.mock.calls.map(([options]) => options.relayEndpoint)).toEqual([
      config.endpoint,
      "localhost:4003",
    ]);
    await runtime.stop();
  });

  test("shutdown waits for retirement and prevents queued or in-flight resurrection", async () => {
    const retirement = deferred();
    const startTransport = vi.fn(() => ({ stop: () => retirement.promise }));
    const runtime = createRelayRuntime({
      ...runtimeOptions(),
      config: { ...config, enabled: true },
      startTransport,
    });
    runtime.updateConfig({ ...config, enabled: true, endpoint: "localhost:4001" });
    await dispatchBoundary();
    let settled = false;
    const shutdown = runtime.stop().then(() => (settled = true));
    runtime.updateConfig({ ...config, enabled: true, endpoint: "localhost:4002" });
    await Promise.resolve();
    expect(settled).toBe(false);
    retirement.resolve();
    await shutdown;
    await dispatchBoundary();
    expect(startTransport).toHaveBeenCalledTimes(1);
    expect(runtime.getConfig().enabled).toBe(false);
  });

  test("shutdown cancels an enable scheduled in the current dispatch", async () => {
    const startTransport = vi.fn(() => ({ stop: async () => undefined }));
    const runtime = createRelayRuntime({ ...runtimeOptions(), startTransport });
    runtime.updateConfig({ ...config, enabled: true });
    await runtime.stop();
    await dispatchBoundary();
    expect(startTransport).not.toHaveBeenCalled();
  });
});
