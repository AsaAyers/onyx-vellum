#!/usr/bin/env node
import { runner, runInitPass } from "./engine/runner.js";
import { createDebouncer, vaultWatcher } from "./engine/vaultWatcher.js";
import { FileWriteManager } from "./engine/FileWriteManager.js";
import type { ChangesArray } from "./engine/FileWriteManager.js";
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
import { createMainTui } from "./tui/main/MainTui.js";
import type {
  MainActions,
  TuiInitResult,
  TuiRunResult,
} from "./tui/main/types.js";

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
const resolvedVaultPath = vaultPath;

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
  const mode = positional[0] as string | undefined;
  // Require positional arg in non-TTY, non-watch mode.
  if (!process.stdout.isTTY && !watch) {
    if (!mode || (mode !== "all" && mode !== "alert")) {
      console.error('Error: specify "all" or "alert".');
      console.error("");
      console.error("Examples:");
      console.error("  onyx-vellum all");
      console.error("  onyx-vellum --dry-run all");
      console.error("");
      console.error("Run with --help for full usage information.");
      process.exit(1);
    }
  }

  const stateDir = resolveStateDir(process.env, vaultPath);
  const config = await loadConfig(vaultPath);

  // Shared queue function used by both TUI and console paths.
  const queueJob = (job: Job) => queue(stateDir, job);

  function mapChangesToResult(
    changes: ChangesArray,
    resultMode: TuiRunResult["mode"],
  ): TuiRunResult {
    return {
      filesWritten: changes.length,
      filePaths: changes.map((c) => c.vaultFile.relativePath),
      mode: resultMode,
      finishedAt: Date.now(),
    };
  }

  if (process.stdout.isTTY) {
    // ── TUI shell ──────────────────────────────────────────────

    const tuiFileManager = new FileWriteManager(resolvedVaultPath);

    let watchCleanup: (() => void) | null = null;

    const actions: MainActions = {
      async runAll(dryRun: boolean) {
        const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
        const { changes } = await runner(
          {
            mode: "all",
            vaultPath: resolvedVaultPath,
            queueJob,
            dryRun,
            env: process.env,
            dates,
          },
          tuiFileManager,
        );
        return mapChangesToResult(changes, "all");
      },

      async runAlert(dryRun: boolean) {
        const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
        const { changes } = await runner(
          {
            mode: "alert",
            vaultPath: resolvedVaultPath,
            queueJob,
            dryRun,
            env: process.env,
            dates,
          },
          tuiFileManager,
        );
        return mapChangesToResult(changes, "alert");
      },

      async runSingleFile(relPath: string, dryRun: boolean) {
        const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
        const { changes } = await runner(
          {
            mode: "all",
            vaultPath: resolvedVaultPath,
            queueJob,
            dryRun,
            onlyGlob: [relPath],
            env: process.env,
            dates,
          },
          tuiFileManager,
        );
        return mapChangesToResult(changes, "single");
      },

      startWatching() {
        const fullDebounceMs = config.watch?.debounce ?? 30_000;
        const fastDebounce = 5_000;
        const initialSchedule = normalizeAlertSchedule(
          config.watch?.alertSchedule ?? [],
        );

        let alertSchedule: string[] = initialSchedule.valid;
        let timezone = config.timezone ?? "UTC";

        const fullDebouncer = createDebouncer({
          baseMs: fullDebounceMs,
          maxMs: Math.min(fullDebounceMs * 2, 60_000),
          onProcess: (relPaths) => runAll(relPaths),
          growthFactor: 1.15,
        });

        const stopWatcher = vaultWatcher(
          resolvedVaultPath,
          async (relPaths) => {
            const configChanged = relPaths.includes(CONFIG_FILENAME);
            if (configChanged) {
              console.warn(`[watch] Config changed, reloading...`);
              try {
                const newConfig = await loadConfig(resolvedVaultPath);
                const normalized = normalizeAlertSchedule(
                  newConfig.watch?.alertSchedule ?? [],
                );
                alertSchedule = normalized.valid;
                timezone = newConfig.timezone ?? "UTC";
                // Config updates don't need to trigger a full run.
                return;
              } catch (err) {
                console.error(
                  `[watch] Failed to reload config:`,
                  (err as Error).message,
                );
              }
            }

            runFast(relPaths);
          },
          {
            debounce: fastDebounce,
            maxDebounce: 30_000,
            growthFactor: 1.5,
            additionalFiles: [CONFIG_FILENAME],
            onRawNotify: (relPath, eventType) =>
              fullDebouncer.notify(relPath, eventType),
            canWatch: (p) => tuiFileManager.canWatch(p),
          },
        );

        const stopScheduler = createAlertScheduler(
          () => alertSchedule,
          async () => {
            const dates = userLocalTime({ tz: timezone });
            await runner(
              {
                mode: "alert",
                vaultPath: resolvedVaultPath,
                queueJob,
                dryRun: false,
                env: process.env,
                dates,
              },
              tuiFileManager,
            );
          },
          timezone,
        );

        watchCleanup = () => {
          stopWatcher();
          stopScheduler();
          fullDebouncer.dispose();
        };
      },

      stopWatching() {
        watchCleanup?.();
        watchCleanup = null;
      },

      async initVault(dryRun: boolean) {
        const initResult = await runInitPass(resolvedVaultPath, dryRun);
        return {
          filesConverted: initResult.changes.length,
          filePaths: initResult.changes.map((c) => c.vaultFile.relativePath),
          finishedAt: Date.now(),
        } satisfies TuiInitResult;
      },
    };

    const tui = createMainTui({ vaultPath, actions, stateDir });
    process.on("SIGINT", () => {
      actions.stopWatching();
      tui.stop();
      process.exit(0);
    });

    // Local helpers that update the TUI store during watcher runs.
    async function runAll(glob?: string[]) {
      const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
      const { changes } = await runner(
        {
          mode: "all",
          vaultPath: resolvedVaultPath,
          queueJob,
          dryRun: false,
          onlyGlob: glob,
          env: process.env,
          dates,
        },
        tuiFileManager,
      );
      tui.store.dispatch({
        type: "run-complete",
        result: mapChangesToResult(changes, "all"),
      });
    }

    async function runFast(relPaths: string[]) {
      const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
      tui.store.dispatch({
        type: "file-changed",
        files: relPaths,
        delayMs: 5_000,
      });
      await runner(
        {
          mode: "fast",
          vaultPath: resolvedVaultPath,
          queueJob,
          dryRun: false,
          onlyGlob: relPaths,
          env: process.env,
          dates,
        },
        tuiFileManager,
      );
      tui.store.dispatch({ type: "debounce-fired" });
    }
  } else if (watch) {
    // ── Console watch mode (non-TTY fallback) ───────────────

    const fullDebounceMs = config.watch?.debounce ?? 30_000;
    const fastDebounce = 5_000;
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

    const watchConsoleFileManager = new FileWriteManager(vaultPath);
    const queuedJobs: Job[] = [];
    const consoleQueueJob = (job: Job) => {
      queuedJobs.push(job);
      queue(stateDir, job);
    };

    const consoleRun = async (
      runMode: PluginContext["mode"],
      glob?: string[],
    ) => {
      const dates = userLocalTime({ tz: timezone });
      const ctx: Omit<Parameters<typeof runner>[0], "dates"> = {
        mode: runMode,
        vaultPath,
        queueJob: consoleQueueJob,
        dryRun,
        onlyGlob: glob,
        env: process.env,
      };
      const { changes, report } = await runner(
        { ...ctx, dates },
        watchConsoleFileManager,
      );

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

    consoleRun("all");

    const fullDebouncer = createDebouncer({
      baseMs: fullDebounceMs,
      maxMs: Math.min(fullDebounceMs * 2, 60_000),
      onProcess: (relPaths) => consoleRun("all", relPaths),
      growthFactor: 1.15,
    });

    const stopWatcher = vaultWatcher(
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

        await consoleRun("fast", relPaths);
      },
      {
        debounce: fastDebounce,
        maxDebounce: 30_000,
        growthFactor: 1.5,
        additionalFiles: [CONFIG_FILENAME],
        onRawNotify: (relPath, eventType) =>
          fullDebouncer.notify(relPath, eventType),
        canWatch: (p) => watchConsoleFileManager.canWatch(p),
      },
    );

    const stopScheduler = createAlertScheduler(
      () => alertSchedule,
      async () => {
        log("[watch] Running scheduled alert...");
        const dates = userLocalTime({ tz: timezone });
        const ctx: Omit<Parameters<typeof runner>[0], "dates"> = {
          mode: "alert",
          vaultPath,
          queueJob: consoleQueueJob,
          dryRun,
          env: process.env,
        };
        await runner({ ...ctx, dates }, watchConsoleFileManager);
      },
      timezone,
    );

    const stopAll = () => {
      stopWatcher();
      stopScheduler();
      fullDebouncer.dispose();
    };

    process.on("SIGINT", () => {
      log("\n[watch] Stopping watcher...");
      stopAll();
      process.exit(0);
    });
  } else {
    // ── One-shot mode (non-TTY) ────────────────────────────
    if (dryRun) {
      log(`Dry run: true`);
    } else {
      log(`Dry run: false`);
    }
    log("");

    const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
    const ctx: Omit<Parameters<typeof runner>[0], "dates"> = {
      mode: (mode ?? "all") as PluginContext["mode"],
      vaultPath,
      queueJob,
      dryRun,
      onlyGlob,
      env: process.env,
    };

    await runner({ ...ctx, dates }).catch((err: unknown) => {
      console.error("Fatal error:", (err as Error).message);
      process.exit(1);
    });
  }
}
