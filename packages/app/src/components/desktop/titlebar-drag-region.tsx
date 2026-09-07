import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as NativePointerEvent } from "react-native";
import { getDesktopWindow } from "@/desktop/electron/window";
import type { DesktopWindowBridge } from "@/desktop/host";
import {
  beginWindowDragActivity,
  endWindowDragActivity,
  type WindowDragActivityToken,
} from "@/desktop/window-drag-activity";
import { getIsElectronRuntime } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { useIsDesktopWindowMaximized } from "@/utils/desktop-window";

/**
 * Normal windows use Chromium's native app region so the operating system owns
 * every move. Maximized frameless Windows windows cannot restore from that
 * region, so only that first restore drag uses the manual IPC fallback.
 */

export const TITLEBAR_DRAG_REGION_DATASET = {
  "window-drag-region": "native",
} as const;
const TITLEBAR_MANUAL_DRAG_REGION_DATASET = {
  "window-drag-region": "manual",
} as const;

const TITLEBAR_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="slider"]',
  '[role="menuitem"]',
  "[tabindex]",
  '[contenteditable="true"]',
].join(",");

interface WindowDragPoint {
  screenX: number;
  screenY: number;
}

function releasePointerCapture(target: HTMLElement | null, pointerId: number): void {
  if (target?.hasPointerCapture?.(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
}

export function useTitlebarWindowDragSurface() {
  const isMaximized = useIsDesktopWindowMaximized();
  const [manualDragActive, setManualDragActive] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const activeBridgeRef = useRef<DesktopWindowBridge | null>(null);
  const activeActivityRef = useRef<WindowDragActivityToken | null>(null);
  const pendingMoveRef = useRef<WindowDragPoint | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const manualMode = isMaximized || manualDragActive;

  const resetActiveDrag = useCallback((pointerId: number, flushLastMove: boolean) => {
    if (activePointerRef.current !== pointerId) return;
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    const bridge = activeBridgeRef.current;
    const pendingMove = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (flushLastMove && pendingMove) {
      bridge?.moveWindowDrag?.(pendingMove);
    }
    bridge?.endWindowDrag?.();
    releasePointerCapture(activeTargetRef.current, pointerId);
    activePointerRef.current = null;
    activeTargetRef.current = null;
    activeBridgeRef.current = null;
    endWindowDragActivity(activeActivityRef.current);
    activeActivityRef.current = null;
    setManualDragActive(false);
  }, []);

  useEffect(
    () => () => {
      const pointerId = activePointerRef.current;
      if (pointerId !== null) resetActiveDrag(pointerId, false);
    },
    [resetActiveDrag],
  );

  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return;
    const handlePointerEnd = (event: PointerEvent) => {
      resetActiveDrag(event.pointerId, true);
    };
    const handleWindowBlur = () => {
      const pointerId = activePointerRef.current;
      if (pointerId !== null) resetActiveDrag(pointerId, false);
    };
    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [resetActiveDrag]);

  const finishWindowDrag = useCallback(
    (event: NativePointerEvent) => {
      resetActiveDrag(event.nativeEvent.pointerId, true);
    },
    [resetActiveDrag],
  );

  const handleWindowDragPointerDown = useCallback(
    (event: NativePointerEvent) => {
      const target = event.target as unknown;
      if (
        !manualMode ||
        !isWeb ||
        event.nativeEvent.button !== 0 ||
        activePointerRef.current !== null ||
        (target instanceof Element && target.closest(TITLEBAR_INTERACTIVE_SELECTOR) !== null)
      ) {
        return;
      }
      const bridge = getDesktopWindow();
      if (!bridge?.beginWindowDrag || !bridge.moveWindowDrag || !bridge.endWindowDrag) {
        return;
      }

      const pointerId = event.nativeEvent.pointerId;
      const currentTarget = event.currentTarget as unknown as HTMLElement;
      activePointerRef.current = pointerId;
      activeTargetRef.current = currentTarget;
      activeBridgeRef.current = bridge;
      activeActivityRef.current = beginWindowDragActivity();
      setManualDragActive(true);
      currentTarget.setPointerCapture?.(pointerId);
      event.preventDefault();
      void bridge
        .beginWindowDrag({
          screenX: event.nativeEvent.screenX,
          screenY: event.nativeEvent.screenY,
        })
        .catch(() => resetActiveDrag(pointerId, false));
    },
    [manualMode, resetActiveDrag],
  );

  const handleWindowDragPointerMove = useCallback(
    (event: NativePointerEvent) => {
      if (activePointerRef.current !== event.nativeEvent.pointerId) return;
      if ((event.nativeEvent.buttons & 1) === 0) {
        finishWindowDrag(event);
        return;
      }
      pendingMoveRef.current = {
        screenX: event.nativeEvent.screenX,
        screenY: event.nativeEvent.screenY,
      };
      if (moveFrameRef.current !== null) return;
      moveFrameRef.current = requestAnimationFrame(() => {
        moveFrameRef.current = null;
        const point = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (point) activeBridgeRef.current?.moveWindowDrag?.(point);
      });
    },
    [finishWindowDrag],
  );

  return useMemo(
    () =>
      manualMode
        ? {
            dataSet: TITLEBAR_MANUAL_DRAG_REGION_DATASET,
            onPointerDown: handleWindowDragPointerDown,
            onPointerMove: handleWindowDragPointerMove,
            onPointerUp: finishWindowDrag,
            onPointerCancel: finishWindowDrag,
          }
        : { dataSet: TITLEBAR_DRAG_REGION_DATASET },
    [finishWindowDrag, handleWindowDragPointerDown, handleWindowDragPointerMove, manualMode],
  );
}

const DRAG_OVERLAY_STYLE: React.CSSProperties = {
  top: 0,
  left: 0,
  display: "block",
  position: "absolute",
  width: "100%",
  height: "100%",
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "drag",
};

const TOP_RESIZER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  width: "100%",
  height: 4,
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "no-drag",
};

/**
 * Static drag overlay and top-edge resizer. Returns null on non-Electron.
 * Place as FIRST child of any positioned container that should be draggable.
 */
export function TitlebarDragRegion() {
  if (isNative || !getIsElectronRuntime()) {
    return null;
  }

  return (
    <>
      {/* Drag overlay — VS Code .titlebar-drag-region (titlebarpart.css:57-64) */}
      <div data-window-drag-scope="true" style={DRAG_OVERLAY_STYLE} />
      {/* Top-edge resizer — VS Code .resizer (titlebarpart.css:249-256) */}
      <div style={TOP_RESIZER_STYLE} />
    </>
  );
}
