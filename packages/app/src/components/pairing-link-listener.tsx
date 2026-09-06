import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { PairLinkModal } from "@/components/pair-link-modal";
import { useHostRegistryLoaded } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { buildHostRootRoute } from "@/utils/host-routes";
import { initialPairingLink } from "@/utils/initial-pairing-link";

export function PairingLinkListener() {
  const router = useRouter();
  const registryLoaded = useHostRegistryLoaded();
  const [offerUrl, setOfferUrl] = useState<string | null>(() => initialPairingLink.url);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      if (window.location.hash.startsWith("#offer=")) setOfferUrl(window.location.href);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleClose = useCallback(() => {
    initialPairingLink.url = null;
    setOfferUrl(null);
    if (typeof window !== "undefined" && window.location.hash.startsWith("#offer=")) {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);
  const handleSaved = useCallback(
    (profile: HostProfile) => {
      router.replace(buildHostRootRoute(profile.serverId));
    },
    [router],
  );

  if (!registryLoaded || !offerUrl) return null;
  return (
    <PairLinkModal
      key={offerUrl}
      visible
      initialUrl={offerUrl}
      autoPair
      onClose={handleClose}
      onSaved={handleSaved}
    />
  );
}
