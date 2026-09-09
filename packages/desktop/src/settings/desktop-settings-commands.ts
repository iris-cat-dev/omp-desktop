import type { LaunchAtLoginController } from "./launch-at-login.js";

import type { DesktopSettingsStore } from "./desktop-settings.js";

export type DesktopCommandHandler = (args?: Record<string, unknown>) => unknown;

export function createDesktopSettingsCommandHandlers({
  settingsStore,
  launchAtLoginController,
}: {
  settingsStore: DesktopSettingsStore;
  launchAtLoginController: LaunchAtLoginController;
}): Record<string, DesktopCommandHandler> {
  return {
    get_desktop_settings: () => settingsStore.get(),
    patch_desktop_settings: (args) => settingsStore.patch(args),
    migrate_legacy_desktop_settings: (args) => settingsStore.migrateLegacyRendererSettings(args),
    get_launch_at_login: () => launchAtLoginController.get(),
    set_launch_at_login: (args) => {
      if (typeof args?.enabled !== "boolean") {
        throw new TypeError("set_launch_at_login requires a boolean enabled value.");
      }
      return launchAtLoginController.set(args.enabled);
    },
  };
}
