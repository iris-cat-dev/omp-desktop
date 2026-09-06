import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { deriveSharedKey, generateKeyPair, importPublicKey } from "@omp-desktop/relay";
import { exportSecretKey } from "@omp-desktop/relay/e2ee";

import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { PRIVATE_FILE_MODE } from "./private-files.js";

const MODE_MASK = 0o777;
const PERMISSIVE_FILE_MODE = 0o644;

function createTempHome(): string {
  return mkdtempSync(path.join(tmpdir(), "paseo-keypair-"));
}

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("daemon keypair file permissions", () => {
  test("creates daemon-keypair.json with private permissions", async () => {
    const home = createTempHome();
    try {
      await loadOrCreateDaemonKeyPair(home);

      expect(modeOf(path.join(home, "daemon-keypair.json"))).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("repairs existing daemon-keypair.json permissions when loading", async () => {
    const home = createTempHome();
    const keypairPath = path.join(home, "daemon-keypair.json");
    try {
      const created = await loadOrCreateDaemonKeyPair(home);
      chmodSync(keypairPath, PERMISSIVE_FILE_MODE);

      const loaded = await loadOrCreateDaemonKeyPair(home);

      expect(loaded.publicKeyB64).toBe(created.publicKeyB64);
      expect(modeOf(keypairPath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("replaces the public-only identity with a persistent working E2EE keypair", async () => {
  const home = createTempHome();
  try {
    const fakePublicKey = Buffer.alloc(32, 7).toString("base64");
    writeFileSync(
      path.join(home, "daemon-identity.json"),
      JSON.stringify({ v: 1, publicKeyB64: fakePublicKey }),
    );
    const created = await loadOrCreateDaemonKeyPair(home);
    const loaded = await loadOrCreateDaemonKeyPair(home);
    const peer = generateKeyPair();

    expect(loaded.publicKeyB64).toBe(created.publicKeyB64);
    expect(loaded.publicKeyB64).not.toBe(fakePublicKey);
    expect(deriveSharedKey(loaded.keyPair.secretKey, peer.publicKey)).toEqual(
      deriveSharedKey(peer.secretKey, importPublicKey(loaded.publicKeyB64)),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("repairs a mismatched stored public key without rotating its secret", async () => {
  const home = createTempHome();
  const keypairPath = path.join(home, "daemon-keypair.json");
  try {
    const original = generateKeyPair();
    const secretKeyB64 = exportSecretKey(original.secretKey);
    writeFileSync(
      keypairPath,
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.alloc(32, 7).toString("base64"),
        secretKeyB64,
      }),
    );
    const repaired = await loadOrCreateDaemonKeyPair(home);
    const peer = generateKeyPair();
    expect(repaired.keyPair.secretKey).toEqual(original.secretKey);
    expect(repaired.publicKeyB64).toBe(Buffer.from(original.publicKey).toString("base64"));
    expect(deriveSharedKey(repaired.keyPair.secretKey, peer.publicKey)).toEqual(
      deriveSharedKey(peer.secretKey, importPublicKey(repaired.publicKeyB64)),
    );
    expect(JSON.parse(readFileSync(keypairPath, "utf8"))).toEqual({
      v: 2,
      publicKeyB64: repaired.publicKeyB64,
      secretKeyB64,
    });
    expect((await loadOrCreateDaemonKeyPair(home)).publicKeyB64).toBe(repaired.publicKeyB64);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
