import { z } from "zod";

export const zTranscriptionPipelineJob = z.object({
  type: z.literal("transcription-pipeline"),
  id: z.string(),
  audioPath: z.string(),
  transcriptPath: z.string(),
  sourceNotePath: z.string(),
  createdAt: z.string(),
});

export const zTrimDeadAirJob = z.object({
  type: z.literal("trim-dead-air"),
  id: z.string(),
  audioPath: z.string(),
  trimmedAudioPath: z.string(),
  createdAt: z.string(),
});

export const zCleanTextJob = z.object({
  type: z.literal("clean-text"),
  id: z.string(),
  transcriptPath: z.string(),
  createdAt: z.string(),
});

export const zSummarizeTextJob = z.object({
  type: z.literal("summarize-text"),
  id: z.string(),
  transcriptPath: z.string(),
  createdAt: z.string(),
});

export const zFindTasksJob = z.object({
  type: z.literal("find-tasks"),
  id: z.string(),
  transcriptPath: z.string(),
  createdAt: z.string(),
});

export const zJob = zTranscriptionPipelineJob
  .or(zTrimDeadAirJob)
  .or(zCleanTextJob)
  .or(zSummarizeTextJob)
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
export type TrimDeadAirJob = z.infer<typeof zTrimDeadAirJob>;
export type CleanTextJob = z.infer<typeof zCleanTextJob>;
export type SummarizeTextJob = z.infer<typeof zSummarizeTextJob>;
export type FindTasksJob = z.infer<typeof zFindTasksJob>;
export type TranscriberBackend = z.infer<typeof zTranscriberBackend>;
export type WorkerOptions = z.infer<typeof zWorkerOptions>;
