import { useCallback, useEffect, useMemo, useRef, useState, type PointerEventHandler } from "react";
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

const TITLEBAR_MANUAL_DRAG_THRESHOLD_PX = 4;
const TITLEBAR_MANUAL_DOUBLE_CLICK_MS = 500;

function isInteractiveTitlebarTarget(target: unknown): boolean {
  return target instanceof Element && target.closest(TITLEBAR_INTERACTIVE_SELECTOR) !== null;
}

interface WindowDragPoint {
  screenX: number;
  screenY: number;
}

export function useTitlebarWindowDragSurface() {
  const isMaximized = useIsDesktopWindowMaximized();
  const [manualDragActive, setManualDragActive] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  const activeBridgeRef = useRef<DesktopWindowBridge | null>(null);
  const activeActivityRef = useRef<WindowDragActivityToken | null>(null);
  const dragOriginRef = useRef<WindowDragPoint | null>(null);
  const dragStartedRef = useRef(false);
  const beginDragPromiseRef = useRef<Promise<void> | null>(null);
  const pendingMoveRef = useRef<WindowDragPoint | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const lastManualClickRef = useRef<(WindowDragPoint & { timeStamp: number }) | null>(null);
  const manualMode = isMaximized || manualDragActive;

  const schedulePendingMove = useCallback(() => {
    if (beginDragPromiseRef.current || moveFrameRef.current !== null) return;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      const point = pendingMoveRef.current;
      pendingMoveRef.current = null;
      if (point) activeBridgeRef.current?.moveWindowDrag?.(point);
    });
  }, []);

  const resetActiveDrag = useCallback((pointerId: number, flushLastMove: boolean) => {
    if (activePointerRef.current !== pointerId) return;
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }

    const bridge = activeBridgeRef.current;
    const beginDragPromise = beginDragPromiseRef.current;
    const dragStarted = dragStartedRef.current;
    const pendingMove = pendingMoveRef.current;

    activePointerRef.current = null;
    activeBridgeRef.current = null;
    dragOriginRef.current = null;
    dragStartedRef.current = false;
    beginDragPromiseRef.current = null;
    pendingMoveRef.current = null;

    endWindowDragActivity(activeActivityRef.current);
    activeActivityRef.current = null;
    setManualDragActive(false);

    if (!dragStarted || !bridge) return;
    const finishBridgeDrag = () => {
      if (flushLastMove && pendingMove) {
        bridge.moveWindowDrag?.(pendingMove);
      }
      bridge.endWindowDrag?.();
    };
    if (beginDragPromise) {
      void beginDragPromise.then(finishBridgeDrag, () => undefined);
    } else {
      finishBridgeDrag();
    }
  }, []);

  const updateWindowDrag = useCallback(
    (pointerId: number, buttons: number, point: WindowDragPoint) => {
      if (activePointerRef.current !== pointerId) return;
      if ((buttons & 1) === 0) {
        resetActiveDrag(pointerId, true);
        return;
      }

      if (!dragStartedRef.current) {
        const origin = dragOriginRef.current;
        const bridge = activeBridgeRef.current;
        if (!origin || !bridge?.beginWindowDrag) return;
        const deltaX = point.screenX - origin.screenX;
        const deltaY = point.screenY - origin.screenY;
        if (
          deltaX * deltaX + deltaY * deltaY <
          TITLEBAR_MANUAL_DRAG_THRESHOLD_PX * TITLEBAR_MANUAL_DRAG_THRESHOLD_PX
        ) {
          return;
        }

        lastManualClickRef.current = null;
        dragStartedRef.current = true;
        pendingMoveRef.current = point;
        activeActivityRef.current = beginWindowDragActivity();
        setManualDragActive(true);

        let beginDragPromise: Promise<void>;
        try {
          beginDragPromise = bridge.beginWindowDrag(origin);
        } catch {
          dragStartedRef.current = false;
          resetActiveDrag(pointerId, false);
          return;
        }
        beginDragPromiseRef.current = beginDragPromise;
        void beginDragPromise.then(
          () => {
            if (beginDragPromiseRef.current !== beginDragPromise) return undefined;
            beginDragPromiseRef.current = null;
            schedulePendingMove();
            return undefined;
          },
          () => {
            if (beginDragPromiseRef.current !== beginDragPromise) return undefined;
            beginDragPromiseRef.current = null;
            dragStartedRef.current = false;
            resetActiveDrag(pointerId, false);
            return undefined;
          },
        );
        return;
      }

      pendingMoveRef.current = point;
      schedulePendingMove();
    },
    [resetActiveDrag, schedulePendingMove],
  );

  useEffect(
    () => () => {
      const pointerId = activePointerRef.current;
      if (pointerId !== null) resetActiveDrag(pointerId, false);
    },
    [resetActiveDrag],
  );

  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return;
    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      updateWindowDrag(event.pointerId, event.buttons, {
        screenX: event.screenX,
        screenY: event.screenY,
      });
    };
    const handlePointerUp = (event: PointerEvent) => {
      resetActiveDrag(event.pointerId, true);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      resetActiveDrag(event.pointerId, false);
    };
    const handleWindowBlur = () => {
      lastManualClickRef.current = null;
      const pointerId = activePointerRef.current;
      if (pointerId !== null) resetActiveDrag(pointerId, false);
    };
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [resetActiveDrag, updateWindowDrag]);

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
        isInteractiveTitlebarTarget(target)
      ) {
        return;
      }

      const bridge = getDesktopWindow();
      const click = {
        screenX: event.nativeEvent.screenX,
        screenY: event.nativeEvent.screenY,
        timeStamp: event.timeStamp,
      };
      const previousClick = lastManualClickRef.current;
      const elapsedSincePreviousClick = previousClick
        ? click.timeStamp - previousClick.timeStamp
        : Number.POSITIVE_INFINITY;
      const clickDeltaX = previousClick ? click.screenX - previousClick.screenX : 0;
      const clickDeltaY = previousClick ? click.screenY - previousClick.screenY : 0;
      const isDoubleClick =
        elapsedSincePreviousClick >= 0 &&
        elapsedSincePreviousClick <= TITLEBAR_MANUAL_DOUBLE_CLICK_MS &&
        clickDeltaX * clickDeltaX + clickDeltaY * clickDeltaY <=
          TITLEBAR_MANUAL_DRAG_THRESHOLD_PX * TITLEBAR_MANUAL_DRAG_THRESHOLD_PX;
      lastManualClickRef.current = isDoubleClick ? null : click;
      if (isDoubleClick) {
        if (!bridge?.toggleMaximize) return;
        event.preventDefault();
        event.stopPropagation();
        void bridge.toggleMaximize();
        return;
      }
      if (!bridge?.beginWindowDrag || !bridge.moveWindowDrag || !bridge.endWindowDrag) {
        return;
      }

      activePointerRef.current = event.nativeEvent.pointerId;
      activeBridgeRef.current = bridge;
      dragOriginRef.current = {
        screenX: click.screenX,
        screenY: click.screenY,
      };
      event.preventDefault();
      event.stopPropagation();
    },
    [manualMode],
  );

  return useMemo(
    () =>
      manualMode
        ? {
            dataSet: TITLEBAR_MANUAL_DRAG_REGION_DATASET,
            onPointerDown: handleWindowDragPointerDown,
            onPointerUp: finishWindowDrag,
            onPointerCancel: finishWindowDrag,
          }
        : { dataSet: TITLEBAR_DRAG_REGION_DATASET },
    [finishWindowDrag, handleWindowDragPointerDown, manualMode],
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
 * State-aware drag overlay and top-edge resizer. The overlay owns the manual
 * fallback when it is the exposed hit target (for example, above the sidebar).
 * Parent surfaces still own the fallback when their content paints above it.
 */
function ElectronTitlebarDragRegion() {
  const dragSurface = useTitlebarWindowDragSurface();
  const manualDragSurface = "onPointerDown" in dragSurface ? dragSurface : null;

  return (
    <>
      <div
        data-window-drag-region={dragSurface.dataSet["window-drag-region"]}
        style={DRAG_OVERLAY_STYLE}
        onPointerDown={
          manualDragSurface?.onPointerDown as unknown as PointerEventHandler<HTMLDivElement>
        }
        onPointerUp={
          manualDragSurface?.onPointerUp as unknown as PointerEventHandler<HTMLDivElement>
        }
        onPointerCancel={
          manualDragSurface?.onPointerCancel as unknown as PointerEventHandler<HTMLDivElement>
        }
      />
      {manualDragSurface ? null : <div style={TOP_RESIZER_STYLE} />}
    </>
  );
}

/**
 * Place as the first child of any positioned container that should be draggable.
 */
export function TitlebarDragRegion() {
  if (isNative || !getIsElectronRuntime()) {
    return null;
  }

  return <ElectronTitlebarDragRegion />;
}
