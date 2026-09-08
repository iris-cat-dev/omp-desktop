import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { buildSubagentMetadata } from "@/subagents/track-presentation";

export interface ProviderSubagentMetadataProps {
  model: string | null | undefined;
  subtitle: string | null | undefined;
}

export function ProviderSubagentMetadata({ model, subtitle }: ProviderSubagentMetadataProps) {
  const { t } = useTranslation();
  const metadata = buildSubagentMetadata(t, model, subtitle);

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
