// Imported by the app entry before Expo Router can normalize away the fragment.
export const initialPairingLink = {
  url:
    typeof window !== "undefined" && window.location.hash.startsWith("#offer=")
      ? window.location.href
      : null,
};
