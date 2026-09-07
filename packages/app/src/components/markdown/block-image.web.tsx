import React from "react";
import { View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";

export { useNaturalImageDimensions } from "./natural-image-dimensions";

const WEB_IMAGE_FRAME_STYLE: ViewStyle = {
  alignSelf: "flex-start",
  maxWidth: "100%",
  overflow: "hidden",
};

const WEB_IMAGE_STYLE: React.CSSProperties = {
  display: "block",
  width: "auto",
  height: "auto",
  alignSelf: "flex-start",
  maxWidth: "100%",
  maxHeight: 480,
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
  return (
    <View style={[style as ViewStyle, WEB_IMAGE_FRAME_STYLE]}>
      <img src={src} alt={alt} style={WEB_IMAGE_STYLE} />
    </View>
  );
}
