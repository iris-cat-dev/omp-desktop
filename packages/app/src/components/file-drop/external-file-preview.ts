import { WORKSPACE_FILE_DRAG_MIME } from "@/attachments/workspace-file-drag";

export const EXTERNAL_FILE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_SAMPLE_BYTES = 8 * 1024;

export type ExternalFilePreviewError = "directory" | "tooLarge" | "unsupported" | "unreadable";
export type ExternalFilePreviewItem =
  | { name: string; file: File; error?: never }
  | { name: string; file?: never; error: ExternalFilePreviewError };
export type ExternalFilePreviewResult =
  | { status: "ready"; content: string }
  | { status: "error"; error: ExternalFilePreviewError };

export function isExternalFileTransfer(transfer: DataTransfer | null): transfer is DataTransfer {
  if (!transfer) return false;
  const types = new Set(transfer.types);
  return types.has("Files") && !types.has(WORKSPACE_FILE_DRAG_MIME);
}

// Snapshot synchronously during drop: the browser protects DataTransfer after dispatch.
// Entries are used only to identify directories, never to traverse or resolve paths.
export function collectExternalPreviewItems(transfer: DataTransfer): ExternalFilePreviewItem[] {
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === "file");
  if (items.length === 0) {
    return Array.from(transfer.files).map((file) => ({ name: file.name, file }));
  }
  return items.map((item) => {
    try {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) return { name: entry.name, error: "directory" };
      const file = item.getAsFile();
      return file ? { name: file.name, file } : { name: entry?.name ?? "", error: "unreadable" };
    } catch {
      return { name: "", error: "unreadable" };
    }
  });
}

function decodeText(bytes: ArrayBuffer, partial: boolean): string | null {
  try {
    // Streaming a prefix tolerates a UTF-8 character split at the sample boundary.
    // Fatal decoding rejects malformed UTF-8 instead of replacing binary bytes.
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: partial });
    // Permit ordinary text whitespace, but not NUL or binary control characters.
    for (let index = 0; index < content.length; index++) {
      const code = content.charCodeAt(index);
      if (code <= 8 || (code >= 14 && code <= 31) || (code >= 127 && code <= 159)) {
        return null;
      }
    }
    return content;
  } catch {
    return null;
  }
}

export async function readExternalPreviewFile(
  file: File,
  isCurrent: () => boolean,
): Promise<ExternalFilePreviewResult | null> {
  if (file.size > EXTERNAL_FILE_PREVIEW_MAX_BYTES) {
    return { status: "error", error: "tooLarge" };
  }
  try {
    if (!isCurrent()) return null;
    const sample = await file.slice(0, TEXT_SAMPLE_BYTES).arrayBuffer();
    if (!isCurrent()) return null;
    const partial = file.size > TEXT_SAMPLE_BYTES;
    const sampledText = decodeText(sample, partial);
    if (sampledText === null) return { status: "error", error: "unsupported" };
    if (!partial) return { status: "ready", content: sampledText };

    const bytes = await file.arrayBuffer();
    if (!isCurrent()) return null;
    const content = decodeText(bytes, false);
    return content === null
      ? { status: "error", error: "unsupported" }
      : { status: "ready", content };
  } catch {
    return isCurrent() ? { status: "error", error: "unreadable" } : null;
  }
}
