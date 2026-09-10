import type { UserComposerAttachment } from "@/attachments/types";
import type { UserMessageImageAttachment } from "@/types/stream";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

interface RewindComposerRestoreContextValue {
  restoreIfComposerEmpty: (input: {
    text: string;
    images: readonly UserMessageImageAttachment[];
  }) => void;
}

interface RewindComposerRestoreProviderProps {
  text: string;
  setText: (text: string) => void;
  attachments: UserComposerAttachment[];
  setAttachments: (attachments: UserComposerAttachment[]) => void;
  children: ReactNode;
}

const RewindComposerRestoreContext = createContext<RewindComposerRestoreContextValue | null>(null);

export function restoreComposerTextIfEmpty(input: {
  currentText: string;
  rewoundText: string;
}): string {
  if (input.currentText.length > 0) {
    return input.currentText;
  }
  return input.rewoundText;
}

export function restoreComposerAttachmentsIfEmpty(input: {
  currentAttachments: UserComposerAttachment[];
  rewoundImages: readonly UserMessageImageAttachment[];
}): UserComposerAttachment[] {
  if (input.currentAttachments.length > 0) {
    return input.currentAttachments;
  }
  return input.rewoundImages.map((metadata) => ({ kind: "image", metadata }));
}

export function RewindComposerRestoreProvider({
  text,
  setText,
  attachments,
  setAttachments,
  children,
}: RewindComposerRestoreProviderProps) {
  const textRef = useRef(text);
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const restoreIfComposerEmpty = useCallback(
    (rewound: { text: string; images: readonly UserMessageImageAttachment[] }) => {
      const nextText = restoreComposerTextIfEmpty({
        currentText: textRef.current,
        rewoundText: rewound.text,
      });
      if (nextText !== textRef.current) {
        setText(nextText);
      }

      const nextAttachments = restoreComposerAttachmentsIfEmpty({
        currentAttachments: attachmentsRef.current,
        rewoundImages: rewound.images,
      });
      if (nextAttachments !== attachmentsRef.current) {
        setAttachments(nextAttachments);
      }
    },
    [setAttachments, setText],
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
