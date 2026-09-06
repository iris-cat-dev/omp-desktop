import { describe, expect, it } from "vitest";
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "./crypto.js";

describe("relay encryption trust boundary", () => {
  it("exchanges text and binary data without accepting tampering or another peer", () => {
    const daemon = generateKeyPair();
    const client = generateKeyPair();
    const other = generateKeyPair();
    const senderKey = deriveSharedKey(
      client.secretKey,
      importPublicKey(exportPublicKey(daemon.publicKey)),
    );
    const receiverKey = deriveSharedKey(daemon.secretKey, client.publicKey);
    const wrongKey = deriveSharedKey(other.secretKey, daemon.publicKey);
    const text = "remote terminal: 你好\n";
    const ciphertext = encrypt(senderKey, text);
    expect(new TextDecoder().decode(decrypt(receiverKey, ciphertext))).toBe(text);
    expect(() => decrypt(wrongKey, ciphertext)).toThrow();
    const changed = new Uint8Array(ciphertext.slice(0));
    changed[changed.length - 1] ^= 1;
    expect(() => decrypt(receiverKey, changed.buffer)).toThrow();
    const binary = new Uint8Array([0, 255, 128, 10, 65]);
    expect(new Uint8Array(decrypt(senderKey, encrypt(receiverKey, binary.buffer)))).toEqual(binary);
  });

  it("rejects low-order X25519 peers instead of deriving a predictable session key", () => {
    const { secretKey } = generateKeyPair();
    const lowOrderKeys = [
      "00".repeat(32),
      `01${"00".repeat(31)}`,
      "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800",
      "5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157",
      `ec${"ff".repeat(30)}7f`,
      `ed${"ff".repeat(30)}7f`,
      `ee${"ff".repeat(30)}7f`,
    ];
    for (const encoded of lowOrderKeys) {
      const publicKey = Uint8Array.from(Buffer.from(encoded, "hex"));
      expect(() => deriveSharedKey(secretKey, publicKey)).toThrow();
    }
  });

  it("rejects noncanonical and wrong-length pairing keys", () => {
    for (const encoded of [
      "!".repeat(43) + "=",
      `${"A".repeat(42)}B=`,
      Buffer.alloc(31).toString("base64"),
      Buffer.alloc(33).toString("base64"),
    ]) {
      expect(() => importPublicKey(encoded)).toThrow();
    }
  });
});
