import { VFile } from "vfile";
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
  const file = new VFile({
    path: vaultFile.relativePath,
    value: await fileManager.read(vaultFile),
  });
  const tree = processor.parse(file);
  const children = readFileOperationTarget(tree, source);
  const sourceText = processor.stringify(
    {
      type: "root",
      children,
    },
    file,
  );
  return sourceText;
}
