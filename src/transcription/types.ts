import { z } from "zod";
import { zVaultFile } from "../engine/io.js";
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

export const zTranscriptionPipelineJob = z.object({
  type: z.literal("transcription-pipeline"),
  vaultPath: z.string(),
  id: z.string(),
  audioPath: z.string(),
  transcriptPath: z.string(),
  sourceNotePath: z.string(),
  createdAt: z.string().optional(),
});
export const zTranscribeJob = z.object({
  type: z.literal("transcribe"),
  vaultPath: z.string(),
  id: z.string(),
  audioPath: z.string(),
  target: zFileOperation,
  createdAt: z.string().optional(),
});

export const zCleanTextJob = z.object({
  type: z.literal("clean-text"),
  vaultPath: z.string(),
  id: z.string(),
  transcriptPath: z.string(),
  target: zFileOperation,
  source: zContentLocation,
  createdAt: z.string().optional(),
});

export const zSummarizeTextJob = z.object({
  type: z.literal("summarize-text"),
  vaultPath: z.string(),
  id: z.string(),
  destination: zFileOperation,
  source: zContentLocation,
  createdAt: z.string().optional(),
});

export const zFindTasksJob = z.object({
  type: z.literal("find-tasks"),
  vaultPath: z.string(),
  id: z.string(),
  transcriptPath: z.string(),
  target: zFileOperation,
  source: zContentLocation,
  createdAt: z.string().optional(),
});

export const zJob = zTranscriptionPipelineJob
  .or(zCleanTextJob)
  .or(zSummarizeTextJob)
  .or(zTranscribeJob)
  .or(zFindTasksJob);

export const zTranscriberBackend = z.object({
  transcribe: z.function().args(z.string()).returns(z.promise(z.string())),
});

export const zWorkerOptions = z.object({
  ollamaHost: z.string().optional(),
  trimDeadAir: z.boolean().optional(),
  stateDir: z.string(),
  backend: zTranscriberBackend,
  pollIntervalMs: z.number().optional(),
  shouldContinue: z.function().returns(z.boolean()).optional(),
  logger: z.object({ error: z.function() }).optional(),
  sleep: z.function().args(z.number()).returns(z.promise(z.void())).optional(),
});

export type Job = z.infer<typeof zJob>;
export type TranscriptionPipelineJob = z.infer<
  typeof zTranscriptionPipelineJob
>;
export type TranscribeJob = z.infer<typeof zTranscribeJob>;
export type CleanTextJob = z.infer<typeof zCleanTextJob>;
export type SummarizeTextJob = z.infer<typeof zSummarizeTextJob>;
export type FindTasksJob = z.infer<typeof zFindTasksJob>;
export type TranscriberBackend = z.infer<typeof zTranscriberBackend>;
export type WorkerOptions = z.infer<typeof zWorkerOptions>;
