import React, { useCallback, useMemo, useState } from "react";
import {
  Image,
  View,
  type ImageStyle,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { MarkdownInlineImagePart } from "./html-ish";
import { resolveBlockImageSize } from "./inline-image-size";
import { useNaturalImageDimensions } from "./natural-image-dimensions";

export { useNaturalImageDimensions } from "./natural-image-dimensions";

const BLOCK_IMAGE_MEASURE_STYLE: ViewStyle = {
  width: "100%",
  alignItems: "flex-start",
};

export function MarkdownBlockImage({
  src,
  alt,
  style,
}: {
  src: string;
  alt: string;
  style: StyleProp<ImageStyle>;
}) {
  const part = useMemo<MarkdownInlineImagePart>(
    () => ({ kind: "inlineImage", src, alt }),
    [alt, src],
  );
  const { natural } = useNaturalImageDimensions(part);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setAvailableWidth((current) => (current === width ? current : width));
  }, []);
  const imageSize = useMemo(
    () => resolveBlockImageSize({ natural, availableWidth }),
    [availableWidth, natural],
  );
  const source = useMemo(() => ({ uri: src }), [src]);

  return (
    <View style={BLOCK_IMAGE_MEASURE_STYLE} onLayout={handleLayout}>
      <Image
        source={source}
        style={[style, imageSize]}
        resizeMode="contain"
        accessibilityLabel={alt || undefined}
      />
    </View>
  );
}
