import { describe, expect, it } from "vitest";
import {
  MutableDaemonConfigSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  StatusMessageSchema,
} from "./messages.js";

describe("plugin protocol compatibility", () => {
  it("keeps old directory plugin config valid when enabled is absent", () => {
    const config = MutableDaemonConfigSchema.parse({
      mcp: { injectIntoAgents: true },
      plugins: { example: { source: "directory", path: "/plugins/example" } },
    });

    expect(config.plugins?.example?.enabled).toBeUndefined();
  });

  it("uses namespaced management request and response pairs", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "plugin.directory.install.request",
        requestId: "request-1",
        path: "/plugins/example",
        id: "example-work",
      }).type,
    ).toBe("plugin.directory.install.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "plugin.directory.inspect.request",
        requestId: "request-0",
        path: "/plugins/example",
      }).type,
    ).toBe("plugin.directory.inspect.request");
    expect(
      SessionOutboundMessageSchema.parse({
        type: "plugin.directory.install.response",
        payload: {
          requestId: "request-1",
          plugin: {
            id: "example-work",
            path: "/plugins/example",
            enabled: true,
            status: "running",
          },
        },
      }).type,
    ).toBe("plugin.directory.install.response");
  });

  it("uses a namespaced snapshot RPC for structured plugin logs", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "plugin.logs.get.request",
        requestId: "request-logs",
        pluginId: "example",
      }),
    ).toEqual({
      type: "plugin.logs.get.request",
      requestId: "request-logs",
      pluginId: "example",
    });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "plugin.logs.get.response",
        payload: {
          requestId: "request-logs",
          pluginId: "example",
          entries: [
            {
              sequence: 7,
              timestamp: "2026-08-16T12:00:00.000Z",
              stream: "stderr",
              message: "failed to connect",
            },
          ],
        },
      }),
    ).toEqual({
      type: "plugin.logs.get.response",
      payload: {
        requestId: "request-logs",
        pluginId: "example",
        entries: [
          {
            sequence: 7,
            timestamp: "2026-08-16T12:00:00.000Z",
            stream: "stderr",
            message: "failed to connect",
          },
        ],
      },
    });
  });

  it("keeps the plugin logs capability optional for older server info", () => {
    const older = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "older-host",
        features: { pluginManagement: true },
      },
    });
    const current = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "current-host",
        features: { pluginManagement: true, pluginLogs: true },
      },
    });

    expect(older.payload.features?.pluginLogs).toBeUndefined();
    expect(current.payload.features?.pluginLogs).toBe(true);
  });

  it("keeps the plugin themes capability optional for older server info", () => {
    const older = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "older-host",
        features: { plugins: true },
      },
    });
    const current = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "current-host",
        features: { plugins: true, pluginThemes: true },
      },
    });

    expect(older.payload.features?.pluginThemes).toBeUndefined();
    expect(current.payload.features?.pluginThemes).toBe(true);
  });

  it("keeps the catalog change notification safe for older clients", () => {
    expect(
      StatusMessageSchema.parse({
        type: "status",
        payload: { status: "plugin_catalog_changed", pluginId: "example" },
      }),
    ).toEqual({
      type: "status",
      payload: { status: "plugin_catalog_changed", pluginId: "example" },
    });
  });

  it("requires plugin action payloads and keeps remove empty", () => {
    expect(() =>
      SessionOutboundMessageSchema.parse({
        type: "plugin.reload.response",
        payload: { requestId: "request-1" },
      }),
    ).toThrow();
    expect(
      SessionOutboundMessageSchema.parse({
        type: "plugin.remove.response",
        payload: { requestId: "request-2" },
      }),
    ).toEqual({ type: "plugin.remove.response", payload: { requestId: "request-2" } });
    expect(() =>
      SessionOutboundMessageSchema.parse({
        type: "plugin.remove.response",
        payload: { requestId: "request-2", plugin: { id: "extra" } },
      }),
    ).toThrow();
  });

  it("accepts ompPlugins CLI management request and response pairs", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "ompPlugins.list.request",
        requestId: "r1",
      }).type,
    ).toBe("ompPlugins.list.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "ompPlugins.install.request",
        requestId: "r2",
        spec: " pi-memory ",
        dryRun: true,
      }),
    ).toMatchObject({ type: "ompPlugins.install.request", spec: "pi-memory" });
    expect(
      SessionInboundMessageSchema.parse({
        type: "ompPlugins.setEnabled.request",
        requestId: "r3",
        name: "pi-memory",
        enabled: false,
      }).type,
    ).toBe("ompPlugins.setEnabled.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "ompPlugins.doctor.request",
        requestId: "r4",
      }).type,
    ).toBe("ompPlugins.doctor.request");
    expect(
      SessionOutboundMessageSchema.parse({
        type: "ompPlugins.list.response",
        payload: {
          requestId: "r1",
          plugins: [{ name: "pi-memory", version: "0.4.2", enabled: true }],
          marketplace: [{ id: "mkt-plugin", scope: "user" }],
        },
      }),
    ).toMatchObject({
      type: "ompPlugins.list.response",
      payload: { plugins: [{ name: "pi-memory" }], marketplace: [{ id: "mkt-plugin" }] },
    });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "ompPlugins.doctor.response",
        payload: {
          requestId: "r4",
          checks: [{ name: "plugins_directory", status: "ok", message: "Found" }],
        },
      }).type,
    ).toBe("ompPlugins.doctor.response");
  });

  it("rejects ompPlugins install specs that are oversized or empty", () => {
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "ompPlugins.install.request",
        requestId: "r",
        spec: "",
      }),
    ).toThrow();
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "ompPlugins.install.request",
        requestId: "r",
        spec: "x".repeat(201),
      }),
    ).toThrow();
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "ompPlugins.remove.request",
        requestId: "r",
        name: "  ",
      }),
    ).toThrow();
  });

  it("allows ompPlugins list responses to carry raw output fallback and unknown fields", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "ompPlugins.list.response",
      payload: {
        requestId: "r",
        plugins: [{ name: "pkg", version: "1.0.0", someFutureField: 1 }],
        marketplace: [],
        rawOutput: "unparsable text",
      },
    });
    expect(parsed).toMatchObject({
      payload: { rawOutput: "unparsable text", plugins: [{ someFutureField: 1 }] },
    });
  });
});
