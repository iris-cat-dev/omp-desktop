import { describe, expect, it } from "vitest";

import {
  ConnectionOfferSchema,
  decodeOfferFragmentPayload,
  parseConnectionOfferFromUrl,
  parseRelayAddress,
} from "./connection-offer.js";

function encodeBase64UrlNoPadUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("connection offer", () => {
  it("decodes base64url JSON payloads", () => {
    const payload = {
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.paseo.sh:443" },
    };

    expect(decodeOfferFragmentPayload(encodeBase64UrlNoPadUtf8(JSON.stringify(payload)))).toEqual(
      payload,
    );
  });

  it("parses connection offers from QR-style URLs", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.paseo.sh:443" },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.paseo.sh/#offer=${encoded}`)).toEqual(offer);
  });

  it("leaves relay TLS unset when absent", () => {
    expect(
      ConnectionOfferSchema.parse({
        v: 2,
        serverId: "server-123",
        daemonPublicKeyB64: "pubkey",
        relay: { endpoint: "relay.example.com:80" },
      }),
    ).toEqual({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:80" },
    });
  });

  it("round-trips relay TLS in offers without rejecting extra relay fields", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true, extra: "future" },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.paseo.sh/#offer=${encoded}`)).toEqual({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true },
    });
  });

  it("returns null when the URL has no offer fragment", () => {
    expect(parseConnectionOfferFromUrl("https://app.paseo.sh/pair")).toBeNull();
  });
});

describe("relay addresses", () => {
  it.each([
    [" ws://LOCALHOST:4000/ws ", true, { endpoint: "localhost:4000", useTls: false }],
    ["wss://Relay.Example.test/", false, { endpoint: "relay.example.test:443", useTls: true }],
    ["relay.example.test:8443", true, { endpoint: "relay.example.test:8443", useTls: true }],
    ["[2001:0db8::1]:4000", false, { endpoint: "[2001:db8::1]:4000", useTls: false }],
    ["wss://[::1]:443/ws", false, { endpoint: "[::1]:443", useTls: true }],
    ["ws://localhost/ws", true, { endpoint: "localhost:80", useTls: false }],
    ["relay.example.test", true, { endpoint: "relay.example.test:443", useTls: true }],
  ] as const)("normalizes %s", (input, fallback, expected) => {
    expect(parseRelayAddress(input, fallback)).toEqual(expected);
  });

  it.each([
    "",
    "  ",
    "https://relay.example.test",
    "ftp://relay.example.test",
    "ws://user:password@relay.example.test",
    "ws://relay.example.test?token=secret",
    "ws://relay.example.test/#offer=x",
    "ws://relay.example.test/other",
    "ws://relay.example.test/a/../ws",
    "ws://relay.example.test:",
    "relay.example.test:0",
    "relay.example.test:65536",
    "relay.example.test:nope",
    "::1:4000",
    "[invalid]:4000",
    "bad host:4000",
    "-bad.example:4000",
    "ws://relay.example.test\\other",
    "ws:///relay.example.test",
  ])("rejects unsafe or malformed address %j", (input) => {
    expect(() => parseRelayAddress(input, false)).toThrow();
  });
});
