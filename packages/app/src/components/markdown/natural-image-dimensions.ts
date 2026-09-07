import { useEffect, useState } from "react";
import { Image } from "react-native";
import type { MarkdownInlineImagePart } from "./html-ish";
import type { InlineImageDimensions } from "./inline-image-size";

export function useNaturalImageDimensions(part: MarkdownInlineImagePart): {
  natural: InlineImageDimensions | null;
  failed: boolean;
  setFailed: (failed: boolean) => void;
} {
  const [natural, setNatural] = useState<InlineImageDimensions | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (part.width && part.height) return;

    let cancelled = false;
    Image.getSize(
      part.src,
      (width, height) => {
        if (!cancelled) setNatural({ width, height });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [part.height, part.src, part.width]);

  return { natural, failed, setFailed };
}
