/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloseChoiceDialogHost } from "./close-choice-dialog-host";

const mocks = vi.hoisted(() => ({
  respond: vi.fn(async () => true),
  eventHandler: null as ((payload: unknown) => void) | null,
}));

vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({
    events: {
      on: (_event: string, handler: (payload: unknown) => void) => {
        mocks.eventHandler = handler;
        return () => {
          mocks.eventHandler = null;
        };
      },
    },
    window: {
      closeChoice: {
        ready: async () => ({ requestId: 7 }),
        respond: mocks.respond,
      },
    },
  }),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    header,
    footer,
    children,
  }: {
    visible: boolean;
    header: { title: string };
    footer?: ReactNode;
    children: ReactNode;
  }) =>
    visible ? (
      <div role="dialog">
        <h1>{header.title}</h1>
        {children}
        {footer}
      </div>
    ) : null,
}));

describe("CloseChoiceDialogHost", () => {
  afterEach(() => {
    cleanup();
    mocks.respond.mockClear();
    mocks.eventHandler = null;
  });

  it("renders the pending close choice and returns the remembered tray choice", async () => {
    render(<CloseChoiceDialogHost />);

    expect((await screen.findByRole("dialog")).textContent).toContain("点击关闭时");
    fireEvent.click(screen.getByTestId("close-choice-remember"));
    fireEvent.click(screen.getByTestId("close-choice-background"));

    await waitFor(() => {
      expect(mocks.respond).toHaveBeenCalledWith({
        requestId: 7,
        choice: "background",
        remember: true,
      });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
