import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type pino from "pino";

import {
  generateKeyPair,
  exportPublicKey,
  exportSecretKey,
  importSecretKey,
  type KeyPair,
} from "@omp-desktop/relay/e2ee";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

const KeyPairSchema = z.object({
  v: z.literal(2),
  publicKeyB64: z.string().min(1),
  secretKeyB64: z.string().min(1),
});

type StoredKeyPair = z.infer<typeof KeyPairSchema>;

const KEYPAIR_FILENAME = "daemon-keypair.json";
// RFC 8410 PKCS#8 wrapper for a raw 32-byte X25519 private key.
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

function derivePublicKey(secretKey: Uint8Array): Uint8Array {
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, secretKey]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey).export({ format: "jwk" });
  if (!publicKey.x) throw new Error("X25519 public key is missing its coordinate");
  return Buffer.from(publicKey.x, "base64url");
}

export interface DaemonKeyPairBundle {
  keyPair: KeyPair;
  publicKeyB64: string;
}

export async function loadOrCreateDaemonKeyPair(
  paseoHome: string,
  logger?: pino.Logger,
): Promise<DaemonKeyPairBundle> {
  const log = logger?.child({ module: "daemon-keypair" });
  const filePath = path.join(paseoHome, KEYPAIR_FILENAME);

  if (existsSync(filePath)) {
    let loaded: DaemonKeyPairBundle | undefined;
    let needsRepair = false;
    try {
      ensurePrivateFile(filePath);
      const raw = readFileSync(filePath, "utf8");
      const parsed = KeyPairSchema.parse(JSON.parse(raw));

      const secretKey = importSecretKey(parsed.secretKeyB64);
      const publicKey = derivePublicKey(secretKey);
      const publicKeyB64 = exportPublicKey(publicKey);

      needsRepair = parsed.publicKeyB64 !== publicKeyB64;
      loaded = { keyPair: { publicKey, secretKey }, publicKeyB64 };
    } catch (error) {
      log?.warn({ err: error, filePath }, "Failed to load daemon keypair, regenerating");
    }
    if (loaded) {
      if (needsRepair) {
        // Persist outside the parse catch: an I/O failure must not rotate a valid secret.
        const repaired: StoredKeyPair = {
          v: 2,
          publicKeyB64: loaded.publicKeyB64,
          secretKeyB64: exportSecretKey(loaded.keyPair.secretKey),
        };
        writePrivateFileAtomicSync(filePath, JSON.stringify(repaired, null, 2) + "\n");
        log?.warn(
          { filePath },
          "Repaired daemon public key from its stored secret; pair devices again",
        );
      }
      log?.info({ filePath }, "Loaded daemon keypair");
      return loaded;
    }
  }

  const keyPair = generateKeyPair();
  const publicKeyB64 = exportPublicKey(keyPair.publicKey);
  const secretKeyB64 = exportSecretKey(keyPair.secretKey);

  const payload: StoredKeyPair = {
    v: 2,
    publicKeyB64,
    secretKeyB64,
  };

  writePrivateFileAtomicSync(filePath, JSON.stringify(payload, null, 2) + "\n");
  log?.info({ filePath }, "Saved daemon keypair");

  return { keyPair, publicKeyB64 };
}
