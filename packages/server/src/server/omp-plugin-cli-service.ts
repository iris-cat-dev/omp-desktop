import { z } from "zod";

import {
  OmpMarketplacePluginInfoSchema,
  OmpPluginDoctorCheckSchema,
  OmpPluginInfoSchema,
} from "@omp-desktop/protocol/messages";

import type { Logger } from "pino";
import { execCommand } from "../utils/spawn.js";
import { findExecutable } from "../executable-resolution/executable-resolution.js";

/**
 * Thin wrapper around the OMP runtime's own `omp plugin <action>` CLI.
 *
 * The OMP runtime is the plugin authority: it owns discovery, manifest
 * handling, feature gating and health checks. OMP Desktop only shells out to
 * the CLI, normalizes its JSON output, and reports results. No plugin format,
 * state store, or loader is implemented here — that is the daemon plugin
 * runtime's separate concern (and a different upstream feature area).
 */

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const ACTION_TIMEOUT_MS = 60 * 1000;
const DOCTOR_TIMEOUT_MS = 120 * 1000;
const MAX_OUTPUT_CHARS = 8 * 1024;

export type OmpPluginRunner = (
  command: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

/** Minimal surface the service needs so tests can stub the runner. */
export interface OmpPluginCliServiceOptions {
  logger: Logger;
  /** Defaults to the real execCommand-backed runner. */
  runner?: OmpPluginRunner;
  /** Defaults to resolving `omp` via OMP_COMMAND env or PATH lookup. */
  resolveOmpCommand?: () => Promise<string | null>;
}

const OmpPluginListJsonSchema = z
  .object({
    // `npm` is required: without it the defaults would accept any object,
    // including the bare plugin object `omp plugin install` prints.
    npm: z.array(OmpPluginInfoSchema),
    marketplace: z.array(OmpMarketplacePluginInfoSchema).default([]),
  })
  .passthrough();

const OmpPluginDoctorJsonSchema = z.array(OmpPluginDoctorCheckSchema);

const TrailingJsonSchema = z.object({
  npm: z.array(OmpPluginInfoSchema),
  marketplace: z.array(OmpMarketplacePluginInfoSchema).default([]),
});

function truncateOutput(value: string): string {
  const combined = value.trim();
  return combined.length <= MAX_OUTPUT_CHARS ? combined : combined.slice(-MAX_OUTPUT_CHARS);
}

/** Parses the JSON payload out of CLI stdout even when progress lines precede it. */
function parseTrailingJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lastBrace = trimmed.lastIndexOf("}");
    const lastBracket = trimmed.lastIndexOf("]");
    const end = Math.max(lastBrace, lastBracket);
    if (end === -1) return null;
    const start = trimmed.search(/[[{]/);
    if (start === -1 || start >= end) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function extractPluginName(spec: string): string {
  // "pi-memory@1.2.0" -> "pi-memory"; "@scope/name@2.0.0" -> "@scope/name".
  const atSlash = spec.indexOf("@");
  if (atSlash === 0) {
    const versionAt = spec.indexOf("@", 1);
    return versionAt === -1 ? spec : spec.slice(0, versionAt);
  }
  const versionAt = spec.indexOf("@");
  return versionAt === -1 ? spec : spec.slice(0, versionAt);
}

export class OmpPluginOperationInProgressError extends Error {
  constructor() {
    super("Another OMP plugin operation is already in progress");
    this.name = "OmpPluginOperationInProgressError";
  }
}

export class OmpPluginUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ?? "OMP CLI is not available on this host");
    this.name = "OmpPluginUnavailableError";
  }
}

export interface OmpPluginListResult {
  plugins: z.infer<typeof OmpPluginInfoSchema>[];
  marketplace: z.infer<typeof OmpMarketplacePluginInfoSchema>[];
  rawOutput?: string;
}

export interface OmpPluginDoctorResult {
  checks: z.infer<typeof OmpPluginDoctorCheckSchema>[];
  rawOutput?: string;
}

export interface OmpPluginMutateResult {
  ok: boolean;
  plugin?: z.infer<typeof OmpPluginInfoSchema> | null;
  output?: string;
}

export class OmpPluginCliService {
  private readonly logger: Logger;
  private readonly runner: OmpPluginRunner;
  private readonly resolveOmpCommand: () => Promise<string | null>;
  private inFlight: Promise<unknown> | null = null;

