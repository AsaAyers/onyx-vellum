import { createPatch } from "diff";
import { promises as fs } from "node:fs";
import fsPath, { relative } from "node:path";
import { createParseProcessor, type PluginContext } from "../markdown/parse.js";
import { ruleSpecs } from "../rules/index.js";
import { walkMarkdownFiles } from "./io.js";
import type { RuleContext, RuleSpec, Source } from "../rules/types.js";
import { loadConfig, type Config } from "../config.js";
import micromatch from "micromatch";
import type { Root } from "mdast";
import { EMPTY_CONFIG } from "../markdown/defaultConfig.js";
import { VFile } from "vfile";
import { format } from "date-fns";
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
 * Sort `specs` so that every spec's dependencies appear before it in the
 * returned array.  Throws if a dependency name is unknown or if there is a
 * circular dependency.
 */
export function sortRuleSpecs(specs: RuleSpec[]): RuleSpec[] {
  // sortRuleSpecs validates that every declared dependency exists within the
  // *same* `specs` array — callers are responsible for passing a complete set.
  const specMap = new Map(specs.map((s) => [s.name, s]));

  // Validate that every declared dependency actually exists in the set.
  for (const spec of specs) {
    for (const dep of spec.dependencies ?? []) {
      if (!specMap.has(dep)) {
        throw new Error(
          `RuleSpec "${spec.name}" depends on unknown spec "${dep}"`,
        );
      }
    }
  }

  // Kahn's algorithm: build an adjacency list (dep → dependents) and an
  // in-degree counter, then process nodes with no remaining dependencies.
  const inDegree = new Map(specs.map((s) => [s.name, 0]));
  const adjList = new Map<string, string[]>(specs.map((s) => [s.name, []]));

  for (const spec of specs) {
    for (const dep of spec.dependencies ?? []) {
      adjList.get(dep)!.push(spec.name);
      inDegree.set(spec.name, (inDegree.get(spec.name) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: RuleSpec[] = [];
  while (queue.length > 0) {
    // shift() (FIFO) keeps the original registration order for independent
    // specs, which is a useful stability property.  Spec lists are small, so
    // the O(n) cost is negligible.
    const name = queue.shift()!;
    sorted.push(specMap.get(name)!);
    for (const neighbor of adjList.get(name) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== specs.length) {
    throw new Error("Circular dependency detected among RuleSpecs");
  }

  return sorted;
}

/**
 * From all registered specs, select only those named in `selected` plus their
 * transitive dependencies, then return them topologically sorted.
 *
 * Throws if any name in `selected` does not correspond to a known spec.
 */
export function selectRuleSpecs(
  allSpecs: RuleSpec[],
  selected: string[],
): RuleSpec[] {
  const specMap = new Map(allSpecs.map((s) => [s.name, s]));

  // Validate that every explicitly requested name exists.
  for (const name of selected) {
    if (!specMap.has(name)) {
      const available = allSpecs.map((s) => s.name).join(", ");
      throw new Error(`Unknown rule: "${name}". Available rules: ${available}`);
    }
  }

  // BFS to collect transitive dependencies of the selected specs.
  const needed = new Set<string>(selected);
  const bfsQueue = [...selected];
  while (bfsQueue.length > 0) {
    const name = bfsQueue.shift()!;
    const spec = specMap.get(name)!;
    for (const dep of spec.dependencies ?? []) {
      if (!needed.has(dep)) {
        needed.add(dep);
        bfsQueue.push(dep);
      }
    }
  }

  // Filter the original list to preserve registration order, then sort.
  const filteredSpecs = allSpecs.filter((s) => needed.has(s.name));
  return sortRuleSpecs(filteredSpecs);
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
    console.log(msg);
    lines.push(msg);
  };
  // Load config
  const config: Config = await loadConfig(baseCtx.vaultPath, ruleSpecs).catch(
    (err: Error) => {
      log(
        `Warning: could not load vault config — ${err.message}. Using built-in defaults.`,
      );
      return EMPTY_CONFIG;
    },
  );

  const ruleContext: PluginContext = {
    timezone: config.timezone ?? "America/Los_Angeles",
    today: format(baseCtx.today, "yyyy-MM-dd"),
    alertTasks: [],
    addTasks: {},
  };
  const processor = createParseProcessor(
    baseCtx.vaultPath,
    config,
    ruleContext,
  );
  // Accepts array or single object for config.sources
  const globalGlobs: Source[] = Array.isArray(config.sources)
    ? config.sources
    : config.sources
      ? [config.sources]
      : [{ type: "glob", pattern: "**/*.md" }];

  // Walk all .md files in the vault
  const allFiles = await walkMarkdownFiles(baseCtx.vaultPath);
  const changes: Array<{ path: string; content: string }> = [];
  for (const filePath of allFiles) {
    if (!fileMatchesSources(filePath, globalGlobs, baseCtx.vaultPath)) continue;
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

  const files = Object.keys(ruleContext.addTasks);
  for (const filePath of files) {
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
  const processor = createParseProcessor(
    "",
    {
      rules: {},
    },
    {
      skipPlugins: true,
      today: "",
      addTasks: {},
      alertTasks: [],
    },
  );

  const vfile = new VFile({ path: "tmp.md", value: raw });
  const tree = processor.parse(vfile);
  const processed = processor.runSync(tree, vfile) as Root;
  const normalized = String(processor.stringify(processed, vfile));

  return normalized;
}
