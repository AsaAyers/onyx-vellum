import { createPatch } from "diff";
import { promises as fs } from "node:fs";
import { relative } from "node:path";
import { parseMarkdown, stringifyMarkdown } from "../markdown/parse.js";
import { joinFrontmatter, splitFrontmatter } from "../markdown/frontmatter.js";
import { ruleSpecs } from "../rules/index.js";
import { stampDoneUnknownSpec } from "../rules/stampDone.js";
import { walkMarkdownFiles } from "./io.js";
import { FileWriteManager } from "./io.js";
import { runRuleSpec } from "./ruleSpecRunner.js";
import { buildJobId } from "./actions/requestTranscription.js";
import { enqueue } from "../transcription/queue.js";
import { resolveStateDir } from "../transcription/runtime.js";
import type { RuleContext, RuleSpec } from "../rules/types.js";
import type { Job } from "../transcription/types.js";
import { loadConfig, applyConfig } from "../config.js";

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
  const queue = new FileWriteManager();

  const verbose = baseCtx.verbose ?? false;

  const lines: string[] = [];

  /** Always emits: used for diff output and non-dry-run progress. */
  const log = (msg: string): void => {
    console.log(msg);
    lines.push(msg);
  };

  const ctx: RuleContext = {
    ...baseCtx,
    jobIdFactory: baseCtx.jobIdFactory ?? buildJobId,
    readFile: (p: string) => queue.read(p),
    log,
  };

  /**
   * Detail log: emitted only when verbose=true OR when not in dry-run mode.
   * Keeps "Running rule …" and summary noise out of plain dry-run output.
   */
  const logDetail = (msg: string): void => {
    if (verbose || !ctx.dryRun) log(msg);
  };

  const summaries: string[] = [];
  const transcriptionJobs: Job[] = [];

  // Load vault-level config and apply source overrides to all registered specs.
  const allSpecs = await loadConfig(ctx.vaultPath, ruleSpecs).then(
    (config) => {
      ctx.config = config;
      return applyConfig(ruleSpecs, config);
    },
    (err: Error) => {
      log(
        `Warning: could not load vault config — ${err.message}. Using built-in defaults.`,
      );
      return ruleSpecs;
    },
  );

  // Resolve which specs to run based on the `selectedRuleNames` context field.
  const specsToRun =
    ctx.selectedRuleNames === undefined || ctx.selectedRuleNames === "all"
      ? sortRuleSpecs(allSpecs)
      : selectRuleSpecs(allSpecs, ctx.selectedRuleNames);

  // Declarative RuleSpecs (e.g. normalization) run first, ordered by deps.
  for (const spec of specsToRun) {
    logDetail(`Running rule spec: ${spec.name}`);
    try {
      const result = await runRuleSpec(spec, ctx);
      for (const change of result.changes) {
        queue.stage(change.path, change.content);
      }
      transcriptionJobs.push(...result.transcriptionJobs);
      summaries.push(`  [${spec.name}] ${result.summary}`);
    } catch (err) {
      summaries.push(`  [${spec.name}] ERROR: ${(err as Error).message}`);
    }
  }

  // Flush everything once at the end.
  const written = await queue.commit(ctx.dryRun);
  if (!ctx.dryRun && transcriptionJobs.length > 0) {
    const stateDir = resolveStateDir(ctx.env, ctx.vaultPath);
    for (const job of transcriptionJobs) {
      await enqueue(stateDir, job);
    }
  }

  // Sort by path for deterministic output.
  written.sort((a, b) => a.path.localeCompare(b.path));

  if (ctx.dryRun) {
    if (written.length > 0) {
      for (const change of written) {
        const relPath = relative(ctx.vaultPath, change.path);
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
    logDetail("\n=== Run Summary ===");
    for (const s of summaries) {
      logDetail(s);
    }
  } else {
    logDetail("\n=== Run Summary ===");
    for (const s of summaries) {
      logDetail(s);
    }
    if (written.length > 0) {
      logDetail("\nFiles written:");
      for (const { path: f } of written) {
        logDetail(`  ${f}`);
      }
    } else {
      logDetail("\nNo files written.");
    }
  }

  return { changes: written, report: lines.join("\n") };
}

/**
 * Normalization-only pass: read every `.md` file in the vault, round-trip it
 * through the parse → stringify pipeline, and write it back if the output
 * differs from the original.  No rule-driven transformations occur.
 *
 * Files with YAML frontmatter (`---\n…\n---`) are handled correctly: only
 * the body content is passed through the remark pipeline; frontmatter is
 * parsed into structured data and then re-serialized.
 *
 * After the first normalization pass the function runs a second pass on the
 * normalized content to verify stability (idempotency).  If the second pass
 * would produce further changes the function throws an error listing the
 * offending files — this means the normalization is not a NOOP on already-
 * normalized content, which indicates a bug in the parse/stringify pipeline.
 *
 * Dry-run mode: no files are written; a unified diff is printed to stdout for
 * each file that would change.
 *
 * @param vaultPath  Absolute path to the vault root.
 * @param dryRun     When true no files are written to disk.
 * @param normalize  Optional custom normalizer — defaults to
 *                   `normalizeFileContent`.  Exposed for testing only.
 * @returns `scanned` — total `.md` files found.
 *          `rewritten` — files whose content changed after the round-trip.
 *          `changes` — the (path, normalized content) pairs, sorted by path.
 *          `report` — everything printed to console during the pass.
 */

/**
 * Normalize a single file's raw content through the parse → stringify
 * pipeline, preserving structured YAML frontmatter data.
 */
export function normalizeFileContent(raw: string): string {
  const parts = splitFrontmatter(raw);
  const normalizedBody = stringifyMarkdown(parseMarkdown(parts.body));
  return joinFrontmatter(parts, normalizedBody);
}

export async function runInitPass(
  vaultPath: string,
  dryRun: boolean,
  normalize: (raw: string) => string = normalizeFileContent,
): Promise<{
  scanned: number;
  rewritten: number;
  changes: Array<{ path: string; content: string }>;
  report: string;
}> {
  const lines: string[] = [];
  const log = (msg: string): void => {
    console.log(msg);
    lines.push(msg);
  };

  const allFiles = await walkMarkdownFiles(vaultPath);

  // First pass: collect the normalized content for every file that changes.
  const changes: Array<{ path: string; original: string; content: string }> =
    [];

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

    const normalized = normalize(original);
    // Always record a change for UTF-16 files: even if the text is already
    // normalized, the encoding itself needs to be converted to UTF-8.
    if (normalized !== original || wasUtf16) {
      changes.push({ path: filePath, original, content: normalized });
    }
  }

  // Sort by path for deterministic output.
  changes.sort((a, b) => a.path.localeCompare(b.path));

  // Step 2: Stamp done on checked tasks that lack one.
  // A custom readFile serves in-memory normalised content for files that were
  // already changed in the normalization pass above, so both normalisation
  // and stamping are applied to the same content.
  const normContentMap = new Map(changes.map((c) => [c.path, c.content]));
  const stampReadFile = async (p: string): Promise<string> => {
    if (normContentMap.has(p)) return normContentMap.get(p)!;
    try {
      return await fs.readFile(p, "utf-8");
    } catch {
      return "";
    }
  };

  const stampResult = await runRuleSpec(stampDoneUnknownSpec, {
    vaultPath,
    today: new Date(), // required by RuleContext; not used because stampDoneUnknownSpec uses value:'unknown'
    dryRun: false, // dry-run is handled for the whole init pass below
    jobIdFactory: buildJobId,
    env: {},
    readFile: stampReadFile,
  });

  // Merge stamp changes into the normalisation changes.
  for (const stampChange of stampResult.changes) {
    const existingIdx = changes.findIndex((c) => c.path === stampChange.path);
    if (existingIdx >= 0) {
      // File was already normalised — stamp was applied on top of that.
      changes[existingIdx].content = stampChange.content;
    } else {
      // File is already well-formatted but needs done stamped.
      let rawOriginal: string;
      try {
        rawOriginal = await fs.readFile(stampChange.path, "utf-8");
      } catch {
        rawOriginal = "";
      }
      changes.push({
        path: stampChange.path,
        original: rawOriginal,
        content: stampChange.content,
      });
    }
  }

  // Re-sort after merging.
  changes.sort((a, b) => a.path.localeCompare(b.path));

  // Second pass: verify stability — the normalized content must itself be a
  // NOOP when run through the pipeline again.
  const unstable: string[] = [];
  for (const change of changes) {
    const secondPass = normalize(change.content);
    if (secondPass !== change.content) {
      unstable.push(relative(vaultPath, change.path));
    }
  }
  if (unstable.length > 0) {
    throw new Error(
      `Init normalization is not stable (second pass produced changes) for:\n  ${unstable.join("\n  ")}`,
    );
  }

  if (dryRun) {
    if (changes.length > 0) {
      for (const change of changes) {
        log(
          createPatch(
            relative(vaultPath, change.path),
            change.original,
            change.content,
          ),
        );
      }
    } else {
      log("No changes.");
    }
  } else {
    for (const change of changes) {
      await fs.writeFile(change.path, change.content, "utf-8");
    }
  }

  log(
    `Init: scanned ${allFiles.length} file(s), ${dryRun ? "would rewrite" : "rewrote"} ${changes.length}.`,
  );

  return {
    scanned: allFiles.length,
    rewritten: changes.length,
    changes: changes.map(({ path, content }) => ({ path, content })),
    report: lines.join("\n"),
  };
}
