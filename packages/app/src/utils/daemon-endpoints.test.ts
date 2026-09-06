import { describe, expect, it } from "vitest";
import type { ConnectionOffer } from "@omp-desktop/protocol/connection-offer";
import { applyConfiguredRelayToOffer } from "./daemon-endpoints";

const offer: ConnectionOffer = {
  v: 2,
  serverId: "srv_pairing",
  daemonPublicKeyB64: "pk_pairing",
  relay: {
    endpoint: "advertised.example.com:443",
    useTls: true,
  },
};

describe("applyConfiguredRelayToOffer", () => {
  it("uses the application relay address instead of the pairing link address", () => {
    expect(applyConfiguredRelayToOffer(offer, "ws://self-hosted.example.com:4000")).toEqual({
      ...offer,
      relay: {
        endpoint: "self-hosted.example.com:4000",
        useTls: false,
      },
    });
  });

  it("uses the pairing link address when no application override is configured", () => {
    expect(applyConfiguredRelayToOffer(offer, "")).toBe(offer);
  });
});
