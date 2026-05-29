import { createPatch } from "diff";
import fs from "node:fs/promises";
import { join } from "node:path";
import { createParseProcessor } from "../markdown/createParseProcessor.js";
import { type PluginContext } from "../markdown/types.js";
import {
  FileWriteManager,
  walkMarkdownFiles,
  type ChangesArray,
} from "./FileWriteManager.js";
import { VaultFile } from "./VaultFile.js";
import type { Source } from "../rules/types.js";
import { loadConfig, type Config } from "../loadConfig.js";
import type { Root } from "mdast";
import type { Job } from "../transcription/types.js";
import { buildJobId } from "../transcription/queue.js";
import {
  fileMatchesSources,
  FileOperationExecutor,
} from "./FileOperationExecutor.js";
import {
  ALERT_FILE,
  sendNotification,
} from "../rules/incompleteTaskAlertPlugin.js";
import { decodeBuffer } from "./encoding.js";
import { type UserLocalTime } from "./userLocalTime.js";
import {
  ONYX_COMMANDS_FILE,
  commandsMarkdown,
} from "../rules/onyxVellumCommands.js";

// eslint-disable-next-line no-console
const log = console.log.bind(console);

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
export async function runner(
  baseCtx: Omit<PluginContext, "readFile" | "jobIdFactory" | "updateFile"> & {
    jobIdFactory?: PluginContext["jobIdFactory"];
  },
  fm?: FileWriteManager,
): Promise<{
  changes: ChangesArray;
  report: string;
  matchingFiles: VaultFile[];
  fileMeta: Map<string, { diff: string; jobs: Job[] }>;
}> {
  const lines: string[] = [];
  const log = (msg: string): void => {
    // console.log(msg);
    lines.push(msg);
  };
  const report = (msg: string): void => {
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

  const fileManager = fm ?? new FileWriteManager(baseCtx.vaultPath);
  const fileOperations = new FileOperationExecutor();

  // Per-file metadata for the TUI: captures diffs and queued jobs
  const fileMeta: Map<string, { diff: string; jobs: Job[] }> = new Map();
  const originalQueueJob = baseCtx.queueJob;
  const wrappedQueueJob: PluginContext["queueJob"] = (job: Job) => {
    originalQueueJob(job);
    const relPath = job.target?.location?.file?.relativePath;
    if (relPath) {
      const entry = fileMeta.get(relPath) ?? { diff: "", jobs: [] };
      entry.jobs.push(job);
      fileMeta.set(relPath, entry);
    }
  };

  const ruleContext: PluginContext = {
    ...baseCtx,
    queueJob: wrappedQueueJob,
    updateFile: fileOperations.updateFile,
    jobIdFactory: baseCtx.jobIdFactory ?? buildJobId,
    vaultPath: baseCtx.vaultPath,
    report,
  };
  await ensureCommandFile(baseCtx, fileManager);

  const processor = createParseProcessor(config, ruleContext);
  // Accepts array or single object for config.sources
  let globalGlobs: Source[] = Array.isArray(config.sources)
    ? [...config.sources]
    : config.sources
      ? [config.sources]
      : [{ type: "glob", pattern: "**/*.md" }];

  if (baseCtx.onlyGlob) {
    globalGlobs = baseCtx.onlyGlob
      .filter(
        (path) => path.endsWith(".md") && !path.endsWith(ONYX_COMMANDS_FILE),
      )
      .map(
        (value): Source =>
          value.includes("*")
            ? { type: "glob", pattern: value }
            : { type: "path", value },
      );
  }

  // Filter all .md files in the vault
  const matchingFiles = (
    await walkMarkdownFiles(baseCtx.vaultPath, baseCtx.vaultPath)
  ).filter((file) => fileMatchesSources(file, globalGlobs));
  const alertFile =
    baseCtx.mode === "alert"
      ? new VaultFile({
          absolutePath: join(baseCtx.vaultPath, ALERT_FILE),
          relativePath: ALERT_FILE,
          vaultPath: baseCtx.vaultPath,
        })
      : null;
  if (alertFile) {
    fileManager.stage(alertFile, "");
  }
  for (const vaultFile of matchingFiles) {
    let original: string;
    try {
      if (baseCtx.verbose) {
        log(`Processing: ${vaultFile.relativePath}`);
      }
      original = await fileManager.read(vaultFile);
    } catch {
      if (baseCtx.verbose) {
        log(`Skipping unreadable: ${vaultFile.relativePath}`);
      }
      continue;
    }
    if (!original) {
      console.warn("Empty file:", vaultFile.relativePath);
    }

    vaultFile.value = original;
    const tree = processor.parse(vaultFile);
    const processed = (await processor.run(tree, vaultFile)) as Root;
    const normalized = String(processor.stringify(processed, vaultFile));
    if (normalized !== original) {
      fileManager.stage(vaultFile, normalized);
      const diff = createPatch(vaultFile.absolutePath, original, normalized);
      const entry = fileMeta.get(vaultFile.relativePath) ?? { diff: "", jobs: [] };
      entry.diff = diff;
      fileMeta.set(vaultFile.relativePath, entry);
    }
  }

  await fileOperations.execute(processor, fileManager);

  const alertFileContent = alertFile && (await fileManager.read(alertFile));
  if (baseCtx.mode === "alert" && alertFileContent !== "" && alertFile) {
    const processor2 = createParseProcessor(config, {
      ...ruleContext,
      mode: "alert",
    });

    alertFile.value = alertFileContent as string;
    const tree = processor2.parse(alertFile);
    const processed = (await processor2.run(tree, alertFile)) as Root;
    const content = String(processor2.stringify(processed, alertFile));
    fileManager.unstageAll();
    fileManager.stage(alertFile, content);
  }

  // Sort by path for deterministic output
  const changes = await fileManager.commit(baseCtx.dryRun);
  if (baseCtx.dryRun) {
    if (changes.length > 0) {
      for (const change of changes) {
        const fullPath = change.vaultFile.absolutePath;
        let original = "";
        try {
          original = await fs.readFile(fullPath, "utf-8");
        } catch {
          // new file — treat original as empty
        }
        log(createPatch(fullPath, original, change.content));
      }
    } else {
      log("No changes.");
    }
  } else {
    if (changes.length > 0) {
      log("\nFiles written:");
      for (const {
        vaultFile: { path: f },
      } of changes) {
        log(`  ${f}`);
      }
    } else {
      log("\nNo files written.");
    }
  }

  if (ruleContext.mode === "alert" && !baseCtx.dryRun && alertFile) {
    const alertContent = await fileManager.read(alertFile);
    if (alertContent.trim() === "") {
      log("\nNo alerts to report.");
    } else {
      log(
        `Sending alert to: ${
          config.rules.incompleteTaskAlert?.alertUrl ?? "(no URL configured)"
        }`,
      );
      await sendNotification(config.rules.incompleteTaskAlert, alertContent);
    }
  }

  return { changes, report: lines.join("\n"), matchingFiles, fileMeta };
}

async function ensureCommandFile(
  baseCtx: Omit<
    PluginContext,
    "readFile" | "jobIdFactory" | "queueJob" | "updateFile"
  > & { jobIdFactory?: PluginContext["jobIdFactory"] },
  fileManager: FileWriteManager,
) {
  const commandsFile = new VaultFile({
    absolutePath: join(baseCtx.vaultPath, ONYX_COMMANDS_FILE),
    relativePath: ONYX_COMMANDS_FILE,
    vaultPath: baseCtx.vaultPath,
  });
  const commandsMd = await fileManager.read(commandsFile);
  if (commandsMd.trim() !== commandsMarkdown.trim()) {
    fileManager.stage(commandsFile, commandsMarkdown);
  }
}

export async function runInitPass(vaultPath: string, dryRun: boolean) {
  const fileManager = new FileWriteManager(vaultPath);
  const allFiles = await walkMarkdownFiles(vaultPath, vaultPath);
  for (const vaultFile of allFiles) {
    let rawBuffer: Buffer;
    try {
      rawBuffer = await fs.readFile(vaultFile.absolutePath);
    } catch {
      continue;
    }

    const { content: original, wasUtf16 } = decodeBuffer(rawBuffer);

    if (wasUtf16) {
      fileManager.stage(vaultFile, original);
    }
  }

  const changes = await fileManager.commit(dryRun);
  // Sort by path for deterministic output.
  changes.sort((a, b) =>
    a.vaultFile.absolutePath.localeCompare(b.vaultFile.absolutePath),
  );

  if (dryRun) {
    if (changes.length > 0) {
      for (const change of changes) {
        log(
          createPatch(
            change.vaultFile.relativePath,
            await fs
              .readFile(change.vaultFile.absolutePath, "utf-8")
              .catch(() => ""),
            change.content,
          ),
        );
      }
    } else {
      log("No changes.");
    }
  } else {
    for (const change of changes) {
      await fs.writeFile(
        change.vaultFile.absolutePath,
        change.content,
        "utf-8",
      );
    }
  }
  return { changes };
}

/**
 * Normalize a single file's raw content through the parse → stringify
 * pipeline, preserving structured YAML frontmatter data.
 */
export async function normalizeFileContent({
  content,
  dates,
  vaultPath,
}: {
  content: string;
  dates: UserLocalTime;
  vaultPath: string;
}) {
  const fileOperations = new FileOperationExecutor();
  const processor = createParseProcessor(
    {
      rules: {},
    },
    {
      mode: "normalize",
      updateFile: fileOperations.updateFile,
      queueJob: async () => {},
      jobIdFactory: buildJobId,
      dates,
      vaultPath,
      dryRun: true,
      env: {},
    },
  );

  const relativePath = "temp.md";
  const vfile = new VaultFile({
    absolutePath: join(vaultPath, relativePath),
    relativePath: relativePath,
    value: content,
    vaultPath,
  });

  const tree = processor.parse(vfile);
  const processed = (await processor.run(tree, vfile)) as Root;
  const normalized = String(processor.stringify(processed, vfile));

  return normalized;
}
export const EMPTY_CONFIG: Config = {
  sources: [{ type: "glob", pattern: "**/*.md" }],
  rules: {},
};
