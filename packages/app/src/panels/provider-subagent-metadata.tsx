import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export interface ProviderSubagentMetadataProps {
  model: string | null | undefined;
  subtitle: string | null | undefined;
}

export function ProviderSubagentMetadata({ model, subtitle }: ProviderSubagentMetadataProps) {
  const metadata = [model?.trim(), subtitle?.trim()]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  if (!metadata) return null;

  return (
    <View style={styles.header}>
      <Text style={styles.text} numberOfLines={1} testID="provider-subagent-pane-subtitle">
        {metadata}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
