import { describe, expect, it, vi } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import {
  OmpPluginCliService,
  OmpPluginOperationInProgressError,
  OmpPluginUnavailableError,
  type OmpPluginRunner,
} from "./omp-plugin-cli-service.js";

function makeRunner(
  stdout: string,
  impl?: (command: string, args: string[]) => string,
): OmpPluginRunner & { calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner = vi.fn(async (command: string, args: string[]) => {
    calls.push({ command, args });
    return { stdout: impl ? impl(command, args) : stdout, stderr: "" };
  }) as unknown as OmpPluginRunner & { calls: Array<{ command: string; args: string[] }> };
  runner.calls = calls;
  return runner;
}

function makeService(runner: OmpPluginRunner, ompCommand = "C:/bin/omp.cmd") {
  return new OmpPluginCliService({
    logger: createTestLogger(),
    runner,
    resolveOmpCommand: async () => ompCommand,
  });
}

const LIST_JSON = JSON.stringify({
  npm: [
    { name: "pi-memory", version: "0.4.2", enabled: true, path: "C:/plugins/pi-memory" },
    { name: "other", version: "1.0.0", enabled: false, path: "C:/plugins/other" },
  ],
  marketplace: [{ id: "mkt-plugin", scope: "user", version: "2.0.0" }],
});

describe("OmpPluginCliService", () => {
  it("lists plugins and marketplace entries from omp plugin list --json", async () => {
    const runner = makeRunner(LIST_JSON);
    const result = await makeService(runner).list();

    expect(runner.calls[0]?.args).toEqual(["plugin", "list", "--json"]);
    expect(result.plugins).toHaveLength(2);
    expect(result.plugins[0]?.name).toBe("pi-memory");
    expect(result.marketplace[0]?.id).toBe("mkt-plugin");
    expect(result.rawOutput).toBeUndefined();
  });

  it("falls back to rawOutput when list output is not parseable JSON", async () => {
    const runner = makeRunner("omp: not logged in");
    const result = await makeService(runner).list();

    expect(result.plugins).toEqual([]);
    expect(result.rawOutput).toContain("not logged in");
  });

  it("extracts the trailing JSON object when progress lines precede it", async () => {
    const runner = makeRunner(`resolving...\n${LIST_JSON}`);
    const result = await makeService(runner).list();

    expect(result.plugins).toHaveLength(2);
  });

  it("rejects a second operation while one is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowRunner: OmpPluginRunner = async () => {
      await gate;
      return { stdout: LIST_JSON, stderr: "" };
    };
    const service = makeService(slowRunner);
    const first = service.list();
    await expect(service.list()).rejects.toBeInstanceOf(OmpPluginOperationInProgressError);
    release();
    await first;
    // Serialization unlocks after completion.
    const third = await service.list();
    expect(third.plugins).toHaveLength(2);
  });

  it("reports ok:false with the CLI error message when install fails", async () => {
    const runner: OmpPluginRunner = async () => {
      const error = new Error("boom") as Error & { stdout?: string; stderr?: string };
      error.stdout = "npm error 404";
      throw error;
    };
    const result = await makeService(runner).install({ spec: "nope" });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("404");
  });

  it("matches the installed plugin by name derived from the spec", async () => {
    const runner = makeRunner(
      `installing pi-memory...\n${JSON.stringify({ npm: [{ name: "pi-memory", version: "0.4.2", enabled: true }], marketplace: [] })}`,
    );
    const result = await makeService(runner).install({ spec: "pi-memory" });

    expect(runner.calls[0]?.args).toEqual(["plugin", "install", "pi-memory", "--json"]);
    expect(result.ok).toBe(true);
    expect(result.plugin?.name).toBe("pi-memory");
  });

  it("parses install responses that print the plugin object itself", async () => {
    const runner = makeRunner(
      JSON.stringify({
        name: "@omp/plugin-memory",
        version: "0.0.0-dryrun",
        path: "",
        enabled: true,
      }),
    );
    const result = await makeService(runner).install({ spec: "@omp/plugin-memory", dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.plugin?.name).toBe("@omp/plugin-memory");
  });

  it("omits scope and dry-run flags when not requested", async () => {
    const runner = makeRunner(
      JSON.stringify({ npm: [{ name: "x", version: "1", enabled: true }], marketplace: [] }),
    );
    await makeService(runner).install({ spec: "x", dryRun: true, scope: "project" });

    expect(runner.calls[0]?.args).toEqual([
      "plugin",
      "install",
      "x",
      "--json",
      "--scope",
      "project",
      "--dry-run",
    ]);
  });

  it("verifies setEnabled against a fresh list instead of trusting exit code", async () => {
    let enabled = false;
    const runner = makeRunner("", () =>
      JSON.stringify({
        npm: [{ name: "p1", version: "1", enabled, path: "x" }],
        marketplace: [],
      }),
    );
    const service = makeService(runner);
    const result = await service.setEnabled("p1", true);

    expect(result.ok).toBe(false);

    enabled = true;
    const retry = await service.setEnabled("p1", true);
    expect(retry.ok).toBe(true);
  });

  it("returns doctor checks parsed from CLI output", async () => {
    const checks = [{ name: "plugins_directory", status: "ok", message: "Found" }];
    const runner = makeRunner(JSON.stringify(checks));
    const result = await makeService(runner).doctor();

    expect(runner.calls[0]?.args).toEqual(["plugin", "doctor", "--json"]);
    expect(result.checks).toEqual(checks);
  });

  it("raises OmpPluginUnavailableError when omp cannot be resolved", async () => {
    const runner = makeRunner("");
    const service = new OmpPluginCliService({
      logger: createTestLogger(),
      runner,
      resolveOmpCommand: async () => null,
    });

    await expect(service.list()).rejects.toBeInstanceOf(OmpPluginUnavailableError);
    expect(runner.calls).toHaveLength(0);
  });

  it("removes plugins via omp plugin uninstall", async () => {
    const runner = makeRunner("removed");
    const result = await makeService(runner).remove("pi-memory");

    expect(runner.calls[0]?.args).toEqual(["plugin", "uninstall", "pi-memory"]);
    expect(result.ok).toBe(true);
  });
});
