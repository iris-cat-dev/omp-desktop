import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import {
  useDesktopIpcErrorReporter,
  useDesktopIpcQueryErrorToast,
} from "@/desktop/hooks/desktop-ipc-error";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

interface LaunchAtLoginState {
  enabled: boolean;
  supported: boolean;
}

const LAUNCH_AT_LOGIN_QUERY_KEY = ["launch-at-login"] as const;

function parseLaunchAtLoginState(value: unknown): LaunchAtLoginState {
  if (typeof value !== "object" || value === null) {
    return { enabled: false, supported: false };
  }
  const state = value as Record<string, unknown>;
  return {
    enabled: state.enabled === true,
    supported: state.supported === true,
  };
}

async function loadLaunchAtLoginState(): Promise<LaunchAtLoginState> {
  return parseLaunchAtLoginState(await invokeDesktopCommand("get_launch_at_login"));
}

async function setLaunchAtLogin(enabled: boolean): Promise<LaunchAtLoginState> {
  return parseLaunchAtLoginState(await invokeDesktopCommand("set_launch_at_login", { enabled }));
}

export function DesktopStartupSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const reportError = useDesktopIpcErrorReporter();
  const {
    data,
    error,
    isPending: isLoading,
  } = useQuery<LaunchAtLoginState, Error>({
    queryKey: LAUNCH_AT_LOGIN_QUERY_KEY,
    queryFn: loadLaunchAtLoginState,
    staleTime: Infinity,
    retry: false,
  });
  useDesktopIpcQueryErrorToast({
    error,
    message: t("desktop.settings.loadFailed"),
    logLabel: "[LaunchAtLogin] Failed to read OS login-item settings",
  });

  const { mutate, isPending: isSaving } = useMutation({
    mutationFn: setLaunchAtLogin,
    onSuccess: (state) => {
      queryClient.setQueryData(LAUNCH_AT_LOGIN_QUERY_KEY, state);
    },
    onError: (saveError) => {
      reportError({
        error: saveError,
        message: t("desktop.settings.saveFailed"),
        logLabel: "[LaunchAtLogin] Failed to update OS login-item settings",
      });
    },
  });

  const handleChange = useCallback(
    (enabled: boolean) => {
      mutate(enabled);
    },
    [mutate],
  );

  const supported = data?.supported === true;

  return (
    <SettingsSection title={t("settings.startup.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.startup.launchAtLogin")}</Text>
            <Text style={settingsStyles.rowHint}>
              {supported
                ? t("settings.startup.launchAtLoginHint")
                : t("settings.startup.unsupportedHint")}
            </Text>
          </View>
          <Switch
            value={data?.enabled === true}
            onValueChange={handleChange}
            disabled={isLoading || isSaving || !supported}
            accessibilityLabel={t("settings.startup.launchAtLogin")}
            testID="desktop-launch-at-login-switch"
          />
        </View>
      </View>
    </SettingsSection>
  );
}
