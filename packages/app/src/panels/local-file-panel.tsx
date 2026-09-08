import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { LocalFilePreview } from "@/components/file-drop/local-file-preview";
import { createMaterialFileIcon } from "@/components/material-file-icon";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelRegistration } from "@/panels/panel-registry";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

function useLocalFilePanelDescriptor(target: Extract<WorkspaceTabTarget, { kind: "local_file" }>) {
  const { t } = useTranslation();
  const icon = useMemo(() => createMaterialFileIcon(target.name), [target.name]);
  return {
    label: target.name,
    subtitle: t("externalFilePreview.title"),
    tooltip: `${target.name}\n${t("externalFilePreview.localOnly")}`,
    titleState: "ready" as const,
    icon,
    statusBucket: null,
  };
}

function LocalFilePanel() {
  const { target } = usePaneContext();
  invariant(target.kind === "local_file", "LocalFilePanel requires local_file target");
  return <LocalFilePreview previewId={target.previewId} />;
}

export const localFilePanelRegistration: PanelRegistration<"local_file"> = {
  kind: "local_file",
  component: LocalFilePanel,
  useDescriptor: useLocalFilePanelDescriptor,
  resourceKey: (target) => target.previewId,
};
