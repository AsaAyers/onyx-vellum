import { createPatch } from "diff";
import fs from "node:fs/promises";
import { join } from "node:path";
import { createParseProcessor } from "../markdown/parse.js";
import { type PluginContext } from "../markdown/PluginContext.js";
import {
  FileWriteManager,
  walkMarkdownFiles,
  zVaultFile,
  type ChangesArray,
  type VaultFile,
} from "./io.js";
import type { Source } from "../rules/types.js";
import { loadConfig, type Config } from "../config.js";
import type { Root } from "mdast";
import { EMPTY_CONFIG } from "../markdown/defaultConfig.js";
import { VFile } from "vfile";
import { buildJobId } from "../transcription/queue.js";
import {
  fileMatchesSources,
  FileOperationExecutor,
} from "./FileOperationExecutor.js";
import {
  ALERT_FILE,
  sendNotification,
} from "../rules/incompleteTaskAlertPlugin.js";
import { type UserLocalTime } from "./timezone.js";
import {
  commandsMarkdown,
  ONYX_COMMANDS_FILE,
} from "../onyx_vellum_commands.js";

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
  baseCtx: Omit<PluginContext, "readFile" | "jobIdFactory" | "updateFile"> & {
    jobIdFactory?: PluginContext["jobIdFactory"];
  },
): Promise<{
  changes: ChangesArray;
  report: string;
  matchingFiles: VaultFile[];
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

  const fileManager = new FileWriteManager(baseCtx.vaultPath);
  const fileOperations = new FileOperationExecutor();
  const ruleContext: PluginContext = {
    ...baseCtx,
    updateFile: fileOperations.updateFile,
    jobIdFactory: baseCtx.jobIdFactory ?? buildJobId,
    vaultPath: baseCtx.vaultPath,
  };
  await ensureCommandFile(baseCtx, fileManager);

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
      ...baseCtx.onlyGlob
        .filter(
          (path) => path.endsWith(".md") && !path.endsWith(ONYX_COMMANDS_FILE),
        )
        .map(
          (value): Source =>
            value.includes("*")
              ? { type: "glob", pattern: value }
              : { type: "path", value },
        ),
    );
  }

  // Filter all .md files in the vault
  const matchingFiles = (
    await walkMarkdownFiles(baseCtx.vaultPath, baseCtx.vaultPath)
  ).filter((filePath) => fileMatchesSources(filePath, globalGlobs));
  const alertFile =
    baseCtx.mode === "alert"
      ? zVaultFile.parse({
          absolutePath: join(baseCtx.vaultPath, ALERT_FILE),
          relativePath: ALERT_FILE,
        })
      : null;
  if (alertFile) {
    fileManager.stage(alertFile, "");
  }
  for (const vaultFile of matchingFiles) {
    let original: string;
    try {
      original = await fileManager.read(vaultFile);
    } catch {
      continue;
    }
    if (!original) {
      console.warn("Empty file:", vaultFile.relativePath);
    }

    const vfile = new VFile({ path: vaultFile.absolutePath, value: original });

    const tree = processor.parse(vfile);
    const processed = (await processor.run(tree, vfile)) as Root;
    const normalized = String(processor.stringify(processed, vfile));
    if (normalized !== original) {
      fileManager.stage(vaultFile, normalized);
    }
  }

  await fileOperations.execute(processor, fileManager);

  const alertFileContent = alertFile && (await fileManager.read(alertFile));
  if (baseCtx.mode === "alert" && alertFileContent !== "" && alertFile) {
    const processor2 = createParseProcessor(config, {
      ...ruleContext,
      mode: "alert",
    });

    const vfile = new VFile({
      path: alertFile.absolutePath,
      value: alertFileContent,
    });
    const tree = processor2.parse(vfile);
    const processed = (await processor2.run(tree, vfile)) as Root;
    const content = String(processor2.stringify(processed, vfile));
    fileManager.unstageAll();
    fileManager.stage(alertFile, content);
  }

  // Sort by path for deterministic output
  // fileManager.sort((a, b) => a.path.localeCompare(b.path));
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
        vaultFile: { relativePath: f },
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

  return { changes, report: lines.join("\n"), matchingFiles };
}

async function ensureCommandFile(
  baseCtx: Omit<
    PluginContext,
    "readFile" | "jobIdFactory" | "queueJob" | "updateFile"
  > & { jobIdFactory?: PluginContext["jobIdFactory"] },
  fileManager: FileWriteManager,
) {
  const commandsFile = zVaultFile.parse({
    absolutePath: join(baseCtx.vaultPath, ONYX_COMMANDS_FILE),
    relativePath: ONYX_COMMANDS_FILE,
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

    // Always record a change for UTF-16 files: the encoding itself needs to be
    // converted to UTF-8.
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
        console.log(
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
      console.log("No changes.");
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

  /**
   * Skip executing when normalizing single files.
   */
  // fileOperations.execute(processor, []);

  const vfile = new VFile({ path: "tmp.md", value: content });
  const tree = processor.parse(vfile);
  const processed = (await processor.run(tree, vfile)) as Root;
  const normalized = String(processor.stringify(processed, vfile));

  return normalized;
}
