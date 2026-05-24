import type { Job } from "../../transcription/types.js";

export type LinkActionContext = {
  vaultPath: string;
  sourceNotePath: string;
  today: Date;
  jobIdFactory: (createdAt: Date) => string;
};

export type ActionOutcome = {
  /** Modified (or unchanged) task text. */
  text: string;
  /** When true, the task should be unchecked after the action. */
  uncheck?: boolean;
  /** When set, a new task with this text is inserted after the original. */
  insertDuplicateAfter?: string;
  /** When true, the task is removed from the document. */
  remove?: boolean;
  /** Updated body of the source note (link actions only). */
  updatedBody?: string;
  /** New files to create, keyed by absolute path (link actions only). */
  newFiles?: Record<string, string>;
  /** Transcription jobs to enqueue (link actions only). */
  transcriptionJobs?: Job[];
};
