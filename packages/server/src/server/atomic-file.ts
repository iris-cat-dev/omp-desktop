import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const writeQueues = new Map<string, Promise<void>>();

function isWindowsRenameConflict(error: unknown): boolean {
  return process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM";
}

async function destinationMatches(tempPath: string, filePath: string): Promise<boolean> {
  try {
    const [replacement, destination] = await Promise.all([
      fs.readFile(tempPath),
      fs.readFile(filePath),
    ]);
    return replacement.equals(destination);
  } catch {
    return false;
  }
}

async function replaceTempFile(tempPath: string, filePath: string): Promise<void> {
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Windows rejects concurrent replacement and replacement of an open destination.
    // If another writer already committed the same bytes, the requested write is complete.
    if (!isWindowsRenameConflict(error) || !(await destinationMatches(tempPath, filePath))) {
      throw error;
    }
    await fs.rm(tempPath, { force: true });
  }
}

async function writeFileAtomicNow(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, data, "utf8");
    await replaceTempFile(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

export async function writeFileAtomic(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
): Promise<void> {
  const queueKey = path.resolve(filePath);
  const write = () => writeFileAtomicNow(filePath, data);
  const previous = writeQueues.get(queueKey);
  const queued = previous ? previous.then(write, write) : write();
  writeQueues.set(queueKey, queued);
  try {
    await queued;
  } finally {
    if (writeQueues.get(queueKey) === queued) {
      writeQueues.delete(queueKey);
    }
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}
