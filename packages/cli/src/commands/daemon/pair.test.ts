import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { getOrCreateServerId, parseConnectionOfferFromUrl } from "@omp-desktop/server";
import { runPairCommand } from "./pair.js";

vi.mock("../../utils/client.js", () => ({
  tryConnectToDaemon: async () => null,
}));

const homes: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

test("pair --home overrides an inherited OMP home and uses public relay TLS and app URL", async () => {
  const inheritedHome = await mkdtemp(path.join(os.tmpdir(), "omp-pair-inherited-"));
  const selectedHome = await mkdtemp(path.join(os.tmpdir(), "omp-pair-selected-"));
  homes.push(inheritedHome, selectedHome);
  vi.stubEnv("OMP_DESKTOP_HOME", inheritedHome);
  await writeFile(
    path.join(selectedHome, "config.json"),
    JSON.stringify({
      version: 1,
      daemon: {
        relay: {
          enabled: true,
          endpoint: "127.0.0.1:51185",
          publicEndpoint: "relay.example.test:443",
          useTls: false,
          publicUseTls: true,
        },
      },
      app: { baseUrl: "https://web.example.test/desktop" },
    }),
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  await runPairCommand(
    { home: selectedHome, json: true },
    {
      isInteractive: () => false,
      output: {
        columns: undefined,
        writeStdout: (message) => stdout.push(message),
        writeStderr: (message) => stderr.push(message),
        setExitCode: (code) => {
          throw new Error(`Unexpected exit ${code}`);
        },
        success: () => undefined,
      },
    },
  );

  expect(stderr).toEqual([]);
  const result = JSON.parse(stdout.join(""));
  expect(result.relayEnabled).toBe(true);
  expect(result.url).toMatch(/^https:\/\/web\.example\.test\/desktop\/#offer=/);
  const offer = parseConnectionOfferFromUrl(result.url);
  expect(offer).toMatchObject({
    v: 2,
    serverId: getOrCreateServerId(selectedHome),
    relay: { endpoint: "relay.example.test:443", useTls: true },
  });
  expect(Buffer.from(offer.daemonPublicKeyB64, "base64").byteLength).toBe(32);
});
