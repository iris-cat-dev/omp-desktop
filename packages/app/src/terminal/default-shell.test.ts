import { describe, expect, it } from "vitest";
import { resolveDesktopDefaultTerminalShell } from "./default-shell";

describe("resolveDesktopDefaultTerminalShell", () => {
  it("uses the desktop login shell for a loopback daemon", () => {
    expect(
      resolveDesktopDefaultTerminalShell({
        activeConnection: {
          type: "directTcp",
          endpoint: "127.0.0.1:6770",
          display: "127.0.0.1:6770",
        },
        loginShell: " /bin/zsh ",
      }),
    ).toBe("/bin/zsh");
  });

  it("uses the desktop login shell for local socket transports", () => {
    expect(
      resolveDesktopDefaultTerminalShell({
        activeConnection: { type: "directSocket", endpoint: "/tmp/paseo.sock", display: "socket" },
        loginShell: "/bin/zsh",
      }),
    ).toBe("/bin/zsh");
  });

  it("does not send a local shell path to a remote daemon", () => {
    expect(
      resolveDesktopDefaultTerminalShell({
        activeConnection: {
          type: "directTcp",
          endpoint: "remote.example.com:6770",
          display: "remote.example.com:6770",
        },
        loginShell: "/bin/zsh",
      }),
    ).toBeUndefined();
    expect(
      resolveDesktopDefaultTerminalShell({
        activeConnection: { type: "relay", endpoint: "relay.example.com:443", display: "relay" },
        loginShell: "/bin/zsh",
      }),
    ).toBeUndefined();
  });
});
