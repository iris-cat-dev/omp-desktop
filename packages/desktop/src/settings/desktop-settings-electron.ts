import { app } from "electron";

import { createLaunchAtLoginController } from "./launch-at-login.js";
import { createDesktopSettingsStore, type DesktopSettingsStore } from "./desktop-settings.js";

let desktopSettingsStore: DesktopSettingsStore | null = null;

export function getDesktopSettingsStore(): DesktopSettingsStore {
  desktopSettingsStore ??= createDesktopSettingsStore({
    userDataPath: app.getPath("userData"),
  });
  return desktopSettingsStore;
}

export const launchAtLoginController = createLaunchAtLoginController({
  platform: process.platform,
  getLoginItemSettings: () => app.getLoginItemSettings(),
  setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
});
