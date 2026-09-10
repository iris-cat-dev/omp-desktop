import { describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { buildProviderRegistry, createAllClients } from "./provider-registry.js";
import { FakeOmp } from "./providers/omp/test-utils/fake-omp.js";

const logger = createTestLogger();

describe("OMP provider registry", () => {
  test("registers the OMP provider plus import-only external providers", () => {
    const registry = buildProviderRegistry(logger);

    expect(Object.keys(registry)).toEqual(["omp", "pi", "codex"]);
    expect(registry.omp).toMatchObject({
      id: "omp",
      label: "Oh My Pi",
      enabled: true,
      defaultModeId: "ask",
      derivedFromProviderId: null,
    });
    // Import-only providers expose no creation modes.
    expect(registry.pi).toMatchObject({ id: "pi", enabled: true, defaultModeId: null, modes: [] });
    expect(registry.codex).toMatchObject({
      id: "codex",
      enabled: true,
      defaultModeId: null,
      modes: [],
    });
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

  test("rejects unknown custom providers", () => {
    expect(() =>
      buildProviderRegistry(logger, {
        providerOverrides: {
          claude: { enabled: true },
        },
      }),
    ).toThrow("OMP Desktop supports only the built-in 'omp' provider; received 'claude'");
  });

  test("creates the OMP client plus import facades", () => {
    const clients = createAllClients(logger, { ompRuntime: new FakeOmp() });

    expect(Object.keys(clients)).toEqual(["omp", "pi", "codex"]);
    expect(clients.omp.provider).toBe("omp");
    expect(clients.pi.provider).toBe("pi");
    expect(clients.pi.capabilities.supportsSessionListing).toBe(true);
    expect(typeof clients.pi.listImportableSessions).toBe("function");
    expect(typeof clients.pi.importSession).toBe("function");
    expect(clients.codex.provider).toBe("codex");
    expect(clients.codex.capabilities.supportsSessionListing).toBe(true);
  });
});
