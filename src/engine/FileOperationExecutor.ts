import yaml from "js-yaml";
import type { Root, RootContent } from "mdast";
import fs from "node:fs/promises";
import type { Processor } from "unified";
import { VFile } from "vfile";
import type { FileOperation } from "../markdown/parse.js";

export class FileOperationExecutor {
  fileOperations: Record<string, FileOperation[]> = {};

  updateFile: (transcriptPath: string, fileOperation: FileOperation) => void = (
    transcriptPath: string,
    fileOperation: FileOperation,
  ) => {
    this.fileOperations[transcriptPath] ??= [];
    this.fileOperations[transcriptPath].push(fileOperation);
  };

  async execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processor: Processor<Root, Root, Root, any, any>,
    changes: Array<{ path: string; content: string }>,
  ) {
    const fileOperationsEntries = Object.entries(this.fileOperations);
    this.fileOperations = {}; // Clear pending operations before execution to allow new ops to be queued during execution
    for (const [filePath, ops] of fileOperationsEntries) {
      let original: string;
      try {
        original = await fs.readFile(filePath, "utf-8");
      } catch {
        // Create a new file
        original = "";
      }
      const vfile = new VFile({ path: filePath, value: original });
      let tree = processor.parse(vfile);
      tree = (await processor.run(tree, vfile)) as Root;

      await applyFileOperations(processor, tree, ops);
      tree = (await processor.run(tree, vfile)) as Root;

      const normalized = String(processor.stringify(tree, vfile));
      if (normalized !== original) {
        changes.push({ path: filePath, content: normalized });
      }
    }
  }
}

/**
 * Determines where to apply a FileOperation in the AST.
 * For header: null, returns [parent, 0, i] where i is the index of the first heading node,
 * or [parent, 0, children.length] if no heading exists (replace whole file).
 * Returns null for unsupported scenarios.
 */
function queryFileOperationTarget(
  processed: Root,
  op: FileOperation,
): null | [typeof processed, number, number] {
  if (op.header === null) {
    // Find first heading node
    const children = processed.children;

    if (op.position === "start") {
      const firstHeaderIdx = children.findIndex((n) => n.type === "heading");
      const bodyStart = children.findIndex((n) => n.type !== "yaml") + 1;

      if (firstHeaderIdx === -1) {
        // No header: replace whole file
        return [processed, bodyStart, children.length];
      } else {
        // Replace from top up to first header
        return [processed, bodyStart, firstHeaderIdx];
      }
    } else if (op.position === "end") {
      return [processed, children.length, 0];
    }
  }
  // Not supported yet
  return null;
}

/**
 * Applies FileOperations to the AST, using queryFileOperationTarget to find the region to replace.
 * Handles YAML frontmatter merging/creation, and parses op.content into AST nodes.
 */
async function applyFileOperations(
  processor: Processor<Root, Root, Root>,
  processed: Root,
  ops: FileOperation[],
) {
  for (const op of ops) {
    const target = queryFileOperationTarget(processed, op);
    if (!target) continue;
    const [parent, childIndex, numDelete] = target;

    // Prepare new nodes: YAML frontmatter + content
    let existingFrontmatter: Record<string, unknown> = {};

    const yamlNode: RootContent = parent.children.find(
      (n) => n.type === "yaml",
    ) ?? {
      type: "yaml",
      value: "",
    };

    if (yamlNode.type === "yaml") {
      // Parse and merge
      try {
        existingFrontmatter = (yaml.load(yamlNode.value) || {}) as Record<
          string,
          unknown
        >;
      } catch {
        // skip invalid frontmatter
      }
    }
    // Overwrite with op.frontmatter
    if (op.frontmatter) {
      yamlNode.value = yaml
        .dump({ ...existingFrontmatter, ...op.frontmatter })
        .trimEnd();
    }

    // Parse op.content into AST nodes
    let contentNodes: RootContent[] = [];
    if (op.content) {
      if (typeof op.content === "string") {
        // Use mdast-util-from-markdown to parse content
        let parsed = processor.parse(op.content.trim());
        parsed = (await processor.run(parsed)) as Root;
        contentNodes = parsed.children;
      } else {
        contentNodes = [op.content];
      }
    }

    parent.children.splice(childIndex, numDelete, ...contentNodes);
    if (!parent.children.includes(yamlNode)) {
      parent.children.unshift(yamlNode);
    }
    if (yamlNode.value === "") {
      parent.children.splice(parent.children.indexOf(yamlNode), 1);
    }
  }
}
