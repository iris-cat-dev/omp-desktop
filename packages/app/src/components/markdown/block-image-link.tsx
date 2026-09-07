import React, { useCallback, type ReactNode } from "react";
import { Pressable, type ViewStyle } from "react-native";
import { openExternalUrl } from "@/utils/open-external-url";

const BLOCK_IMAGE_LINK_STYLE: ViewStyle = {
  alignSelf: "flex-start",
  flexGrow: 0,
  flexShrink: 0,
  marginRight: 4,
};

export function MarkdownBlockImageLink({
  href,
  onLinkPress,
  children,
}: {
  href: string;
  onLinkPress?: (url: string) => boolean;
  children: ReactNode;
}) {
  const handlePress = useCallback(() => {
    if (!href) return;
    if (onLinkPress?.(href) === false) return;
    void openExternalUrl(href);
  }, [href, onLinkPress]);

  return (
    <Pressable style={BLOCK_IMAGE_LINK_STYLE} onPress={handlePress} accessibilityRole="link">
      {children}
    </Pressable>
  );
}
