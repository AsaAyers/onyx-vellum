import type { FileOperationExecutor } from "../engine/FileOperationExecutor.js";
import type { UserLocalTime } from "../engine/userLocalTime.js";
import type { Job } from "../transcription/types.js";

export type PluginContext = {
  updateFile: FileOperationExecutor["updateFile"];
  queueJob: (job: Job) => void;
  jobIdFactory: (createdAt: Date) => string;
  env: NodeJS.ProcessEnv;
  mode: "normalize" | "all" | "fast" | "alert";
  onlyGlob?: string[];
  dates: UserLocalTime;
  dryRun: boolean;
  vaultPath: string;
  verbose?: boolean;
  report?: (msg: string) => void;
};