  constructor(options: OmpPluginCliServiceOptions) {
    this.logger = options.logger.child({ module: "omp-plugin-cli" });
    this.runner =
      options.runner ??
      (async (command, args, runnerOptions) =>
        await execCommand(command, args, {
          timeout: runnerOptions.timeout,
          envMode: "internal",
        }));
    this.resolveOmpCommand =
      options.resolveOmpCommand ??
      (async () => process.env.OMP_COMMAND?.trim() || (await findExecutable("omp")) || null);
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.inFlight) {
      throw new OmpPluginOperationInProgressError();
    }
    this.inFlight = operation().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight as Promise<T>;
  }
  private async runCli(args: string[], timeout: number): Promise<string> {
    const command = await this.resolveOmpCommand();
    if (!command) {
      throw new OmpPluginUnavailableError();
    }
    try {
      const result = await this.runner(command, ["plugin", ...args], { timeout });
      return `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const output = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").trim();
      throw new Error(output || `omp plugin ${args[0]} failed`, { cause: error });
    }
  }

  async list(): Promise<OmpPluginListResult> {
    return this.runExclusive(async () => {
      const output = await this.runCli(["list", "--json"], ACTION_TIMEOUT_MS);
      const parsed = OmpPluginListJsonSchema.safeParse(parseTrailingJson(output));
      if (parsed.success) {
        return { plugins: parsed.data.npm, marketplace: parsed.data.marketplace };
      }
      this.logger.warn({ output: output.slice(0, 500) }, "Unparseable omp plugin list output");
      return { plugins: [], marketplace: [], rawOutput: truncateOutput(output) };
    });
  }

  async install(input: {
    spec: string;
    scope?: "user" | "project";
    dryRun?: boolean;
  }): Promise<OmpPluginMutateResult> {
    return this.runExclusive(async () => {
      const args = ["install", input.spec, "--json"];
      if (input.scope) args.push("--scope", input.scope);
      if (input.dryRun) args.push("--dry-run");
      let output: string;
      try {
        output = await this.runCli(args, INSTALL_TIMEOUT_MS);
      } catch (error) {
        return { ok: false, output: truncateOutput((error as Error).message) };
      }
      const json = parseTrailingJson(output);
      const asList = TrailingJsonSchema.safeParse(json);
      if (asList.success) {
        const name = extractPluginName(input.spec);
        const plugin = asList.data.npm.find((entry) => entry.name === name) ?? null;
        return { ok: true, plugin, output: truncateOutput(output) };
      }
      // Some omp versions print the installed plugin object itself.
      const asPlugin = OmpPluginInfoSchema.safeParse(json);
      if (asPlugin.success) {
        return { ok: true, plugin: asPlugin.data, output: truncateOutput(output) };
      }
      return { ok: true, plugin: null, output: truncateOutput(output) };
    });
  }

  async remove(name: string): Promise<{ ok: boolean; output?: string }> {
    return this.runExclusive(async () => {
      try {
        const output = await this.runCli(["uninstall", name], ACTION_TIMEOUT_MS);
        return { ok: true, output: truncateOutput(output) };
      } catch (error) {
        return { ok: false, output: truncateOutput((error as Error).message) };
      }
    });
  }

  async setEnabled(name: string, enabled: boolean): Promise<{ ok: boolean }> {
    return this.runExclusive(async () => {
      try {
        await this.runCli([enabled ? "enable" : "disable", name], ACTION_TIMEOUT_MS);
      } catch (error) {
        this.logger.warn({ err: error, name, enabled }, "omp plugin enable/disable failed");
        return { ok: false };
      }
      // Verify the lockfile actually changed: the CLI can exit 0 silently.
      try {
        const output = await this.runCli(["list", "--json"], ACTION_TIMEOUT_MS);
        const parsed = OmpPluginListJsonSchema.safeParse(parseTrailingJson(output));
        const entry = parsed.success
          ? parsed.data.npm.find((item) => item.name === name)
          : undefined;
        return { ok: entry?.enabled === enabled };
      } catch {
        return { ok: false };
      }
    });
  }

  async doctor(input?: { fix?: boolean }): Promise<OmpPluginDoctorResult> {
    return this.runExclusive(async () => {
      const args = ["doctor", "--json"];
      if (input?.fix) args.push("--fix");
      const output = await this.runCli(args, DOCTOR_TIMEOUT_MS);
      const parsed = OmpPluginDoctorJsonSchema.safeParse(parseTrailingJson(output));
      if (parsed.success) {
        return { checks: parsed.data };
      }
      return { checks: [], rawOutput: truncateOutput(output) };
    });
  }
}
