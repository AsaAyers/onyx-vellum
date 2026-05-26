import type { FileOperationExecutor } from "../../engine/FileOperationExecutor.js";
import type { FileWriteManager } from "../../engine/io.js";
import type { createParseProcessor } from "../../markdown/parse.js";
import type { Job, WorkerOptions } from "../types.js";

export type WorkerContext<T extends Job> = {
  getWriteManager: (vaultPath: string) => FileWriteManager;
  getProcessor: (
    vaultPath: string,
  ) => Promise<ReturnType<typeof createParseProcessor>>;
  options: WorkerOptions;
  job: T;
  fileOperations: FileOperationExecutor;
  debug: ReturnType<typeof import("debug")>;
};

export type JobWorker<T extends Job> = (
  args: WorkerContext<T>,
) => Promise<void>;
