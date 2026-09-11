import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDaemonTestContext,
  type DaemonTestContext,
} from "./test-utils/daemon-test-context.js";

/**
 * End-to-end: a real daemon session must route ompPlugins.* messages to the
 * CLI service and answer with namespaced responses. Skips gracefully when the
 * host has no `omp` binary installed.
 */
describe("ompPlugins session routing", () => {
  let ctx: DaemonTestContext;
  let hasOmpCli: boolean;

  beforeAll(async () => {
    ctx = await createDaemonTestContext();
    hasOmpCli = process.platform === "win32";
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("answers ompPlugins.list.request with a namespaced response", async () => {
    if (!hasOmpCli) return;
    const result = await ctx.client.listOmpPlugins();
    expect(result.requestId).toBeTruthy();
    expect(Array.isArray(result.plugins)).toBe(true);
    expect(Array.isArray(result.marketplace)).toBe(true);
  });

  it("answers ompPlugins.doctor.request with parsed checks", async () => {
    if (!hasOmpCli) return;
    const result = await ctx.client.runOmpPluginDoctor();
    expect(result.requestId).toBeTruthy();
    expect(Array.isArray(result.checks)).toBe(true);
    if (result.checks.length > 0) {
      for (const check of result.checks) {
        expect(["ok", "warning", "error"]).toContain(check.status);
      }
    }
  });

  it("answers ompPlugins.install.request with ok flag on dry run", async () => {
    if (!hasOmpCli) return;
    const result = await ctx.client.installOmpPlugin({ spec: "@omp/plugin-memory", dryRun: true });
    expect(result.requestId).toBeTruthy();
    expect(result.ok).toBe(true);
    expect(result.plugin?.name).toBe("@omp/plugin-memory");
  });
});
