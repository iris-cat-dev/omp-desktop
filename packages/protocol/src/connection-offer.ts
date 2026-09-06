import { z } from "zod";

const RELAY_HOST_LABEL_PATTERN = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/iu;

function isValidRelayHostname(hostname: string): boolean {
  if (hostname.startsWith("[")) return true;
  const normalized = hostname.replace(/\.$/u, "");
  return (
    normalized.length <= 253 &&
    normalized.split(".").every((label) => RELAY_HOST_LABEL_PATTERN.test(label))
  );
}

/** Parse a relay authority or WebSocket URL without accepting non-relay URL components. */
export function parseRelayAddress(
  input: string,
  fallbackUseTls: boolean,
): { endpoint: string; useTls: boolean } {
  const address = input.trim();
  const invalid = () =>
    new Error(
      "Invalid relay address: use ws://host[:port] or wss://host[:port], optionally ending in /ws",
    );
  if (!address || /[\s\\?#@]/u.test(address)) throw invalid();
  const scheme = /^([a-z][a-z\d+.-]*):\/\//iu.exec(address);
  if (scheme && !/^wss?$/iu.test(scheme[1])) throw invalid();
  const authorityAndPath = scheme ? address.slice(scheme[0].length) : address;
  const match = /^(\[[^\]]+\]|[^:/]+)(?::(\d+))?(\/.*)?$/u.exec(authorityAndPath);
  if (!match || (match[3] && match[3] !== "/" && match[3] !== "/ws")) throw invalid();
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) throw invalid();
  const useTls = scheme ? scheme[1].toLowerCase() === "wss" : fallbackUseTls;
  let url: URL;
  try {
    url = new URL(`${useTls ? "wss" : "ws"}://${authorityAndPath}`);
  } catch {
    throw invalid();
  }
  if (!isValidRelayHostname(url.hostname)) throw invalid();
  return { endpoint: `${url.hostname}:${url.port || (useTls ? "443" : "80")}`, useTls };
}

/**
 * Relay-only pairing offer.
 *
 * `serverId` is a stable daemon identifier scoped to `PASEO_HOME`, and is also
 * used as the relay session identifier.
 */
export const ConnectionOfferV2Schema = z.object({
  v: z.literal(2),
  serverId: z.string().min(1),
  daemonPublicKeyB64: z.string().min(1),
  relay: z.object({
    endpoint: z.string().min(1),
    useTls: z.boolean().optional(),
  }),
});

export type ConnectionOfferV2 = z.infer<typeof ConnectionOfferV2Schema>;

export const ConnectionOfferSchema = ConnectionOfferV2Schema;
export type ConnectionOffer = ConnectionOfferV2;

function decodeBase64UrlToUtf8(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function decodeOfferFragmentPayload(encoded: string): unknown {
  const json = decodeBase64UrlToUtf8(encoded);
  return JSON.parse(json) as unknown;
}

const OFFER_FRAGMENT_PREFIX = "#offer=";

function extractOfferFragmentEncoded(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1) return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  return encoded.length > 0 ? encoded : null;
}

/**
 * Parse a pairing-offer URL of the form `https://app.paseo.sh/#offer=<base64url>`.
 *
 * Returns `null` if the input has no `#offer=` fragment. Throws if the fragment
 * exists but the payload is malformed or fails schema validation.
 */
export function parseConnectionOfferFromUrl(input: string): ConnectionOffer | null {
  const encoded = extractOfferFragmentEncoded(input);
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return ConnectionOfferSchema.parse(payload);
}
