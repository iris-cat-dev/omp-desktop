import React, { memo, useCallback, useRef, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { Brain } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge } from "@/components/message";
import type { AgentActivityGroup } from "./activity-grouping";

interface AgentActivityGroupViewProps {
  group: AgentActivityGroup;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}

const ACTIVITY_GROUP_MAX_HEIGHT = 480;

export const AgentActivityGroupView = memo(function AgentActivityGroupView({
  group,
  expanded,
  isLastInSequence,
  onExpandedChange,
  children,
}: AgentActivityGroupViewProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const toggle = useCallback(() => {
    onExpandedChange(group.id, !expanded);
  }, [expanded, group.id, onExpandedChange]);
  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);
  const renderDetails = useCallback(
    () => (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onContentSizeChange={scrollToLatest}
      >
        {children}
      </ScrollView>
    ),
    [children, scrollToLatest],
  );

  return (
    <ExpandableBadge
      testID="agent-activity-group"
      label={t("agentStream.activityGroup")}
      secondaryLabel={expanded ? undefined : String(group.items.length)}
      icon={Brain}
      isLoading={group.isLoading}
      isExpanded={expanded}
      isLastInSequence={isLastInSequence}
      onToggle={toggle}
      renderDetails={renderDetails}
      borderlessWhenExpanded
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  scroll: {
    maxHeight: ACTIVITY_GROUP_MAX_HEIGHT,
  },
  content: {
    paddingTop: theme.spacing[1],
    paddingHorizontal: 13,
  },
}));
