import { z } from "zod";
import { VaultFile } from "../engine/VaultFile.js";
import type { RootContent } from "mdast";
export const zContentLocation = z.strictObject({
  file: VaultFile.schema,
  position: z.enum(["start", "end"]),
  header: z.string().nullable(),
});

export type ContentLocation = z.infer<typeof zContentLocation>;

export const zFileOperation = z.object({
  location: zContentLocation,
  frontmatter: z.record(z.string(), z.any()).optional(),
  content: z
    .union([
      z.string(),
      z.custom<RootContent>((val) => {
        if (
          typeof val === "object" &&
          val !== null &&
          "type" in val &&
          typeof val.type === "string"
        ) {
          return val as RootContent;
        }
        return null;
      }),
    ])
    .optional(),
});

export type FileOperation = z.infer<typeof zFileOperation>;

export const zBaseJob = z.object({
  vaultPath: z.string(),
  id: z.string(),
  target: zFileOperation,
  createdAt: z.string().optional(),
});

export const zTranscribeJob = zBaseJob.extend({
  type: z.literal("transcribe"),
  audioPath: z.string(),
});

export const zCleanTranscript = zBaseJob.extend({
  type: z.literal("clean-transcription"),
  source: zContentLocation,
});

export const zSummarizeTextJob = zBaseJob.extend({
  type: z.literal("summarize-text"),
  source: zContentLocation,
});

export const zFindTasksJob = zBaseJob.extend({
  type: z.literal("find-tasks"),
  source: zContentLocation,
});

export const zJob = z.union([
  zTranscribeJob,
  zCleanTranscript,
  zSummarizeTextJob,
  zFindTasksJob,
]);

export const zTranscriberBackend = z.object({
  transcribe: z.function().args(z.string()).returns(z.promise(z.string())),
});

export const zWorkerOptions = z.object({
  ollamaHost: z.string().optional(),
  trimDeadAir: z.boolean().optional(),
  stateDir: z.string(),
  getWhisperBackend: z.function().returns(zTranscriberBackend),
  pollIntervalMs: z.number().optional(),
  shouldContinue: z.function().returns(z.boolean()).optional(),
  logger: z.object({ error: z.function() }).optional(),
  sleep: z.function().args(z.number()).returns(z.promise(z.void())).optional(),
  onEvent: z.function().args(z.any()).returns(z.void()).optional(),
});

export type Job = z.infer<typeof zJob>;
export type TranscribeJob = z.infer<typeof zTranscribeJob>;
export type CleanTranscript = z.infer<typeof zCleanTranscript>;
export type SummarizeTextJob = z.infer<typeof zSummarizeTextJob>;
export type FindTasksJob = z.infer<typeof zFindTasksJob>;
export type TranscriberBackend = z.infer<typeof zTranscriberBackend>;
export type WorkerOptions = z.infer<typeof zWorkerOptions>;

export type WorkerEvent =
  | { type: "started" }
  | { type: "recovery-complete"; recovered: number }
  | { type: "poll-idle" }
  | { type: "job-started"; jobId: string; jobType: string; detail: string }
  | { type: "job-completed"; jobId: string; jobType: string; detail: string }
  | {
      type: "job-failed";
      jobId: string;
      jobType: string;
      detail: string;
      error: string;
    };
