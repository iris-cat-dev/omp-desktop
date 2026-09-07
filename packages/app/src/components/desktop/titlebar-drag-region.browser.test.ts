/// <reference types="vite/client" />

import { afterEach, describe, expect, it } from "vitest";
import appShellHtml from "/index.html?raw&url";

const mountedFrames: HTMLIFrameElement[] = [];

async function mountAppShell(): Promise<Document> {
  const frame = document.createElement("iframe");
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  frame.srcdoc = appShellHtml;
  document.body.appendChild(frame);
  mountedFrames.push(frame);
  await loaded;

  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error("App shell iframe did not create a document");
  return frameDocument;
}

function readAppRegion(element: Element): string {
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error("App shell document has no window");
  return view.getComputedStyle(element).getPropertyValue("-webkit-app-region");
}

afterEach(() => {
  for (const frame of mountedFrames.splice(0)) frame.remove();
});

describe("window drag region CSS", () => {
  it("leaves an overflow-clipped chat control out of the native no-drag map", async () => {
    const frameDocument = await mountAppShell();
    frameDocument.body.innerHTML = `
      <div
        id="chat-scroll"
        style="position:absolute;top:72px;left:100px;width:820px;height:100px;overflow:auto"
      >
        <div style="box-sizing:border-box;height:1000px;padding-top:200px">
          <button id="hidden-activity" style="display:block;width:820px;height:32px">Activity</button>
        </div>
      </div>
    `;

    const scroll = frameDocument.getElementById("chat-scroll");
    const activity = frameDocument.getElementById("hidden-activity");
    if (!scroll || !activity) {
      throw new Error("Failed to create clipped activity fixture");
    }

    scroll.scrollTop = 272;
    const scrollBounds = scroll.getBoundingClientRect();
    const activityBounds = activity.getBoundingClientRect();

    expect(activityBounds.top).toBe(0);
    expect(activityBounds.bottom).toBeLessThan(scrollBounds.top);
    expect(readAppRegion(activity)).toBe("none");
  });

  it("keeps controls inside window chrome and global overlays interactive", async () => {
    const frameDocument = await mountAppShell();
    frameDocument.body.innerHTML = `
      <div id="native-region" data-window-drag-region="native">
        <button id="native-control">Native control</button>
      </div>
      <div>
        <div data-window-drag-scope="true"></div>
        <section><button id="static-control">Static control</button></section>
      </div>
      <div id="window-controls-overlay" data-window-controls-overlay="true">
        <button id="window-control">Window control</button>
      </div>
      <div id="overlay-root"><button id="overlay-control">Overlay control</button></div>
    `;

    const nativeRegion = frameDocument.getElementById("native-region");
    const nativeControl = frameDocument.getElementById("native-control");
    const staticControl = frameDocument.getElementById("static-control");
    const windowControlsOverlay = frameDocument.getElementById("window-controls-overlay");
    const windowControl = frameDocument.getElementById("window-control");
    const overlayControl = frameDocument.getElementById("overlay-control");
    if (
      !nativeRegion ||
      !nativeControl ||
      !staticControl ||
      !windowControlsOverlay ||
      !windowControl ||
      !overlayControl
    ) {
      throw new Error("Failed to create window chrome fixture");
    }

    expect(readAppRegion(nativeRegion)).toBe("drag");
    expect(readAppRegion(nativeControl)).toBe("no-drag");
    expect(readAppRegion(staticControl)).toBe("no-drag");
    expect(readAppRegion(windowControlsOverlay)).toBe("no-drag");
    expect(readAppRegion(windowControl)).toBe("no-drag");
    expect(readAppRegion(overlayControl)).toBe("no-drag");
  });
});
