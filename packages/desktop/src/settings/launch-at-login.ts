export interface LaunchAtLoginState {
  enabled: boolean;
  supported: boolean;
}

interface LoginItemSettings {
  openAtLogin: boolean;
}

export interface LaunchAtLoginController {
  get(): LaunchAtLoginState;
  set(enabled: boolean): LaunchAtLoginState;
}

export function createLaunchAtLoginController({
  platform,
  getLoginItemSettings,
  setLoginItemSettings,
}: {
  platform: NodeJS.Platform;
  getLoginItemSettings: () => LoginItemSettings;
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
}): LaunchAtLoginController {
  const supported = platform === "darwin" || platform === "win32";

  return {
    get() {
      return {
        enabled: supported && getLoginItemSettings().openAtLogin,
        supported,
      };
    },
    set(enabled) {
      if (!supported) {
        throw new Error("Launch at login is not supported on this platform.");
      }
      setLoginItemSettings({ openAtLogin: enabled });
      return {
        enabled: getLoginItemSettings().openAtLogin,
        supported: true,
      };
    },
  };
}
