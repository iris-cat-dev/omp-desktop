import { describe, expect, it } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import { OmpPluginCliService, type OmpPluginRunner } from "./omp-plugin-cli-service.js";
import { OmpPluginSession } from "./omp-plugin-session.js";

const LIST_JSON = JSON.stringify({
  npm: [{ name: "pi-memory", version: "0.4.2", enabled: true, path: "C:/p" }],
  marketplace: [],
});

function makeSession(runner: OmpPluginRunner) {
  const emitted: unknown[] = [];
  const service = new OmpPluginCliService({
    logger: createTestLogger(),
    runner,
    resolveOmpCommand: async () => "omp",
  });
  const session = new OmpPluginSession({
    service,
    emit: (msg) => emitted.push(msg),
    logger: createTestLogger(),
  });
  return { session, emitted };
}

describe("OmpPluginSession", () => {
  it("answers list requests with an ompPlugins.list.response", async () => {
    const { session, emitted } = makeSession(async () => ({ stdout: LIST_JSON, stderr: "" }));

    await session.handleInboundMessage({
      type: "ompPlugins.list.request",
      requestId: "r-1",
    } as never);

    expect(emitted[0]).toMatchObject({
      type: "ompPlugins.list.response",
      payload: { requestId: "r-1", plugins: [{ name: "pi-memory" }] },
    });
  });

  it("degrades service errors to an error status instead of a response", async () => {
    const { session, emitted } = makeSession(async () => {
      throw new Error("cli exploded");
    });

    await session.handleInboundMessage({
      type: "ompPlugins.doctor.request",
      requestId: "r-2",
    } as never);

    expect(emitted[0]).toMatchObject({
      type: "status",
      payload: { severity: "error", message: "cli exploded", scope: "ompPlugins" },
    });
  });

  it("returns undefined for unrelated message types", () => {
    const { session } = makeSession(async () => ({ stdout: "", stderr: "" }));

    const result = session.handleInboundMessage({
      type: "status",
      payload: { status: "ok" },
    } as never);

    expect(result).toBeUndefined();
  });

  it("carries name and enabled in setEnabled responses", async () => {
    const { session, emitted } = makeSession(async () => ({
      stdout: JSON.stringify({
        npm: [{ name: "p1", version: "1", enabled: true, path: "x" }],
        marketplace: [],
      }),
      stderr: "",
    }));

    await session.handleInboundMessage({
      type: "ompPlugins.setEnabled.request",
      requestId: "r-3",
      name: "p1",
      enabled: true,
    } as never);

    expect(emitted[0]).toMatchObject({
      type: "ompPlugins.setEnabled.response",
      payload: { requestId: "r-3", name: "p1", enabled: true, ok: true },
    });
  });
});
