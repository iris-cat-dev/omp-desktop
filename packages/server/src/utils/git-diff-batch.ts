import { parseDiff } from "../server/utils/diff-highlighter.js";
import { runGitCommand } from "./run-git-command.js";

const READ_ONLY_GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };

/** Drain one patch stream, retaining only complete, individually bounded patches. */
export async function readTrackedPatches(
  cwd: string,
  args: string[],
  perFileBytes: number,
  totalBytes: number,
): Promise<Map<string, { text: string; truncated: boolean }>> {
  const patches = new Map<string, { text: string; truncated: boolean }>();
  const delimiter = Buffer.from("\ndiff --git ");
  let pending = Buffer.alloc(0);
  let chunks: Buffer[] = [];
  let size = 0;
  let retained = 0;
  let total = 0;
  const append = (chunk: Buffer) => {
    size += chunk.length;
    const remaining = perFileBytes - retained;
    if (remaining > 0) {
      const part = chunk.subarray(0, remaining);
      chunks.push(part);
      retained += part.length;
    }
  };
  const finish = () => {
    if (retained === 0) return;
    const bytes = Buffer.concat(chunks, retained);
    // Metadata fits well within the per-file budget even when the body does not.
    const headerEnd = bytes.indexOf(Buffer.from("\n@@ "));
    const metadata = bytes.subarray(
      0,
      headerEnd < 0 ? Math.min(bytes.length, 16 * 1024) : headerEnd,
    );
    const path = parseDiff(metadata.toString("utf8"))[0]?.path;
    if (!path) throw new Error("Git emitted a patch without a file path");
    const truncated = size > perFileBytes || total + size > totalBytes;
    patches.set(path, { text: truncated ? "" : bytes.toString("utf8"), truncated });
    if (!truncated) total += size;
    chunks = [];
    size = 0;
    retained = 0;
  };
  await runGitCommand(args, {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    // Only the bounded current file and accepted total are retained. A huge file
    // must be drained rather than killing git and losing the following files.
    maxOutputBytes: Number.POSITIVE_INFINITY,
    onStdout(chunk) {
      const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let start = 0;
      let boundary: number;
      while ((boundary = data.indexOf(delimiter, start)) !== -1) {
        append(data.subarray(start, boundary + 1));
        finish();
        start = boundary + 1;
      }
      const end = Math.max(start, data.length - delimiter.length + 1);
      append(data.subarray(start, end));
      pending = Buffer.from(data.subarray(end));
    },
  });
  append(pending);
  finish();
  return patches;
}

/** Resolve refs/index entries once, then fetch immutable, size-checked blobs once. */
export async function readGitBlobContents(
  cwd: string,
  objects: string[],
  perFileBytes: number,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  const unique = [...new Set(objects)];
  if (unique.length === 0) return contents;
  const checked = await runGitCommand(
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)", "-z"],
    {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      stdin: unique.join("\0") + "\0",
      maxOutputBytes: 8 * 1024 * 1024,
    },
  );
  if (checked.truncated) return contents;
  const blobs = new Map<string, { size: number; objects: string[] }>();
  let offset = 0;
  let total = 0;
  const maxContentBytes = 8 * 1024 * 1024;
  for (const object of unique) {
    // Missing specs may themselves contain newlines; consume their exact echo.
    const missing = `${object} missing\n`;
    if (checked.stdout.startsWith(missing, offset)) {
      offset += missing.length;
      continue;
    }
    const end = checked.stdout.indexOf("\n", offset);
    if (end < 0) return contents;
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(checked.stdout.slice(offset, end));
    offset = end + 1;
    if (!match) continue;
    const [, oid, rawSize] = match;
    const size = Number(rawSize);
    const existing = blobs.get(oid);
    if (existing) {
      existing.objects.push(object);
    } else if (size <= perFileBytes && total + size <= maxContentBytes) {
      total += size;
      blobs.set(oid, { size, objects: [object] });
    }
  }
  if (blobs.size === 0) return contents;
  // OIDs from batch-check cannot change between the two finite commands. Binary
  // framing is parsed before UTF-8 decoding so byte lengths remain authoritative.
  const chunks: Buffer[] = [];
  const result = await runGitCommand(["cat-file", "--batch"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    stdin: [...blobs.keys()].join("\n") + "\n",
    maxOutputBytes: total + blobs.size * 128,
    onStdout: (chunk) => {
      chunks.push(chunk);
    },
  });
  if (result.truncated) return contents;
  const data = Buffer.concat(chunks);
  offset = 0;
  for (const [oid, blob] of blobs) {
    const end = data.indexOf(10, offset);
    if (end < 0 || data.toString("ascii", offset, end) !== `${oid} blob ${blob.size}`) break;
    const start = end + 1;
    if (start + blob.size >= data.length || data[start + blob.size] !== 10) break;
    const content = data.toString("utf8", start, start + blob.size);
    for (const object of blob.objects) contents.set(object, content);
    offset = start + blob.size + 1;
  }
  return contents;
}
