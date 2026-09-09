import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Brain } from "lucide-react-native";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  icon: null as unknown,
  secondaryLabel: undefined as string | undefined,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({ scroll: {}, content: {} }) },
}));
vi.mock("@/components/message", () => ({
  ExpandableBadge: ({ icon, secondaryLabel }: { icon: unknown; secondaryLabel?: string }) => {
    captured.icon = icon;
    captured.secondaryLabel = secondaryLabel;
    return null;
  },
}));

import { AgentActivityGroupView } from "./activity-group-view";
import type { AgentActivityGroup } from "./activity-grouping";
const timestamp = new Date(0);
const group: AgentActivityGroup = {
  id: "activity-1",
  items: ["thought-1", "thought-2", "thought-3"].map((id) => ({
    kind: "thought",
    id,
    turnId: "turn-1",
    text: id,
    timestamp,
    status: "ready",
  })),
  isLoading: false,
};
const handleExpandedChange = () => undefined;

describe("AgentActivityGroupView", () => {
  it("uses the compact brain glyph instead of the overlapping circuit glyph", () => {
    renderToStaticMarkup(
      <AgentActivityGroupView
        group={group}
        expanded={false}
        isLastInSequence={false}
        onExpandedChange={handleExpandedChange}
      >
        {null}
      </AgentActivityGroupView>,
    );

    expect(captured.icon).toBe(Brain);
  });

  it("shows the number of hidden activity items only while collapsed", () => {
    renderToStaticMarkup(
      <AgentActivityGroupView
        group={group}
        expanded={false}
        isLastInSequence={false}
        onExpandedChange={handleExpandedChange}
      >
        {null}
      </AgentActivityGroupView>,
    );
    expect(captured.secondaryLabel).toBe("3");

    renderToStaticMarkup(
      <AgentActivityGroupView
        group={group}
        expanded
        isLastInSequence={false}
        onExpandedChange={handleExpandedChange}
      >
        {null}
      </AgentActivityGroupView>,
    );
    expect(captured.secondaryLabel).toBeUndefined();
  });
});
