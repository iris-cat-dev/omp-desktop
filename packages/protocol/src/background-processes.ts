import { z } from "zod";

export const BackgroundProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  cwd: z.string(),
  ownerAgentId: z.string().nullable(),
  scope: z.enum(["agent", "workspace"]),
  source: z.enum(["omp-daemon", "omp-job", "terminal"]),
  status: z.enum([
    "starting",
    "running",
    "ready",
    "restarting",
    "stopping",
    "exited",
    "failed",
    "cancelled",
    "unknown",
  ]),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  exitCode: z.number().int().nullable(),
  terminalId: z.string().nullable(),
});
export type BackgroundProcess = z.infer<typeof BackgroundProcessSchema>;

/** Cursor is opaque to consumers. A reset replaces, rather than appends to, the terminal buffer. */
export const BackgroundProcessOutputSchema = z.object({
  text: z.string(),
  cursor: z.number().int().nonnegative(),
  reset: z.boolean(),
  truncated: z.boolean(),
  /** Pipe output needs LF-to-CRLF rendering; PTY bytes must remain untouched. */
  format: z.enum(["text", "terminal"]).optional(),
});
export type BackgroundProcessOutput = z.infer<typeof BackgroundProcessOutputSchema>;

export const BackgroundProcessListRequestSchema = z.object({
  type: z.literal("agent.background_processes.list.request"),
  agentId: z.string(),
  requestId: z.string(),
});
export const BackgroundProcessOutputRequestSchema = z.object({
  type: z.literal("agent.background_processes.output.request"),
  agentId: z.string(),
  processId: z.string(),
  cursor: z.number().int().nonnegative().optional(),
  requestId: z.string(),
});
export const BackgroundProcessListResponseSchema = z.object({
  type: z.literal("agent.background_processes.list.response"),
  payload: z.object({
    requestId: z.string(),
    processes: z.array(BackgroundProcessSchema),
    error: z.string().nullable(),
  }),
});
export const BackgroundProcessOutputResponseSchema = z.object({
  type: z.literal("agent.background_processes.output.response"),
  payload: z.object({
    requestId: z.string(),
    output: BackgroundProcessOutputSchema.nullable(),
    error: z.string().nullable(),
  }),
});
