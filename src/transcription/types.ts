export type Job =
  | TranscriptionPipelineJob
  | TrimDeadAirJob
  | CleanTextJob
  | SummarizeTextJob
  | FindTasksJob;

export type TranscriptionPipelineJob = {
  type: "transcription-pipeline";
  id: string;
  audioPath: string;
  transcriptPath: string;
  sourceNotePath: string;
  createdAt: string;
};

export type TrimDeadAirJob = {
  type: "trim-dead-air";
  id: string;
  audioPath: string;
  trimmedAudioPath: string;
  createdAt: string;
};

export type CleanTextJob = {
  type: "clean-text";
  id: string;
  transcriptPath: string;
  createdAt: string;
};

export type SummarizeTextJob = {
  type: "summarize-text";
  id: string;
  transcriptPath: string;
  createdAt: string;
};

export type FindTasksJob = {
  type: "find-tasks";
  id: string;
  transcriptPath: string;
  createdAt: string;
};

export type TranscriberBackend = {
  transcribe(audioPath: string): Promise<string>;
};

export type WorkerOptions = {
  ollamaHost?: string;
  trimDeadAir?: boolean;
  stateDir: string;
  backend: TranscriberBackend;
  pollIntervalMs?: number;
  shouldContinue?: () => boolean;
  logger?: Pick<Console, "error">;
  sleep?: (ms: number) => Promise<void>;
};
