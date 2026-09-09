import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptiveModalSheet } from "./adaptive-modal-sheet";

interface MountedSheet {
  root: Root;
  container: HTMLDivElement;
}

const mountedSheets: MountedSheet[] = [];
const modalHeader = { title: "Custom provider" };

function mountSheet(onClose: () => void): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() =>
    root.render(
      <AdaptiveModalSheet
        header={modalHeader}
        visible
        onClose={onClose}
        dismissOnBackdropPress={false}
        testID="custom-provider-dialog"
      >
        <div>Provider form</div>
      </AdaptiveModalSheet>,
    ),
  );
  mountedSheets.push({ root, container });
}

afterEach(() => {
  for (const mounted of mountedSheets.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
  document.getElementById("overlay-root")?.remove();
});

describe("AdaptiveModalSheet", () => {
  it("keeps a modal open when backdrop dismissal is disabled", () => {
    const onClose = vi.fn();
    mountSheet(onClose);

    const dialog = document.querySelector('[role="dialog"]');
    const backdrop = dialog?.previousElementSibling;
    if (!(dialog instanceof HTMLElement) || !(backdrop instanceof HTMLElement)) {
      throw new Error("Modal dialog did not render with a backdrop");
    }

    backdrop.click();

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  });
});
