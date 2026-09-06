import { Command, Option } from "commander";
import { startCommand } from "./start.js";
import { runStatusCommand } from "./status.js";
import { runStopCommand } from "./stop.js";
import { runRestartCommand } from "./restart.js";
import { runSetPasswordCommand } from "./set-password.js";
import { runDaemonReloadCommand } from "./reload.js";
import { pairCommand } from "./pair.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addJsonOption } from "../../utils/command-options.js";

function resolveHostnamesOption(hostnames: unknown, allowedHosts: unknown): string | undefined {
  if (typeof hostnames === "string") return hostnames;
  if (typeof allowedHosts === "string") return allowedHosts;
  return undefined;
}

export function createDaemonCommand(): Command {
  const daemon = new Command("daemon").description("Manage the OMP Desktop daemon");

  daemon.addCommand(startCommand());
  daemon.addCommand(pairCommand());

  addJsonAndDaemonHostOptions(
    daemon.command("reload").description("Reload config.json without restarting the daemon"),
  ).action(withOutput(runDaemonReloadCommand));

  addJsonOption(daemon.command("status").description("Show local daemon status"))
    .option("--home <path>", "OMP Desktop home directory (default: ~/.omp-desktop)")
    .action(withOutput(runStatusCommand));

  addJsonOption(daemon.command("stop").description("Stop the local daemon"))
    .option("--home <path>", "OMP Desktop home directory (default: ~/.omp-desktop)")
    .option("--timeout <seconds>", "Wait timeout before failing (default: 15)")
    .option("--force", "Send SIGKILL if graceful stop times out")
    .option("--kill-timeout <seconds>", "Wait after SIGKILL before failing (default: 3)")
    .action(withOutput(runStopCommand));

  addJsonOption(daemon.command("restart").description("Restart the local daemon"))
    .option("--home <path>", "OMP Desktop home directory (default: ~/.omp-desktop)")
    .option("--timeout <seconds>", "Wait timeout before force step (default: 15)")
    .option("--force", "Send SIGKILL if graceful stop times out")
    .option(
      "--listen <listen>",
      "Listen target for restarted daemon (host:port, port, or unix socket)",
    )
    .option("--port <port>", "Port for restarted daemon listen target")
    .option("--relay", "Enable outbound encrypted relay access on restarted daemon")
    .option("--no-relay", "Disable outbound relay access on restarted daemon")
    .option("--relay-use-tls", "Use TLS for the outbound relay connection")
    .option(
      "--no-relay-use-tls",
      "Disable TLS for the outbound relay connection (E2EE remains enabled)",
    )
    .option("--no-mcp", "Disable Agent MCP on restarted daemon")
    .option("--no-inject-mcp", "Disable auto-injecting OMP Desktop tools into created agents")
    .option("--web-ui", "Enable the bundled daemon web UI on restarted daemon")
    .option("--no-web-ui", "Disable the bundled daemon web UI on restarted daemon")
    .option(
      "--hostnames <hosts>",
      'Daemon hostnames (comma-separated, e.g. "myhost,.example.com" or "true" for any)',
    )
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .action(
      withOutput((...args) => {
        const [options, command] = args.slice(-2) as [(typeof args)[number], Command];
        return runRestartCommand(
          {
            ...options,
            hostnames: resolveHostnamesOption(options.hostnames, options.allowedHosts),
          },
          command,
        );
      }),
    );

  addJsonOption(
    daemon
      .command("set-password")
      .description("Prompt for and save a hashed daemon password to config.json"),
  )
    .option("--home <path>", "OMP Desktop home directory (default: ~/.omp-desktop)")
    .action(withOutput(runSetPasswordCommand));

  return daemon;
}
