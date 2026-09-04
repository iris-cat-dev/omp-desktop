/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScrollView } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TITLEBAR_DRAG_REGION_DATASET, TitlebarDragRegion } from "./titlebar-drag-region";

const useIsDesktopWindowMaximized = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/utils/desktop-window", () => ({
  useIsDesktopWindowMaximized,
}));

const beginWindowDrag = vi.fn(() => Promise.resolve());
const moveWindowDrag = vi.fn();
const endWindowDrag = vi.fn();
const toggleMaximize = vi.fn(() => Promise.resolve());

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useIsDesktopWindowMaximized.mockReturnValue(false);
  beginWindowDrag.mockClear();
  moveWindowDrag.mockClear();
  endWindowDrag.mockClear();
  toggleMaximize.mockClear();
  Object.defineProperty(window, "paseoDesktop", {
    configurable: true,
    value: {
      platform: "win32",
      window: {
        getCurrentWindow: () => ({
          beginWindowDrag,
          moveWindowDrag,
          endWindowDrag,
          toggleMaximize,
        }),
      },
    },
  });
});

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "paseoDesktop");
});

describe("TITLEBAR_DRAG_REGION_DATASET", () => {
  it("renders the exact hyphenated attribute consumed by the titlebar CSS", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() =>
      root.render(
        <ScrollView
          horizontal
          dataSet={TITLEBAR_DRAG_REGION_DATASET}
          testID="titlebar-scroll-surface"
        />,
      ),
    );

    const surface = container.querySelector('[data-testid="titlebar-scroll-surface"]');
    if (!(surface instanceof HTMLElement)) {
      throw new Error("Titlebar scroll surface did not render");
    }

    expect(surface.getAttribute("data-window-drag-region")).toBe("native");
    expect(surface.hasAttribute("data-windowdragregion")).toBe(false);
  });
});

describe("TitlebarDragRegion", () => {
  function renderRegion(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => root.render(<TitlebarDragRegion />));

    const region = container.querySelector("[data-window-drag-region]");
    if (!(region instanceof HTMLElement)) {
      throw new Error("Titlebar drag region did not render");
    }
    return region;
  }

  it("keeps the native region and top resizer for a normal window", () => {
    const region = renderRegion();

    expect(region.getAttribute("data-window-drag-region")).toBe("native");
    expect(region.parentElement?.children).toHaveLength(2);
  });

  it("starts a maximized drag only after intentional pointer movement", async () => {
    useIsDesktopWindowMaximized.mockReturnValue(true);
    const region = renderRegion();

    expect(region.getAttribute("data-window-drag-region")).toBe("manual");
    expect(region.parentElement?.children).toHaveLength(1);

    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      screenX: 480,
      screenY: 12,
    });
    Object.defineProperty(pointerDown, "pointerId", { value: 7 });
    const pointerMove = new MouseEvent("pointermove", {
      bubbles: true,
      button: 0,
      buttons: 1,
      screenX: 486,
      screenY: 12,
    });
    Object.defineProperty(pointerMove, "pointerId", { value: 7 });

    await act(async () => {
      region.dispatchEvent(pointerDown);
      expect(beginWindowDrag).not.toHaveBeenCalled();
      region.dispatchEvent(pointerMove);
      await Promise.resolve();
    });

    expect(beginWindowDrag).toHaveBeenCalledWith({ screenX: 480, screenY: 12 });
  });

  it("toggles a maximized window on a titlebar double click", async () => {
    useIsDesktopWindowMaximized.mockReturnValue(true);
    const region = renderRegion();
    const firstPointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      screenX: 480,
      screenY: 12,
    });
    Object.defineProperties(firstPointerDown, {
      pointerId: { value: 8 },
      timeStamp: { value: 1_000 },
    });
    const firstPointerUp = new MouseEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      screenX: 480,
      screenY: 12,
    });
    Object.defineProperties(firstPointerUp, {
      pointerId: { value: 8 },
      timeStamp: { value: 1_050 },
    });
    const secondPointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      screenX: 480,
      screenY: 12,
    });
    Object.defineProperties(secondPointerDown, {
      pointerId: { value: 9 },
      timeStamp: { value: 1_200 },
    });

    await act(async () => {
      region.dispatchEvent(firstPointerDown);
      region.dispatchEvent(firstPointerUp);
      region.dispatchEvent(secondPointerDown);
      await Promise.resolve();
    });

    expect(toggleMaximize).toHaveBeenCalledOnce();
    expect(beginWindowDrag).not.toHaveBeenCalled();
  });
});
