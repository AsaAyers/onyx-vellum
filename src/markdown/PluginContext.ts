import type { UserLocalTime } from "../engine/timezone.js";
import type { FileOperation, Job } from "../transcription/types.js";

export type PluginContext = {
  updateFile(fileOperation: FileOperation): unknown;
  queueJob: (job: Job) => Promise<void>;
  jobIdFactory: (createdAt: Date) => string;
  env: NodeJS.ProcessEnv;
  mode: "normalize" | "all" | "fast" | "alert";
  onlyGlob?: string[];
  dates: UserLocalTime;
  dryRun: boolean;
  vaultPath: string;
};
