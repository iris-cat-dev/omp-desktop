import { describe, expect, it, vi } from "vitest";

import {
  beginWindowDrag,
  applyMacWindowControlsUpdate,
  applyWindowControlsOverlayUpdate,
  createWindowControlsOverlayState,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  getMainWindowChromeOptions,
  getTitleBarOverlayOptions,
  moveWindowDrag,
  readBadgeCount,
  readWindowControlsOverlayUpdate,
  readWindowTheme,
  readWindowDragPoint,
  resolveRuntimeTitleBarOverlayOptions,
  resolveWindowBounds,
  setupWindowResizeEvents,
} from "./window-manager";

function createWindowListenerRecorder(listeners: Map<string, () => void>) {
  return (event: string, listener: () => void) => {
    listeners.set(event, listener);
  };
}

function createAsyncUnmaximizeTarget() {
  let maximized = true;
  let unmaximizeListener: (() => void) | undefined;
  const once = vi.fn((_event: "unmaximize", listener: () => void) => {
    unmaximizeListener = listener;
  });
  const removeListener = vi.fn();
  const unmaximize = vi.fn(() => {
    queueMicrotask(() => {
      maximized = false;
      unmaximizeListener?.();
    });
  });
  const setPosition = vi.fn();
  const getBounds = vi
    .fn()
    .mockReturnValueOnce({ x: 0, y: 38, width: 1646, height: 1079 })
    .mockReturnValue({ x: 264, y: 103, width: 1200, height: 800 });

  return {
    win: {
      isMaximized: () => maximized,
      unmaximize,
      getBounds,
      setPosition,
      once,
      removeListener,
    },
    unmaximize,
    removeListener,
    setPosition,
  };
}

