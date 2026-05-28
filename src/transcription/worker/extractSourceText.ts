import { resolveTarget } from "../../engine/resolveTarget.js";
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
  const target = resolveTarget(tree, source);
  let children: import("mdast").RootContent[] = [];
  if (target) {
    const startIdx = target.startNode
      ? tree.children.indexOf(target.startNode)
      : tree.children.length;
    children = tree.children.slice(startIdx, startIdx + target.deleteCount);
  }
  const sourceText = processor.stringify(
    {
      type: "root",
      children,
    },
    vaultFile,
  );
  return sourceText;
}
