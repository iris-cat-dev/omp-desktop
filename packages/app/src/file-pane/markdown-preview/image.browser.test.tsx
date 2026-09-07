import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownBlockImage } from "@/components/markdown/block-image";
import { MarkdownBlockImageLink } from "@/components/markdown/block-image-link";
import { View } from "react-native";

interface MountedPreview {
  root: Root;
  container: HTMLDivElement;
}

const mountedPreviews: MountedPreview[] = [];

function mountPreview(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  container.style.width = "900px";
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(node));
  mountedPreviews.push({ root, container });
  return container;
}

afterEach(() => {
  for (const mounted of mountedPreviews.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("Markdown preview images", () => {
  it("renders linked Shields.io badges at their intrinsic dimensions", async () => {
    const preview = mountPreview(
      <MarkdownBlockImage
        src="https://img.shields.io/badge/status-In%20Development-yellow.svg"
        alt="Status"
        style={{}}
      />,
    );
    const image = preview.querySelector("img");
    if (!(image instanceof HTMLImageElement)) {
      throw new Error("Markdown preview did not render the badge image");
    }

    await expect.poll(() => image.getBoundingClientRect().width).toBe(142);
    expect(image.getBoundingClientRect().height).toBe(20);
  });

  it("keeps consecutive linked badges next to each other", async () => {
    const preview = mountPreview(
      <View style={{ flexDirection: "row" }}>
        <MarkdownBlockImageLink href="">
          <MarkdownBlockImage
            src="https://img.shields.io/badge/UE-4.22-orange.svg"
            alt="UE Version"
            style={{}}
          />
        </MarkdownBlockImageLink>
        <MarkdownBlockImageLink href="">
          <MarkdownBlockImage
            src="https://img.shields.io/badge/status-In%20Development-yellow.svg"
            alt="Status"
            style={{}}
          />
        </MarkdownBlockImageLink>
      </View>,
    );
    const images = [...preview.querySelectorAll("img")];
    if (images.length !== 2) {
      throw new Error("Markdown preview did not render both badge images");
    }

    await expect.poll(() => images[1]?.getBoundingClientRect().width).toBe(142);
    const first = images[0]?.getBoundingClientRect();
    const second = images[1]?.getBoundingClientRect();
    expect(second.left - first.right).toBe(4);
  });
});
