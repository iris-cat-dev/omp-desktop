import { normalizeLoopbackToLocalhost } from "@omp-desktop/protocol/daemon-endpoints";
import type { ActiveConnection } from "@/runtime/host-runtime";

export function resolveDesktopDefaultTerminalShell(input: {
  activeConnection: ActiveConnection | null;
  loginShell: string | undefined;
}): string | undefined {
  const loginShell = input.loginShell?.trim();
  if (!loginShell || !input.activeConnection) {
    return undefined;
  }

  if (
    input.activeConnection.type === "directSocket" ||
    input.activeConnection.type === "directPipe"
  ) {
    return loginShell;
  }
  if (input.activeConnection.type !== "directTcp") {
    return undefined;
  }

  try {
    const endpoint = normalizeLoopbackToLocalhost(input.activeConnection.endpoint);
    return endpoint.startsWith("localhost:") ? loginShell : undefined;
  } catch {
    return undefined;
  }
}
