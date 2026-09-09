// This module is provided by OMP's compiled extension loader, not by the
// desktop Node process. Keep the observer's dependency surface explicit.
declare module "@oh-my-pi/pi-coding-agent/async" {
  export interface AsyncJob {
    id: string;
    type: string;
    label: string;
    status: "running" | "completed" | "failed" | "cancelled";
    startTime: number;
    ownerId?: string;
    resultText?: string;
    promise: Promise<void>;
    errorText?: string;
    latestDetails?: { exitCode?: number };
  }
  export interface AsyncJobRegisterOptions {
    ownerId?: string;
    onProgress?: (text: string, details?: Record<string, unknown>) => void | Promise<void>;
  }
  export class AsyncJobManager {
    static instance(): AsyncJobManager | undefined;
    register(type: string, label: string, run: unknown, options?: AsyncJobRegisterOptions): string;
    getJob(id: string): AsyncJob | undefined;
  }
}
