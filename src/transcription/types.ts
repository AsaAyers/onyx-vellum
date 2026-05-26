import { z } from "zod";
import { zVaultFile } from "../engine/FileWriteManager.js";
import type { RootContent } from "mdast";
export const zContentLocation = z.strictObject({
  file: zVaultFile,
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

export const zTranscribeJob = z.object({
  type: z.literal("transcribe"),
  vaultPath: z.string(),
  id: z.string(),
  audioPath: z.string(),
  target: zFileOperation,
  createdAt: z.string().optional(),
});

export const zCleanTranscript = z.object({
  type: z.literal("clean-transcription"),
  vaultPath: z.string(),
  id: z.string(),
  target: zFileOperation,
  source: zContentLocation,
  createdAt: z.string().optional(),
});

export const zSummarizeTextJob = z.object({
  type: z.literal("summarize-text"),
  vaultPath: z.string(),
  id: z.string(),
  target: zFileOperation,
  source: zContentLocation,
  createdAt: z.string().optional(),
});

export const zFindTasksJob = z.object({
  type: z.literal("find-tasks"),
  vaultPath: z.string(),
  id: z.string(),
  target: zFileOperation,
  source: zContentLocation,
  createdAt: z.string().optional(),
});

export const zJob = zTranscribeJob
  .or(zCleanTranscript)
  .or(zSummarizeTextJob)
  .or(zFindTasksJob);

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
});

export type Job = z.infer<typeof zJob>;
export type TranscribeJob = z.infer<typeof zTranscribeJob>;
export type CleanTranscript = z.infer<typeof zCleanTranscript>;
export type SummarizeTextJob = z.infer<typeof zSummarizeTextJob>;
export type FindTasksJob = z.infer<typeof zFindTasksJob>;
export type TranscriberBackend = z.infer<typeof zTranscriberBackend>;
export type WorkerOptions = z.infer<typeof zWorkerOptions>;
