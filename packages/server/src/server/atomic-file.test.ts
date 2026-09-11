import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { writeFileAtomic } from "./atomic-file.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "omp-atomic-file-"));
  tempRoots.push(root);
  return root;
}

describe("writeFileAtomic", () => {
  test("serializes concurrent replacements of the same file", async () => {
    const root = await createTempRoot();
    const filePath = path.join(root, "shared.yml");
    const values = Array.from({ length: 16 }, (_, index) => `value-${index}`);

    await Promise.all(values.map((value) => writeFileAtomic(filePath, value)));

    await expect(readFile(filePath, "utf8")).resolves.toBe(values.at(-1));
  });

  test.skipIf(process.platform !== "win32")(
    "accepts identical contents while Windows has the destination open",
    async () => {
      const root = await createTempRoot();
      const filePath = path.join(root, "open.yml");
      await writeFileAtomic(filePath, "stable");
      const handle = await open(filePath, "r");

      try {
        await expect(writeFileAtomic(filePath, "stable")).resolves.toBeUndefined();
      } finally {
        await handle.close();
      }

      await expect(readFile(filePath, "utf8")).resolves.toBe("stable");
    },
  );

  test.skipIf(process.platform !== "win32")(
    "rejects different contents while Windows has the destination open",
    async () => {
      const root = await createTempRoot();
      const filePath = path.join(root, "open.yml");
      await writeFileAtomic(filePath, "stable");
      const handle = await open(filePath, "r");

      try {
        await expect(writeFileAtomic(filePath, "changed")).rejects.toMatchObject({
          code: "EPERM",
        });
      } finally {
        await handle.close();
      }

      await expect(readFile(filePath, "utf8")).resolves.toBe("stable");
    },
  );
});
