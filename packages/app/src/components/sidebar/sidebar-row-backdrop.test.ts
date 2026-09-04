import { describe, expect, it } from "vitest";
import { getSidebarRowBackdrop } from "./sidebar-row-backdrop";

describe("getSidebarRowBackdrop", () => {
  it("uses the same selected surface as the focused top tab", () => {
    expect(getSidebarRowBackdrop({ selected: true, isHovered: true })).toBe("surface2");
  });

  it("uses the hover surface for an unselected hovered row", () => {
    expect(getSidebarRowBackdrop({ isHovered: true })).toBe("surfaceSidebarHover");
  });
});