describe("window-manager", () => {
  describe("readBadgeCount", () => {
    it("returns valid non-negative integers", () => {
      expect(readBadgeCount(0)).toBe(0);
      expect(readBadgeCount(3)).toBe(3);
    });

    it("falls back to zero for invalid payloads", () => {
      expect(readBadgeCount(undefined)).toBe(0);
      expect(readBadgeCount(null)).toBe(0);
      expect(readBadgeCount(Number.NaN)).toBe(0);
      expect(readBadgeCount(Number.POSITIVE_INFINITY)).toBe(0);
      expect(readBadgeCount(-1)).toBe(0);
      expect(readBadgeCount(1.5)).toBe(0);
      expect(readBadgeCount("2")).toBe(0);
      expect(readBadgeCount({ count: 2 })).toBe(0);
    });
  });

  describe("readWindowTheme", () => {
    it("accepts supported title bar themes", () => {
      expect(readWindowTheme("light")).toBe("light");
      expect(readWindowTheme("dark")).toBe("dark");
    });

    it("rejects invalid title bar themes", () => {
      expect(readWindowTheme(undefined)).toBeNull();
      expect(readWindowTheme("auto")).toBeNull();
      expect(readWindowTheme("system")).toBeNull();
    });
  });

  describe("getTitleBarOverlayOptions", () => {
    it("returns light title bar overlay colors", () => {
      expect(getTitleBarOverlayOptions("light")).toEqual({
        color: "#ffffff",
        symbolColor: "#09090b",
        height: 29,
      });
    });

    it("returns dark title bar overlay colors", () => {
      expect(getTitleBarOverlayOptions("dark")).toEqual({
        color: "#181B1A",
        symbolColor: "#e4e4e7",
        height: 29,
      });
    });
  });

  describe("readWindowControlsOverlayUpdate", () => {
    it("accepts partial runtime overlay updates", () => {
      expect(
        readWindowControlsOverlayUpdate({
          height: 48,
          backgroundColor: "#181B1A",
          trafficLightOffsetY: -5,
        }),
      ).toEqual({
        height: 48,
        backgroundColor: "#181B1A",
        trafficLightOffsetY: -5,
      });
    });

    it("rejects empty and invalid payloads", () => {
      expect(readWindowControlsOverlayUpdate(undefined)).toBeNull();
      expect(readWindowControlsOverlayUpdate({})).toBeNull();
      expect(readWindowControlsOverlayUpdate({ height: 0 })).toBeNull();
      expect(readWindowControlsOverlayUpdate({ backgroundColor: 12 })).toBeNull();
      expect(readWindowControlsOverlayUpdate({ trafficLightOffsetY: -11 })).toBeNull();
    });

    it("preserves fractional traffic-light offsets", () => {
      expect(readWindowControlsOverlayUpdate({ trafficLightOffsetY: 1.5 })).toEqual({
        trafficLightOffsetY: 1.5,
      });
    });
  });

  describe("resolveRuntimeTitleBarOverlayOptions", () => {
    it("applies the VS Code height minus border adjustment", () => {
      expect(
        resolveRuntimeTitleBarOverlayOptions({
          height: 48,
          backgroundColor: "#ffffff",
          foregroundColor: "#09090b",
        }),
      ).toEqual({
        color: "#ffffff",
        symbolColor: "#09090b",
        height: 47,
      });
    });
  });

  describe("applyWindowControlsOverlayUpdate", () => {
    it("merges cached colors with later runtime height updates", () => {
      const setTitleBarOverlay = vi.fn();
      let state = createWindowControlsOverlayState("dark");

      state = applyWindowControlsOverlayUpdate({
        win: { setTitleBarOverlay },
        current: state,
        update: {
          backgroundColor: "#181B1A",
          foregroundColor: "#e4e4e7",
        },
      });

      state = applyWindowControlsOverlayUpdate({
        win: { setTitleBarOverlay },
        current: state,
        update: { height: 48 },
      });

      expect(state).toEqual({
        height: 48,
        backgroundColor: "#181B1A",
        foregroundColor: "#e4e4e7",
      });
      expect(setTitleBarOverlay).toHaveBeenNthCalledWith(1, {
        color: "#181B1A",
        symbolColor: "#e4e4e7",
        height: 28,
      });
      expect(setTitleBarOverlay).toHaveBeenNthCalledWith(2, {
        color: "#181B1A",
        symbolColor: "#e4e4e7",
        height: 47,
      });
    });
  });

  describe("applyMacWindowControlsUpdate", () => {
    it("uses the focus and normal traffic-light positions", () => {
      const setWindowButtonPosition = vi.fn();

      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: -5 },
      });
      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: 0.5 },
      });

      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(1, { x: 16, y: 9 });
      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(2, { x: 16, y: 14.5 });
    });
  });

  describe("getMainWindowChromeOptions", () => {
    it("uses frameless hidden title bars with overlay on windows", () => {
      expect(
        getMainWindowChromeOptions({
          platform: "win32",
          theme: "dark",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        frame: false,
        autoHideMenuBar: true,
        titleBarOverlay: {
          color: "#181B1A",
          symbolColor: "#e4e4e7",
          height: 29,
        },
      });
    });

    it("uses frameless hidden title bars with overlay on linux", () => {
      expect(
        getMainWindowChromeOptions({
          platform: "linux",
          theme: "light",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        frame: false,
        autoHideMenuBar: true,
        titleBarOverlay: {
          color: "#ffffff",
          symbolColor: "#09090b",
          height: 29,
        },
      });
    });

    it("keeps the mac traffic-light path separate", () => {
      expect(
        getMainWindowChromeOptions({
          platform: "darwin",
          theme: "dark",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        titleBarOverlay: true,
        trafficLightPosition: { x: 16, y: 14 },
      });
    });
  });

  describe("resolveWindowBounds", () => {
    it("falls back to the default size when no state is saved", () => {
      expect(resolveWindowBounds(null)).toEqual({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
      });
    });

    it("restores the full size and position", () => {
      expect(
        resolveWindowBounds({ x: 120, y: 80, width: 1024, height: 720, isMaximized: false }),
      ).toEqual({ width: 1024, height: 720, x: 120, y: 80 });
    });

    it("omits the position when only the size was persisted", () => {
      expect(resolveWindowBounds({ width: 1024, height: 720, isMaximized: true })).toEqual({
        width: 1024,
        height: 720,
      });
    });
  });
  describe("window state notifications", () => {
    it("notifies the renderer for maximize changes even without a resize event", () => {
      const listeners = new Map<string, () => void>();
      const send = vi.fn();
      const win = {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send,
        },
        on: vi.fn(createWindowListenerRecorder(listeners)),
      };

      setupWindowResizeEvents(win as unknown as Parameters<typeof setupWindowResizeEvents>[0]);

      expect([...listeners.keys()]).toEqual([
        "resize",
        "maximize",
        "unmaximize",
        "enter-full-screen",
        "leave-full-screen",
      ]);

      listeners.get("maximize")?.();
      listeners.get("unmaximize")?.();

      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenNthCalledWith(1, "paseo:window:resized", {});
      expect(send).toHaveBeenNthCalledWith(2, "paseo:window:resized", {});
    });
  });

  describe("manual titlebar drag", () => {
    it("validates and rounds renderer screen coordinates", () => {
      expect(readWindowDragPoint({ screenX: 120.4, screenY: 80.6 })).toEqual({
        x: 120,
        y: 81,
      });
      expect(readWindowDragPoint({ screenX: Number.NaN, screenY: 80 })).toBeNull();
      expect(readWindowDragPoint({ screenX: "120", screenY: 80 })).toBeNull();
    });

    it("waits for an asynchronous unmaximize before reading restored bounds", async () => {
      const { win, unmaximize, removeListener, setPosition } = createAsyncUnmaximizeTarget();

      const state = await beginWindowDrag(win, { x: 900, y: 92 });

      expect(state).toEqual({ offsetX: 656, offsetY: 54 });
      expect(unmaximize).toHaveBeenCalledOnce();
      expect(removeListener).toHaveBeenCalledWith("unmaximize", expect.any(Function));
      expect(setPosition).toHaveBeenNthCalledWith(1, 244, 38, false);

      moveWindowDrag(win, state, { x: 1000, y: 170 });
      expect(setPosition).toHaveBeenNthCalledWith(2, 344, 116, false);
    });

    it("keeps a normal window's current pointer offset", async () => {
      const setPosition = vi.fn();
      const win = {
        isMaximized: () => false,
        unmaximize: vi.fn(),
        getBounds: () => ({ x: 300, y: 140, width: 1200, height: 800 }),
        setPosition,
        once: vi.fn(),
        removeListener: vi.fn(),
      };

      const state = await beginWindowDrag(win, { x: 900, y: 194 });

      expect(state).toEqual({ offsetX: 600, offsetY: 54 });
      expect(win.unmaximize).not.toHaveBeenCalled();
      expect(setPosition).not.toHaveBeenCalled();
    });
  });
});
