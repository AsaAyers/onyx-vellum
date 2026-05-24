import type { FileOperation } from "../engine/FileOperationExecutor.js";
import type { VaultFile } from "../engine/io.js";
import type { UserLocalTime } from "../engine/timezone.js";
import type { Job } from "../transcription/types.js";

export type PluginContext = {
  updateFile(file: VaultFile, arg1: FileOperation): unknown;
  queueJob: (job: Job) => Promise<void>;
  jobIdFactory: (createdAt: Date) => string;
  env: NodeJS.ProcessEnv;
  mode: "normalize" | "all" | "fast" | "alert";
  onlyGlob?: string[];
  dates: UserLocalTime;
  dryRun: boolean;
  vaultPath: string;
};
