import type { FileOperationExecutor } from "../engine/FileOperationExecutor.js";
import type { UserLocalTime } from "../engine/timezone.js";
import type { Job } from "../transcription/types.js";

export type PluginContext = {
  updateFile: FileOperationExecutor["updateFile"];
  queueJob: (job: Job) => Promise<void>;
  jobIdFactory: (createdAt: Date) => string;
  env: NodeJS.ProcessEnv;
  mode: "normalize" | "all" | "fast" | "alert";
  onlyGlob?: string[];
  dates: UserLocalTime;
  dryRun: boolean;
  vaultPath: string;
};
