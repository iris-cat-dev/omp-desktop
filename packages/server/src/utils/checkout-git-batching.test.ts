import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { getCheckoutDiff } from "./checkout-git.js";

function initRepoWithTrackedChanges(fileCount: number): { tempDir: string; repoDir: string } {
  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "checkout-git-batch-test-")));
  const repoDir = join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `before-${i}\n`);
  }
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], { cwd: repoDir });
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `after-${i}\n`);
  }
  return { tempDir, repoDir };
}

describe("checkout git diff batching", () => {
  let tempDir: string;
  let repoDir: string;
  beforeEach(() => {
    ({ tempDir, repoDir } = initRepoWithTrackedChanges(20));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps later small patches when another patch exceeds the remaining total budget", async () => {
    for (let index = 0; index < 3; index++) {
      writeFileSync(join(repoDir, `file-${index}.txt`), `${"x".repeat(800_000)}\n`);
    }
    const result = await getCheckoutDiff(repoDir, { mode: "uncommitted", includeStructured: true });
    expect(result.structured?.find((file) => file.path === "file-2.txt")).toMatchObject({
      status: "too_large",
      additions: 1,
      deletions: 1,
      hunks: [],
    });
    expect(Buffer.byteLength(result.diff)).toBeLessThanOrEqual(2 * 1024 * 1024);
    for (let index = 3; index < 20; index++) {
      const file = result.structured?.find((entry) => entry.path === `file-${index}.txt`);
      expect(file).toMatchObject({ status: "ok", additions: 1, deletions: 1 });
      expect(file?.hunks.flatMap((hunk) => hunk.lines)).toContainEqual(
        expect.objectContaining({ type: "add", content: `after-${index}` }),
      );
    }
  });

  it("lists more than the full file limit and still renders an exact requested path", async () => {
    const paths = Array.from({ length: 501 }, (_, index) => `untracked-${index}.txt`);
    for (const path of paths) writeFileSync(join(repoDir, path), "first\nlast");
    const summary = await getCheckoutDiff(repoDir, { mode: "unstaged", detail: "summary" });
    expect(summary.diffTooLarge).not.toBe(true);
    const additions = new Map(summary.structured?.map((file) => [file.path, file.additions]));
    for (const path of paths) expect(additions.get(path)).toBe(2);
    const full = await getCheckoutDiff(repoDir, {
      mode: "unstaged",
      includeStructured: true,
      paths: ["file-19.txt"],
    });
    expect(full.structured).toEqual([
      expect.objectContaining({ path: "file-19.txt", status: "ok", additions: 1, deletions: 1 }),
    ]);
    expect(full.diff).toContain("+after-19");
    expect(full.diff).not.toContain("untracked-");
  });
});
