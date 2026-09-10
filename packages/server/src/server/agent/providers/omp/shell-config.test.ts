import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareOmpAgentShellEnv, resolveOmpAgentShellPath } from "./shell-config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("OMP Agent Shell configuration", () => {
  it("selects the first verified Git Bash installation on Windows", async () => {
    const probed: string[] = [];
    const selected = await resolveOmpAgentShellPath(
      { mode: "auto" },
      {
        platform: "win32",
        env: {
          ProgramFiles: "C:\\Program Files",
          LocalAppData: "C:\\Users\\alice\\AppData\\Local",
          USERPROFILE: "C:\\Users\\alice",
          "ProgramFiles(x86)": "C:\\Program Files (x86)",
        },
        probe: vi.fn(async (candidate) => {
          probed.push(candidate);
          return candidate.includes("AppData");
        }),
      },
    );

    expect(selected).toBe(
      join("C:\\Users\\alice\\AppData\\Local", "Programs", "Git", "bin", "bash.exe"),
    );
    expect(probed).toEqual([
      join("C:\\Program Files", "Git", "bin", "bash.exe"),
      join("C:\\Users\\alice\\AppData\\Local", "Programs", "Git", "bin", "bash.exe"),
    ]);
  });

  it("writes an app-owned overlay and appends it after user config files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "omp-desktop-shell-"));
    temporaryDirectories.push(directory);
    const existing = join(directory, "user.yml");

    const env = await prepareOmpAgentShellEnv({
      config: { mode: "omp-default" },
      configDir: directory,
      env: { PI_CONFIG_FILES: existing },
    });

    const overlayPath = join(directory, "omp-provider.yml");
    expect(env.PI_CONFIG_FILES).toBe(`${existing}${delimiter}${overlayPath}`);
    expect(await readFile(overlayPath, "utf8")).toBe("bashInterceptor:\n  enabled: true\n");
  });
});
