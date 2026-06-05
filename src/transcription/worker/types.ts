import type { FileOperationExecutor } from "../../engine/FileOperationExecutor.js";
import type { FileWriteManager } from "../../engine/FileWriteManager.js";
import type { Config } from "../../loadConfig.js";
import type { createParseProcessor } from "../../markdown/createParseProcessor.js";
import type { Job, WorkerOptions } from "../types.js";

export type WorkerContext<T extends Job> = {
  getWriteManager: (vaultPath: string) => FileWriteManager;
  getProcessor: (
    vaultPath: string,
  ) => Promise<ReturnType<typeof createParseProcessor>>;
  options: WorkerOptions;
  job: T;
  fileOperations: FileOperationExecutor;
  config: Config;
  debug: ReturnType<typeof import("debug")>;
};

export type JobWorker<T extends Job> = (
  args: WorkerContext<T>,
) => Promise<void>;
