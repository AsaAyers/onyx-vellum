import type { Root } from "mdast";
import type { Processor } from "unified";
import { VaultFile } from "./VaultFile.js";
import createDebug from "debug";
import { type FileWriteManager } from "./FileWriteManager.js";
import path from "node:path";
import micromatch from "micromatch";
import type { Source } from "../rules/types.js";
import { zFileOperation, type FileOperation } from "../transcription/types.js";
import invariant from "tiny-invariant";
import { applyFileOperations } from "./applyFileOperations.js";

const debug = createDebug("onyx:fileOperationExecutor");

export class FileOperationExecutor {
  resetAll() {
    this.fileOperations = {};
  }
  fileOperations: Record<string, FileOperation[]> = {};

  updateFile = (op: FileOperation) => {
    const fileOperation = zFileOperation.parse(op);
    const relativePath = fileOperation.location.file.relativePath;
    invariant(relativePath, `File operation missing relative path`);
    this.fileOperations[relativePath] ??= [];
    this.fileOperations[relativePath].push(fileOperation);
    debug(`Queued file operation for ${relativePath}`);
  };

  hasPendingOperations() {
    return Object.keys(this.fileOperations).length > 0;
  }

  async execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processor: Processor<Root, Root, Root, any, any>,
    fileManager: FileWriteManager,
  ) {
    const fileOperationsEntries = Object.entries(this.fileOperations);
    this.fileOperations = {}; // Clear pending operations before execution to allow new ops to be queued during execution
    for (const [relativePath, ops] of fileOperationsEntries) {
      invariant(relativePath, `File operation missing relative path`);
      invariant(
        !path.isAbsolute(relativePath),
        `relativePath must be relative`,
      );
      const file = ops[0].location.file;
      try {
        file.value = await fileManager.read(file);
      } catch {
        // Create a new file
        file.value = "";
      }
      let tree = processor.parse(file);
      tree = (await processor.run(tree, file)) as Root;

      await applyFileOperations(file, processor, tree, ops);
      tree = (await processor.run(tree, file)) as Root;

      const normalized = String(processor.stringify(tree, file));
      if (normalized !== file.value) {
        fileManager.stage(file, normalized);
      }
    }
  }
}

export function fileMatchesSources(
  file: VaultFile,
  sources: Source[],
): boolean {
  const relPath = file.relativePath;
  for (const src of sources) {
    if (src.type === "glob" && src.pattern) {
      if (micromatch.isMatch(relPath, src.pattern)) {
        if (
          src.exclude &&
          src.exclude.some((ex: string) => micromatch.isMatch(relPath, ex))
        ) {
          continue;
        }
        return true;
      }
    } else if (src.type === "path" && src.value) {
      if (relPath === src.value) return true;
    }
  }
  return false;
}
