import { readFileOperationTarget } from "../../engine/FileOperationExecutor.js";
import type { ContentLocation, Job } from "../types.js";
import type { WorkerContext } from "./types.js";

export async function extractSourceText(
  vaultPath: string,
  source: ContentLocation,
  workerContext: WorkerContext<Job>,
) {
  const vaultFile = source.file;
  const fileManager = workerContext.getWriteManager(vaultPath);
  const processor = await workerContext.getProcessor(vaultPath);
  vaultFile.value = await fileManager.read(vaultFile);
  const tree = processor.parse(vaultFile);
  const children = readFileOperationTarget(tree, source);
  const sourceText = processor.stringify(
    {
      type: "root",
      children,
    },
    vaultFile,
  );
  return sourceText;
}
