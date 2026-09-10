import type { AgentAttachment, ForgeSearchItem } from "@omp-desktop/protocol/messages";
import type { UserComposerAttachment } from "@/attachments/types";
import { generateAttachmentId } from "@/attachments/utils";
import { createDirectoryComposerAttachment } from "@/attachments/directory";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import type { UserMessageImageAttachment } from "@/types/stream";
import React, { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

interface RewindComposerRestoreContextValue {
  restoreIfComposerEmpty: (input: {
    text: string;
    images: readonly UserMessageImageAttachment[];
    attachments: readonly AgentAttachment[];
  }) => void;
}

interface RewindComposerRestoreProviderProps {
  restoreDraftIfEmpty: (draft: { text: string; attachments: UserComposerAttachment[] }) => void;
  children: ReactNode;
}

const RewindComposerRestoreContext = createContext<RewindComposerRestoreContextValue | null>(null);

function agentAttachmentToComposerAttachment(
  attachment: AgentAttachment,
): UserComposerAttachment | null {
  switch (attachment.type) {
    case "uploaded_file":
      return { kind: "file", attachment };
    case "forge_issue":
    case "github_issue":
      return {
        kind: attachment.type,
        item: toForgeSearchItem(attachment, "issue"),
      };
    case "forge_change_request":
      return {
        kind: "forge_change_request",
        item: toForgeSearchItem(attachment, "change_request"),
      };
    case "github_pr":
      return {
        kind: "github_pr",
        item: toForgeSearchItem(attachment, "change_request"),
      };
    case "text":
      return textAttachmentToComposerAttachment(attachment);
    case "review":
      return null;
  }
}

function toForgeSearchItem(
  attachment: Extract<
    AgentAttachment,
    { type: "forge_issue" | "github_issue" | "forge_change_request" | "github_pr" }
  >,
  kind: ForgeSearchItem["kind"],
): ForgeSearchItem {
  return {
    kind,
    ...("forge" in attachment ? { forge: attachment.forge } : {}),
    number: attachment.number,
    title: attachment.title,
    url: attachment.url,
    state: "",
    body: attachment.body ?? null,
    labels: [],
    ...("projectPath" in attachment && attachment.projectPath
      ? { projectPath: attachment.projectPath }
      : {}),
    ...("baseRefName" in attachment ? { baseRefName: attachment.baseRefName } : {}),
    ...("headRefName" in attachment ? { headRefName: attachment.headRefName } : {}),
  };
}

function textAttachmentToComposerAttachment(
  attachment: Extract<AgentAttachment, { type: "text" }>,
): UserComposerAttachment | null {
  if (attachment.contextKind === "directory" && attachment.text.startsWith("Directory: ")) {
    return createDirectoryComposerAttachment(attachment.text.slice("Directory: ".length));
  }

  const workspaceFile = /^Workspace file: (.+?)(?:\nLines: (\d+)-(\d+))?$/.exec(attachment.text);
  if (workspaceFile?.[1]) {
    const startLine = Number(workspaceFile[2]);
    const endLine = Number(workspaceFile[3]);
    return createWorkspaceFileAttachment({
      path: workspaceFile[1],
      selection:
        Number.isInteger(startLine) && Number.isInteger(endLine)
          ? { kind: "line_range", startLine, endLine }
          : { kind: "whole_file" },
    });
  }

  return attachment.text.length > 0
    ? { kind: "quoted_content", id: generateAttachmentId(), text: attachment.text }
    : null;
}

export function createRewoundComposerAttachments(input: {
  images: readonly UserMessageImageAttachment[];
  attachments: readonly AgentAttachment[];
}): UserComposerAttachment[] {
  const restored: UserComposerAttachment[] = input.images.map((metadata) => ({
    kind: "image",
    metadata,
  }));
  for (const attachment of input.attachments) {
    const composerAttachment = agentAttachmentToComposerAttachment(attachment);
    if (composerAttachment) {
      restored.push(composerAttachment);
    }
  }
  return restored;
}

export function RewindComposerRestoreProvider({
  restoreDraftIfEmpty,
  children,
}: RewindComposerRestoreProviderProps) {
  const restoreIfComposerEmpty = useCallback(
    (rewound: {
      text: string;
      images: readonly UserMessageImageAttachment[];
      attachments: readonly AgentAttachment[];
    }) => {
      restoreDraftIfEmpty({
        text: rewound.text,
        attachments: createRewoundComposerAttachments(rewound),
      });
    },
    [restoreDraftIfEmpty],
  );

  const value = useMemo(() => ({ restoreIfComposerEmpty }), [restoreIfComposerEmpty]);

  return (
    <RewindComposerRestoreContext.Provider value={value}>
      {children}
    </RewindComposerRestoreContext.Provider>
  );
}

export function useRewindComposerRestore(): RewindComposerRestoreContextValue | null {
  return useContext(RewindComposerRestoreContext);
}
