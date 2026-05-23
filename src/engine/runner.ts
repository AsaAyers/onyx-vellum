import yaml from "js-yaml";
import { createPatch } from "diff";
import fs from "node:fs/promises";
import fsPath, { relative } from "node:path";
import {
  createParseProcessor,
  type PluginContext,
  type FileOperation,
} from "../markdown/parse.js";
import { walkMarkdownFiles } from "./io.js";
import type { RuleContext, Source } from "../rules/types.js";
import { loadConfig, type Config } from "../config.js";
import micromatch from "micromatch";
import type { Root, RootContent } from "mdast";
import { EMPTY_CONFIG } from "../markdown/defaultConfig.js";
import { VFile } from "vfile";
import { buildJobId } from "../transcription/queue.js";
import { resolveStateDir } from "../transcription/runtime.js";
import { enqueue } from "../transcription/queue.js";
import type { Processor } from "unified";
// Utility: Check if a file matches any of the sources (glob/path)

export function fileMatchesSources(
  filePath: string,
  sources: Source[],
  vaultPath: string,
): boolean {
  const relPath = filePath.startsWith(vaultPath)
    ? filePath.slice(vaultPath.length + 1)
    : filePath;
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

/**
 * Run all registered rules against the vault.
 *
 * A single FileWriteManager (transform queue) is shared across every rule:
 *   - Reads go through the queue so staged changes from earlier rules are
 *     immediately visible to later ones, even in dry-run mode.
 *   - Writes are queued throughout the run and flushed once at the end.
 *
 * Dry-run mode: no files are written; a unified diff is printed to stdout for
 * each file that would change, sorted by path.  Rule-progress logs and the run
 * summary are suppressed unless `verbose` is also true.
 *
 * @param baseCtx  All RuleContext fields except `readFile` (wired internally).
 * @returns        `changes` — staged file writes (path + content), sorted by path.
 *                 `report`  — everything printed to console during the run.
 */
export async function runAllRules(
  baseCtx: Omit<RuleContext, "readFile" | "jobIdFactory"> & {
    jobIdFactory?: RuleContext["jobIdFactory"];
  },
): Promise<{
  changes: Array<{ path: string; content: string }>;
  report: string;
}> {
  const lines: string[] = [];
  const log = (msg: string): void => {
    // console.log(msg);
    lines.push(msg);
  };
  // Load config
  const config: Config = await loadConfig(baseCtx.vaultPath).catch(
    (err: Error) => {
      log(
        `Warning: could not load vault config — ${err.message}. Using built-in defaults.`,
      );
      return EMPTY_CONFIG;
    },
  );

  const statDir = await resolveStateDir(baseCtx.env, baseCtx.vaultPath);
  const fileOperations: Record<string, FileOperation[]> = {};
  const ruleContext: PluginContext = {
    timezone: config.timezone ?? "America/Los_Angeles",
    updateFile(transcriptPath, fileOperation) {
      fileOperations[transcriptPath] ??= [];
      fileOperations[transcriptPath].push(fileOperation);
    },
    todayDate: baseCtx.today,
    alertTasks: [],
    addTasks: {},
    onlyGlob: baseCtx.onlyGlob,
    jobIdFactory: baseCtx.jobIdFactory ?? buildJobId,
    async queueJob(job) {
      if (!baseCtx.dryRun) {
        await enqueue(statDir, job);
      }
    },
    vaultPath: baseCtx.vaultPath,
  };
  const processor = createParseProcessor(config, ruleContext);
  // Accepts array or single object for config.sources
  const globalGlobs: Source[] = Array.isArray(config.sources)
    ? config.sources
    : config.sources
      ? [config.sources]
      : [{ type: "glob", pattern: "**/*.md" }];

  if (baseCtx.onlyGlob) {
    globalGlobs.length = 0; // Clear config sources if onlyGlob is specified
    globalGlobs.push(
      ...baseCtx.onlyGlob.map((pattern): Source => ({ type: "glob", pattern })),
    );
  }

  // Filter all .md files in the vault
  const matchingFiles = (await walkMarkdownFiles(baseCtx.vaultPath)).filter(
    (filePath) => fileMatchesSources(filePath, globalGlobs, baseCtx.vaultPath),
  );
  const changes: Array<{ path: string; content: string }> = [];
  for (const filePath of matchingFiles) {
    let original: string;
    try {
      original = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const vfile = new VFile({ path: filePath, value: original });

    // Use the provided processor for normalization
    const tree = processor.parse(vfile);
    const processed = (await processor.run(tree, vfile)) as Root;
    const normalized = String(processor.stringify(processed, vfile));
    if (normalized !== original) {
      changes.push({ path: filePath, content: normalized });
    }
  }

  for (const [filePath, ops] of Object.entries(fileOperations)) {
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

  for (const filePath of Object.keys(ruleContext.addTasks)) {
    let original: string;
    try {
      original = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    const vfile = new VFile({ path: filePath, value: original });
    const tree = processor.parse(vfile);
    const processed = (await processor.run(tree, vfile)) as Root;
    const normalized = String(processor.stringify(processed, vfile));
    if (normalized !== original) {
      changes.push({ path: filePath, content: normalized });
    }
  }

  // Sort by path for deterministic output
  changes.sort((a, b) => a.path.localeCompare(b.path));
  if (baseCtx.dryRun) {
    if (changes.length > 0) {
      for (const change of changes) {
        const relPath = filePathRelative(baseCtx.vaultPath, change.path);
        let original = "";
        try {
          original = await fs.readFile(change.path, "utf-8");
        } catch {
          // new file — treat original as empty
        }
        log(createPatch(relPath, original, change.content));
      }
    } else {
      log("No changes.");
    }
  } else {
    for (const change of changes) {
      await fs.mkdir(fsPath.dirname(change.path), { recursive: true });
      await fs.writeFile(change.path, change.content, "utf-8");
    }
    if (changes.length > 0) {
      log("\nFiles written:");
      for (const { path: f } of changes) {
        log(`  ${f}`);
      }
    } else {
      log("\nNo files written.");
    }
  }
  return { changes, report: lines.join("\n") };
}

function filePathRelative(base: string, file: string): string {
  if (file.startsWith(base)) {
    return file.slice(base.length + 1);
  }
  return file;
}

export async function runInitPass(vaultPath: string, dryRun: boolean) {
  const changes: Array<{ path: string; original: string; content: string }> =
    [];
  const allFiles = await walkMarkdownFiles(vaultPath);
  for (const filePath of allFiles) {
    let rawBuffer: Buffer;
    try {
      rawBuffer = await fs.readFile(filePath);
    } catch {
      continue;
    }

    // Decode UTF-16 encoded files to UTF-8 strings so they can be processed by
    // the remark pipeline.  The file will be written back as UTF-8, which is a
    // lossless conversion.
    //
    // Recognised encodings:
    //   FF FE …  — UTF-16 LE with BOM
    //   FE FF …  — UTF-16 BE with BOM
    //   <no BOM> — Heuristic: if every odd-indexed byte in the first 512 bytes
    //              is 0x00, the file is almost certainly BOM-less UTF-16 LE.
    //              Normal UTF-8 Markdown never contains embedded null bytes, so
    //              false positives are not a practical concern.
    let original: string;
    let wasUtf16 = false;
    if (rawBuffer[0] === 0xff && rawBuffer[1] === 0xfe) {
      // UTF-16 LE with BOM: skip the 2-byte BOM, then decode the rest.
      original = rawBuffer.slice(2).toString("utf16le");
      wasUtf16 = true;
    } else if (rawBuffer[0] === 0xfe && rawBuffer[1] === 0xff) {
      // UTF-16 BE with BOM: swap bytes before decoding as UTF-16 LE.
      const swapped = Buffer.alloc(rawBuffer.length - 2);
      for (let i = 2; i < rawBuffer.length - 1; i += 2) {
        swapped[i - 2] = rawBuffer[i + 1];
        swapped[i - 1] = rawBuffer[i];
      }
      original = swapped.toString("utf16le");
      wasUtf16 = true;
    } else {
      // Heuristic BOM-less UTF-16 LE detection: sample the first 512 bytes and
      // check whether every byte at an odd index is 0x00.  Require at least 4
      // bytes so a file that is just a single newline isn't mis-detected.
      const sampleLen = Math.min(rawBuffer.length, 512);
      let isBomlessUtf16Le = sampleLen >= 4;
      for (let i = 1; i < sampleLen; i += 2) {
        if (rawBuffer[i] !== 0x00) {
          isBomlessUtf16Le = false;
          break;
        }
      }
      if (isBomlessUtf16Le) {
        original = rawBuffer.toString("utf16le");
        wasUtf16 = true;
      } else {
        original = rawBuffer.toString("utf-8");
      }
    }

    const normalized = normalizeFileContent(original);
    // Always record a change for UTF-16 files: even if the text is already
    // normalized, the encoding itself needs to be converted to UTF-8.
    if (normalized !== original || wasUtf16) {
      changes.push({ path: filePath, original, content: normalized });
    }
  }
  // Sort by path for deterministic output.
  changes.sort((a, b) => a.path.localeCompare(b.path));

  if (dryRun) {
    if (changes.length > 0) {
      for (const change of changes) {
        console.log(
          createPatch(
            relative(vaultPath, change.path),
            change.original,
            change.content,
          ),
        );
      }
    } else {
      console.log("No changes.");
    }
  } else {
    for (const change of changes) {
      await fs.writeFile(change.path, change.content, "utf-8");
    }
  }
  return { changes };
}

/**
 * Normalize a single file's raw content through the parse → stringify
 * pipeline, preserving structured YAML frontmatter data.
 */
export function normalizeFileContent(raw: string): string {
  const updates: Record<string, FileOperation[]> = {};
  const processor = createParseProcessor(
    {
      rules: {},
    },
    {
      updateFile(transcriptPath, fileOperation) {
        updates[transcriptPath] ??= [];
        updates[transcriptPath].push(fileOperation);
      },
      skipPlugins: true,
      addTasks: {},
      alertTasks: [],
      queueJob: async () => {},
      jobIdFactory: buildJobId,
      todayDate: new Date(),
      vaultPath: "",
    },
  );

  const vfile = new VFile({ path: "tmp.md", value: raw });
  const tree = processor.parse(vfile);
  const processed = processor.runSync(tree, vfile) as Root;
  const normalized = String(processor.stringify(processed, vfile));

  return normalized;
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
