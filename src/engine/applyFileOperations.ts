import type { Processor } from "unified";
import type { Root } from "mdast";
import createDebug from "debug";
import { VaultFile } from "./VaultFile.js";
import { resolveTarget } from "./resolveTarget.js";
import { mergeFrontmatter } from "./mergeFrontmatter.js";
import { spliceContent } from "./spliceContent.js";
import type { FileOperation } from "../transcription/types.js";

const debug = createDebug("onyx:applyFileOperations");

export async function applyFileOperations(
  file: VaultFile,
  processor: Processor<Root, Root, Root>,
  tree: Root,
  ops: FileOperation[],
) {
  for (const op of ops) {
    const target = resolveTarget(tree, op.location);
    if (!target) continue;

    if (op.frontmatter) {
      mergeFrontmatter(tree, op.frontmatter);
    }

    if (op.content) {
      await spliceContent(target, file, processor, op.content);
    }

    debug(
      `Applied operation at ${op.location.file.relativePath} (header: ${op.location.header})`,
    );
  }
}
