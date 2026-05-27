#!/usr/bin/env node
import { runner, runInitPass } from "./engine/runner.js";
import { createDebouncer, vaultWatcher } from "./engine/vaultWatcher.js";
import createDebug from "debug";
import {
  createAlertScheduler,
  normalizeAlertSchedule,
} from "./engine/createAlertScheduler.js";
import { userLocalTime } from "./engine/userLocalTime.js";
import { helpText } from "./helpText.js";
import { loadConfig, CONFIG_FILENAME } from "./loadConfig.js";
import type { PluginContext } from "./markdown/types.js";
import { queue, resolveStateDir } from "./transcription/queue.js";
import type { Job } from "./transcription/types.js";
import path from "path";

// eslint-disable-next-line no-console
const log = console.log.bind(console);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
if (verbose) createDebug.enable("onyx:*");
const init = args.includes("--init");
const watch = args.includes("--watch");
const help = args.includes("--help") || args.includes("-h");

// --only <glob>: optional value-bearing flag
const onlyIdx = args.indexOf("--only");
if (
  onlyIdx !== -1 &&
  (onlyIdx + 1 >= args.length || args[onlyIdx + 1].startsWith("-"))
) {
  console.error("Error: --only requires a glob pattern argument.");
  console.error('  Example: onyx-vellum --dry-run --only "notes/**" all');
  process.exit(1);
}
const onlyGlob: string[] | undefined =
  onlyIdx !== -1 ? [args[onlyIdx + 1]] : undefined;

// Positional arguments: rule names or "all" (everything that doesn't start with '--')
const positional = args.filter((a) => !a.startsWith("-"));

if (help) {
  log(helpText);
  process.exit(0);
}

let vaultPath = process.env["VAULT_PATH"];
if (!vaultPath) {
  console.error("Error: VAULT_PATH environment variable is required.");
  process.exit(1);
}
if (!path.isAbsolute(vaultPath)) {
  vaultPath = path.resolve(process.cwd(), vaultPath);
}

log(`Starting Markdown automation pipeline...`);
log(`Vault: ${vaultPath}`);

