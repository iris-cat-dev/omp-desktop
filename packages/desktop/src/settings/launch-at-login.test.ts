import { describe, expect, it, vi } from "vitest";

import { createLaunchAtLoginController } from "./launch-at-login";

function createController(platform: NodeJS.Platform, initiallyEnabled = false) {
  let enabled = initiallyEnabled;
  const setLoginItemSettings = vi.fn((settings: { openAtLogin: boolean }) => {
    enabled = settings.openAtLogin;
  });
  const controller = createLaunchAtLoginController({
    platform,
    getLoginItemSettings: () => ({ openAtLogin: enabled }),
    setLoginItemSettings,
  });
  return { controller, setLoginItemSettings };
}

describe("launch-at-login", () => {
  it.each(["darwin", "win32"] as const)("uses the OS login-item setting on %s", (platform) => {
    const { controller, setLoginItemSettings } = createController(platform);

    expect(controller.get()).toEqual({ enabled: false, supported: true });
    expect(controller.set(true)).toEqual({ enabled: true, supported: true });
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it("reports unsupported platforms without reading or changing login items", () => {
    const getLoginItemSettings = vi.fn(() => ({ openAtLogin: true }));
    const setLoginItemSettings = vi.fn();
    const controller = createLaunchAtLoginController({
      platform: "linux",
      getLoginItemSettings,
      setLoginItemSettings,
    });

    expect(controller.get()).toEqual({ enabled: false, supported: false });
    expect(getLoginItemSettings).not.toHaveBeenCalled();
    expect(() => controller.set(true)).toThrow("not supported");
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });
});
