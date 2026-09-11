import { describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { buildProviderRegistry, createAllClients } from "./provider-registry.js";
import { FakeOmp } from "./providers/omp/test-utils/fake-omp.js";

const logger = createTestLogger();

describe("OMP provider registry", () => {
  test("registers only an enabled OMP provider", () => {
    const registry = buildProviderRegistry(logger);

    expect(Object.keys(registry)).toEqual(["omp"]);
    expect(registry.omp).toMatchObject({
      id: "omp",
      label: "Oh My Pi",
      enabled: true,
      defaultModeId: "ask",
      derivedFromProviderId: null,
    });
  });

  test("import-only providers keep empty modes even when the runtime catalog reports OMP modes", async () => {
    const registry = buildProviderRegistry(logger, { ompRuntime: new FakeOmp() });
    for (const provider of ["pi", "codex"] as const) {
      const catalog = await registry[provider].fetchCatalog({ scope: "global" });
      // The facade delegates to the OMP client, whose catalog carries OMP's
      // creation modes; the import-only definition must not inherit them, or
      // the UI's "no modes means not create-capable" filter leaks these
      // providers into the new-session provider list.
      expect(catalog.modes).toEqual([]);
    }
  });

  test("launches OMP in always-ask mode by default", async () => {
    const omp = new FakeOmp();
    const registry = buildProviderRegistry(logger, { ompRuntime: omp });
    const client = registry.omp.createClient(logger);
    const session = await client.createSession({ provider: "omp", cwd: "/tmp/registry-omp" });

    expect(omp.recordedLaunches).toEqual([
      expect.objectContaining({
        cwd: "/tmp/registry-omp",
        protocolMode: "rpc-ui",
        argv: ["omp", "--mode", "rpc-ui", "--approval-mode", "always-ask"],
      }),
    ]);
    await session.close();
  });

  test("applies built-in OMP display overrides", () => {
    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        omp: {
          label: "OMP",
          description: "Local OMP runtime",
        },
      },
    });

    expect(registry.omp.label).toBe("OMP");
    expect(registry.omp.description).toBe("Local OMP runtime");
  });

  test("rejects custom and derived providers", () => {
    expect(() =>
      buildProviderRegistry(logger, {
        providerOverrides: {
          codex: { enabled: true },
        },
      }),
    ).toThrow("OMP Desktop supports only the built-in 'omp' provider; received 'codex'");
  });

  test("creates only the OMP client", () => {
    const clients = createAllClients(logger, { ompRuntime: new FakeOmp() });

    expect(Object.keys(clients)).toEqual(["omp"]);
    expect(clients.omp.provider).toBe("omp");
  });
});
