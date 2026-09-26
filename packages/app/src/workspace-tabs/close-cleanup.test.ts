import { describe, expect, it } from "vitest";
import { resolveClosedTabWorkspaceArchives } from "@/workspace-tabs/close-cleanup";

describe("closed tab workspace cleanup", () => {
  it("archives a cross-workspace draft without archiving its non-empty tab host", () => {
    expect(
      resolveClosedTabWorkspaceArchives({
        routeWorkspaceId: "workspace-host",
        closingTarget: {
          kind: "draft",
          draftId: "draft-1",
          workspaceId: "workspace-draft",
        },
        routeWorkspaceEmpty: false,
      }),
    ).toEqual(["workspace-draft"]);
  });

  it("archives both workspace records when the hosted draft is the last tab", () => {
    expect(
      resolveClosedTabWorkspaceArchives({
        routeWorkspaceId: "workspace-host",
        closingTarget: {
          kind: "draft",
          draftId: "draft-1",
          workspaceId: "workspace-draft",
        },
        routeWorkspaceEmpty: true,
      }),
    ).toEqual(["workspace-draft", "workspace-host"]);
  });

  it("keeps legacy same-workspace cleanup behavior", () => {
    expect(
      resolveClosedTabWorkspaceArchives({
        routeWorkspaceId: "workspace-host",
        closingTarget: { kind: "draft", draftId: "legacy-draft" },
        routeWorkspaceEmpty: true,
      }),
    ).toEqual(["workspace-host"]);
  });
});
