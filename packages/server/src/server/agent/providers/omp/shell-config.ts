import { execFile } from "node:child_process";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { stringify } from "yaml";

import { writeFileAtomic } from "../../../atomic-file.js";
import type { OmpRuntimeProviderParams } from "./provider-config.js";

const PROBE_MARKER = "__OMP_GIT_BASH__";
const OMP_DESKTOP_CONFIG_FILENAME = "omp-provider.yml";
const execFileAsync = promisify(execFile);

type AgentShellConfig = OmpRuntimeProviderParams["agentShell"];
type ProbeShell = (shellPath: string) => Promise<boolean>;

function windowsGitBashCandidates(env: NodeJS.ProcessEnv): string[] {
  return [
    env.ProgramFiles ? join(env.ProgramFiles, "Git", "bin", "bash.exe") : null,
    env.LocalAppData ? join(env.LocalAppData, "Programs", "Git", "bin", "bash.exe") : null,
    env.USERPROFILE
      ? join(env.USERPROFILE, "scoop", "apps", "git", "current", "bin", "bash.exe")
      : null,
    env["ProgramFiles(x86)"] ? join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : null,
  ].filter((candidate): candidate is string => candidate !== null);
}

export async function probeGitBash(shellPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      shellPath,
      ["--noprofile", "--norc", "-c", `printf ${PROBE_MARKER}`],
      { timeout: 5_000, windowsHide: true },
    );
    return stdout === PROBE_MARKER;
  } catch {
    return false;
  }
}

export async function resolveOmpAgentShellPath(
  config: AgentShellConfig,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    probe?: ProbeShell;
  } = {},
): Promise<string | undefined> {
  if (config.mode === "omp-default") return undefined;

  const platform = options.platform ?? process.platform;
  const probe = options.probe ?? probeGitBash;
  if (config.mode === "custom") {
    const customPath = config.path?.trim();
    if (!customPath || !(await probe(customPath))) {
      throw new Error(
        `Custom Agent Shell is not a compatible Bash executable: ${customPath || "(empty path)"}`,
      );
    }
    return customPath;
  }

  if (platform !== "win32") return undefined;
  for (const candidate of windowsGitBashCandidates(options.env ?? process.env)) {
    if (await probe(candidate)) return candidate;
  }

  if (config.mode === "git-bash") {
    throw new Error("Git Bash was not found in a supported installation location");
  }
  return undefined;
}

function appendConfigOverlay(existing: string | undefined, overlayPath: string): string {
  const paths = (existing ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== overlayPath);
  return [...paths, overlayPath].join(delimiter);
}

export async function prepareOmpAgentShellEnv(input: {
  config: AgentShellConfig;
  configDir: string;
  env?: Record<string, string>;
}): Promise<Record<string, string>> {
  const shellPath = await resolveOmpAgentShellPath(input.config);
  const overlayPath = join(input.configDir, OMP_DESKTOP_CONFIG_FILENAME);
  await writeFileAtomic(
    overlayPath,
    stringify({
      ...(shellPath ? { shellPath } : {}),
      bashInterceptor: { enabled: true },
    }),
  );
  return {
    ...input.env,
    PI_CONFIG_FILES: appendConfigOverlay(
      input.env?.PI_CONFIG_FILES ?? process.env.PI_CONFIG_FILES,
      overlayPath,
    ),
  };
}