if (init) {
  if (watch) {
    console.error("Error: --watch is not compatible with --init.");
    process.exit(1);
  }
  log(`Mode: init${dryRun ? " (dry run)" : ""}`);
  log("");

  runInitPass(vaultPath, dryRun).catch((err: unknown) => {
    console.error("Fatal error:", (err as Error).message);
    process.exit(1);
  });
} else {
  const mode = positional[0];
  // Rule selection is required: either "all" or one or more rule names.
  if (positional.length !== 1 || (mode !== "all" && mode !== "alert")) {
    console.error('Error: specify "all" or "alert".');
    console.error("");
    console.error("Examples:");
    console.error("  onyx-vellum all");
    console.error("  onyx-vellum --dry-run all");
    console.error("");
    console.error("Run with --help for full usage information.");
    process.exit(1);
  }
  const stateDir = resolveStateDir(process.env, vaultPath);
  const queuedJobs: Job[] = [];
  function queueJob(job: Job) {
    queuedJobs.push(job);
    if (!dryRun) {
      queue(stateDir, job);
    }
  }
  const ruleContext: Omit<Parameters<typeof runner>[0], "dates"> = {
    mode,
    vaultPath,
    queueJob,
    dryRun,
    verbose,
    env: process.env,
  };

  const config = await loadConfig(vaultPath);

  // Single shared entry-point for rule execution.  Closures in all parameters
  // so both the one-shot and watch paths use exactly the same runAllRules call.
  const run = async (
    mode: PluginContext["mode"],
    glob?: string[],
  ): Promise<void> => {
    const dates = userLocalTime({
      tz: config.timezone ?? "UTC",
    });
    const { changes, report } = await runner({
      ...ruleContext,
      mode,
      dates,
      onlyGlob: glob,
    });

    if (changes.length > 0 || queuedJobs.length > 0) {
      log(`=== Report ===`);
      log(report);
      log(`Jobs queued:`);
      queuedJobs.forEach((job) => {
        switch (job.type) {
          case "transcribe":
            log(
              `- Transcribe ${job.audioPath} to ${job.target.location.file.relativePath}`,
            );
            break;
          case "clean-transcription":
            log(
              `- Clean transcription in ${job.target.location.file.relativePath}`,
            );
            break;
          case "find-tasks":
            log(
              `- Find tasks in ${job.source.file.relativePath} and write to ${job.target.location.file.relativePath}`,
            );
            break;
          case "summarize-text":
            log(
              `- Summarize text in ${job.source.file.relativePath} and write to ${job.target.location.file.relativePath}`,
            );
            break;
        }
      });
      queuedJobs.length = 0;
    }
  };

  if (watch) {
    // Watch mode: load config to read the debounce and schedule settings.
    const fullDebounceMs = config.watch?.debounce ?? 30_000;
    const fastDebounce = 5_000;
    // Mutable so the scheduler picks up changes when the config is reloaded.
    const initialSchedule = normalizeAlertSchedule(
      config.watch?.alertSchedule ?? [],
    );
    let alertSchedule: string[] = initialSchedule.valid;
    let timezone = config.timezone ?? "UTC";

    log(`Mode: watch${dryRun ? " (dry run)" : ""}`);
    log(`Debounce: ${fullDebounceMs}ms (full), ${fastDebounce}ms (fast)`);
    if (alertSchedule.length > 0) {
      log(`Alert schedule: ${alertSchedule.join(", ")}`);
    } else {
      log(`Alert schedule: (none configured — alert will not fire)`);
    }
    if (initialSchedule.invalid.length > 0) {
      console.warn(
        `[watch] Ignoring invalid alert schedule entries: ${initialSchedule.invalid.join(", ")}`,
      );
    }
    log("");
    log(`Watching vault for markdown changes...`);
    log(`Press Ctrl+C to stop.`);
    log("");

    log(`[watch] Running all rules on startup...`);
    run("all");

    const fullDebouncer = createDebouncer({
      baseMs: fullDebounceMs,
      maxMs: Math.min(fullDebounceMs * 2, 60_000),
      onProcess: (relPaths) => run("all", relPaths),
      growthFactor: 1.15,
    });

    const stop = vaultWatcher(
      vaultPath,
      async (relPaths) => {
        const configChanged = relPaths.includes(CONFIG_FILENAME);
        if (configChanged) {
          log(`[watch] Config changed, reloading...`);
          try {
            const newConfig = await loadConfig(vaultPath);
            const normalized = normalizeAlertSchedule(
              newConfig.watch?.alertSchedule ?? [],
            );
            alertSchedule = normalized.valid;
            timezone = newConfig.timezone ?? "UTC";
            if (alertSchedule.length > 0) {
              log(
                `[watch] Alert schedule updated: ${alertSchedule.join(", ")}`,
              );
            } else {
              log(
                `[watch] Alert schedule updated: (none — alert will not fire)`,
              );
            }
            if (normalized.invalid.length > 0) {
              console.warn(
                `[watch] Ignoring invalid alert schedule entries: ${normalized.invalid.join(", ")}`,
              );
            }
          } catch (err) {
            console.error(
              `[watch] Failed to reload config:`,
              (err as Error).message,
            );
          }
        }

        await run("fast", relPaths);
      },
      {
        debounce: fastDebounce,
        maxDebounce: 30_000,
        growthFactor: 1.5,
        additionalFiles: [CONFIG_FILENAME],
        onRawNotify: (relPath, eventType) =>
          fullDebouncer.notify(relPath, eventType),
      },
    );

    // Run incompleteTaskAlert (and its transitive deps) on schedule only.
    const stopScheduler = createAlertScheduler(
      () => alertSchedule,
      async () => {
        log("[watch] Running scheduled alert...");
        await runner({
          ...ruleContext,
          mode: "alert",
          dates: userLocalTime({ tz: timezone }),
        });
      },
      timezone,
    );

    const stopAll = createStopAll([stop, stopScheduler]);

    process.on("SIGINT", () => {
      log("\n[watch] Stopping watcher...");
      stopAll();
      process.exit(0);
    });
  } else {
    if (dryRun) {
      log(`Dry run: true`);
    } else {
      log(`Dry run: false`);
    }
    log("");

    await run(mode, onlyGlob).catch((err: unknown) => {
      console.error("Fatal error:", (err as Error).message);
      process.exit(1);
    });
  }
}

function createStopAll(stops: Array<() => void>): () => void {
  return (): void => {
    for (const stop of stops) {
      stop();
    }
  };
}
