import yaml from "js-yaml";
import type { Heading, Root, RootContent } from "mdast";
import type { Processor } from "unified";
import createDebug from "debug";
import { type FileWriteManager } from "./FileWriteManager.js";
import { VaultFile } from "./VaultFile.js";
import path from "node:path";
import micromatch from "micromatch";
import type { Source } from "../rules/types.js";
import {
  zFileOperation,
  type ContentLocation,
  type FileOperation,
} from "../transcription/types.js";
import invariant from "tiny-invariant";

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
        return [processed, children.length, 0, [newHeader]];
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
  file: VaultFile,
  processor: Processor<Root, Root, Root>,
  tree: Root,
  ops: FileOperation[],
) {
  for (const op of ops) {
    const target = queryFileOperationTarget(tree, op.location);
    if (!target) continue;
    const [parent, childIndex, numDelete, newNodes] = target;

    // Prepare new nodes: YAML frontmatter + content
    const { yamlNode, frontmatter } = extractYamlFrontmatter(parent);
    // Overwrite with op.frontmatter
    if (op.frontmatter) {
      yamlNode.value = yaml
        .dump({ ...frontmatter, ...op.frontmatter })
        .trimEnd();
    }

    // Parse op.content into AST nodes
    let contentNodes: RootContent[] = [];
    if (op.content) {
      if (typeof op.content === "string") {
        // Copy the file to avoid overwriting the original content when parsing
        const f = VaultFile.fromVFile(file);
        f.value = op.content;
        let parsed = processor.parse(f);
        parsed = (await processor.run(parsed, f)) as Root;
        contentNodes = parsed.children;
      } else {
        contentNodes = [op.content];
      }
      if (newNodes.length > 0) {
        contentNodes.unshift(...newNodes);
      }
    }

    debug(
      `Applying file operation at ${op.location.file.relativePath} - replacing ${numDelete} nodes with ${contentNodes.length} new nodes`,
    );
    parent.children.splice(childIndex, numDelete, ...contentNodes);
    if (!parent.children.includes(yamlNode)) {
      parent.children.unshift(yamlNode);
    }
    if (yamlNode.value === "") {
      parent.children.splice(parent.children.indexOf(yamlNode), 1);
    }
  }
}

export function extractYamlFrontmatter(parent: Root) {
  let frontmatter: Record<string, unknown> = {};

  const yamlNode: RootContent = parent.children.find(
    (n) => n.type === "yaml",
  ) ?? {
    type: "yaml",
    value: "",
  };

  if (yamlNode.type === "yaml") {
    // Parse and merge
    try {
      frontmatter = (yaml.load(yamlNode.value) || {}) as Record<
        string,
        unknown
      >;
    } catch {
      // skip invalid frontmatter
    }
  }
  return { yamlNode, frontmatter };
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
