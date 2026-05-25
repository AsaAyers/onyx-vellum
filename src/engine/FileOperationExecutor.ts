import yaml from "js-yaml";
import type { Heading, Root, RootContent } from "mdast";
import type { Processor } from "unified";
import { VFile } from "vfile";
import createDebug from "debug";
import { zVaultFile, type FileWriteManager, type VaultFile } from "./io.js";
import { join } from "node:path";
import micromatch from "micromatch";
import type { Source } from "../rules/types.js";
import {
  type ContentLocation,
  type FileOperation,
} from "../transcription/types.js";

const debug = createDebug("onyx:fileOperationExecutor");

export class FileOperationExecutor {
  resetAll() {
    this.fileOperations = {};
  }
  fileOperations: Record<string, FileOperation[]> = {};

  updateFile = (fileOperation: FileOperation) => {
    const filePath = fileOperation.location.file.relativePath;
    this.fileOperations[filePath] ??= [];
    this.fileOperations[filePath].push(fileOperation);
    debug(`Queued file operation for ${filePath}`);
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
      let original: string;
      const file = zVaultFile.parse({
        absolutePath: join(fileManager.vaultPath, relativePath),
        relativePath,
      });
      try {
        original = await fileManager.read(file);
      } catch {
        // Create a new file
        original = "";
      }
      const vfile = new VFile({ path: relativePath, value: original });
      let tree = processor.parse(vfile);
      tree = (await processor.run(tree, vfile)) as Root;

      await applyFileOperations(processor, tree, ops);
      tree = (await processor.run(tree, vfile)) as Root;

      const normalized = String(processor.stringify(tree, vfile));
      if (normalized !== original) {
        fileManager.stage(file, normalized);
      }
    }
  }
}

export function readFileOperationTarget(root: Root, location: ContentLocation) {
  const target = queryFileOperationTarget(root, location);
  if (!target) return [];
  const [parent, childIndex, numDelete] = target;

  return parent.children.slice(childIndex, childIndex + numDelete);
}

/**
 * Determines where to apply a FileOperation in the AST.
 * For header: null, returns [parent, 0, i] where i is the index of the first heading node,
 * or [parent, 0, children.length] if no heading exists (replace whole file).
 * Returns null for unsupported scenarios.
 */
function queryFileOperationTarget(
  processed: Root,
  location: ContentLocation,
): null | [typeof processed, number, number, RootContent[]] {
  const children = processed.children;
  let bodyStart = children.findIndex((n) => n.type !== "yaml");
  if (bodyStart === -1) bodyStart = children.length;

  let firstHeadingIndex = children.findIndex((n) => n.type === "heading");
  const hasHeadings = firstHeadingIndex !== -1;
  if (firstHeadingIndex === -1) firstHeadingIndex = children.length;

  if (location.header === null) {
    if (location.position === "start") {
      // Replace from top up to first header
      return [processed, bodyStart, firstHeadingIndex - bodyStart, []];
    } else if (location.position === "end") {
      return [processed, children.length, 0, []];
    }
  } else if (location.header !== null) {
    const headerNodeIndex = children.findIndex(
      (n) =>
        n.type === "heading" &&
        n.children.some(
          (c) => c.type === "text" && c.value === location.header,
        ),
    );
    if (headerNodeIndex === -1) {
      const newHeader: Heading = {
        type: "heading",
        depth: 1,
        children: [{ type: "text", value: location.header }],
      };
      if (location.position === "start") {
        if (hasHeadings) {
          return [processed, firstHeadingIndex, 0, [newHeader]];
        }
        return [
          processed,
          bodyStart,
          firstHeadingIndex - bodyStart,
          [newHeader],
        ];
      } else {
        return [processed, children.length - 1, 0, [newHeader]];
      }
    } else {
      const headerNode = children[headerNodeIndex] as Heading;
      const depth = headerNode.depth;

      const start = headerNodeIndex + 1;
      const endOfHeaderSection = children.reduce((acc, node, idx) => {
        if (idx <= start) return acc;
        if (node.type === "heading" && node.depth <= depth) {
          return idx;
        }
        return acc;
      }, -1);
      if (endOfHeaderSection === -1) {
        return [processed, start, children.length - start + 1, []];
      }

      return [processed, start, endOfHeaderSection - start, []];
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
    const target = queryFileOperationTarget(processed, op.location);
    if (!target) continue;
    const [parent, childIndex, numDelete, newNodes] = target;

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
    if (newNodes.length > 0) {
      contentNodes.unshift(...newNodes);
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
