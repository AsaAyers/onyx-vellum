#!/usr/bin/env node
import { runner } from "./engine/runner.js";
import { FileWriteManager } from "./engine/FileWriteManager.js";
import type { ChangesArray } from "./engine/FileWriteManager.js";
import createDebug from "debug";
import { normalizeAlertSchedule } from "./engine/createAlertScheduler.js";
import { userLocalTime } from "./engine/userLocalTime.js";
import { helpText } from "./helpText.js";
import { loadConfig } from "./loadConfig.js";
import type { PluginContext } from "./markdown/types.js";
import { queue, resolveStateDir } from "./transcription/queue.js";
import type { Job } from "./transcription/types.js";
import { createMainTui } from "./tui/main/MainTui.js";
import type {
  MainActions,
  TuiInitResult,
  TuiRunResult,
} from "./tui/main/types.js";
import { computeDebounceDelay } from "./tui/main/watchHelpers.js";
import { parseArgs } from "./bridge/parseArgs.js";
import { createWatchOrchestrator } from "./bridge/WatchOrchestrator.js";

// eslint-disable-next-line no-console
const log = console.log.bind(console);

const parsed = parseArgs();

if (parsed.verbose) createDebug.enable("onyx:*");

// ── Help ───────────────────────────────────────────────────
if (parsed.help) {
  log(helpText);
  process.exit(0);
}

// ── View AST (debug) ───────────────────────────────────────
if (parsed.isViewAst) {
  const { viewAST } = await import("./viewAST.js");
  if (!parsed.viewAstFile) {
    console.error("Error: --view-ast requires a file path argument.");
    console.error("  Example: onyx-vellum --view-ast path/to/file.md");
    process.exit(1);
  }
  await viewAST(parsed.viewAstFile);
  process.exit(0);
}

// ── Worker ──────────────────────────────────────────────────
if (parsed.isWorker) {
  const { worker } = await import("./worker.js");
  await worker();
  process.exit(0);
}

// ── Vault path validation ──────────────────────────────────
if (!parsed.vaultPath) {
  console.error("Error: VAULT_PATH environment variable is required.");
  process.exit(1);
}
const resolvedVaultPath = parsed.vaultPath;
const baseRunnerArgs = {
  vaultPath: resolvedVaultPath,
  dryRun: parsed.dryRun,
  env: process.env,
};

// ── Init mode (baseline vault) ─────────────────────────────
if (parsed.init) {
  if (parsed.watch) {
    console.error("Error: --watch is not compatible with --init.");
    process.exit(1);
  }
  log(`Starting Markdown automation pipeline...`);
  log(`Vault: ${resolvedVaultPath}`);
  log(`Mode: init${parsed.dryRun ? " (dry run)" : ""}`);
  log("");

  const sDir = resolveStateDir(process.env, resolvedVaultPath);
  const cfg = await loadConfig(resolvedVaultPath);
  const qJob = (job: Job) => queue(sDir, job);

  const dates = userLocalTime({ tz: cfg.timezone ?? "UTC" });
  await runner({
    mode: "all",
    ...baseRunnerArgs,
    queueJob: qJob,
    dates,
  }).catch((err: unknown) => {
    console.error("Fatal error:", (err as Error).message);
    process.exit(1);
  });
  process.exit(0);
}

// ── Main pipeline ──────────────────────────────────────────
if (!process.stdout.isTTY && !parsed.watch) {
  if (!parsed.mode || (parsed.mode !== "all" && parsed.mode !== "alert")) {
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

const stateDir = resolveStateDir(process.env, resolvedVaultPath);
const config = await loadConfig(resolvedVaultPath);
const queueJob = (job: Job) => queue(stateDir, job);

function mapChangesToResult(
  changes: ChangesArray,
  fileMeta: Map<string, { diff: string; jobs: Job[] }>,
  resultMode: TuiRunResult["mode"],
): TuiRunResult {
  const finishedAt = Date.now();
  const fileDetails: Record<string, { diff: string; jobs: Job[] }> = {};
  for (const c of changes) {
    const meta = fileMeta.get(c.vaultFile.relativePath);
    if (meta) {
      const key = `${finishedAt}:${c.vaultFile.relativePath}`;
      fileDetails[key] = meta;
    }
  }
  return {
    filesWritten: changes.length,
    filePaths: changes.map((c) => c.vaultFile.relativePath),
    mode: resultMode,
    finishedAt,
    fileDetails,
  };
}

if (parsed.tui) {
  // ── TUI shell ──────────────────────────────────────────
  const tuiFileManager = new FileWriteManager(resolvedVaultPath);

  let orchestrator: ReturnType<typeof createWatchOrchestrator> | null = null;

  const actions: MainActions = {
    async runAll(dryRun: boolean) {
      const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
      const { changes, fileMeta } = await runner(
        {
          mode: "all",
          ...baseRunnerArgs,
          queueJob,
          dryRun,
          dates,
        },
        tuiFileManager,
      );
      return mapChangesToResult(changes, fileMeta, "all");
    },

    async runAlert(dryRun: boolean) {
      const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
      const { changes, fileMeta } = await runner(
        {
          mode: "alert",
          ...baseRunnerArgs,
          queueJob,
          dryRun,
          dates,
        },
        tuiFileManager,
      );
      return mapChangesToResult(changes, fileMeta, "alert");
    },

    async runSingleFile(relPath: string, dryRun: boolean) {
      const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
      const { changes, fileMeta } = await runner(
        {
          mode: "all",
          ...baseRunnerArgs,
          queueJob,
          dryRun,
          onlyGlob: [relPath],
          dates,
        },
        tuiFileManager,
      );
      return mapChangesToResult(changes, fileMeta, "single");
    },

    startWatching() {
      orchestrator = createWatchOrchestrator(resolvedVaultPath, config, {
        run: async (runMode, glob, alertRunContext) => {
          if (runMode === "alert") {
            const dates = userLocalTime({
              tz: config.timezone ?? "UTC",
            });
            await runner(
              {
                mode: "alert",
                ...baseRunnerArgs,
                queueJob,
                dryRun: tui.store.getState().dryRun,
                dates,
                alertRunContext,
              },
              tuiFileManager,
            );
            return undefined;
          }
          tui.store.dispatch({ type: "debounce-fired" });
          const dates = userLocalTime({
            tz: config.timezone ?? "UTC",
          });
          const { changes, fileMeta, fileAlerts } = await runner(
            {
              ...baseRunnerArgs,
              mode: runMode === "fast" ? "all" : runMode,
              queueJob,
              dryRun: tui.store.getState().dryRun,
              onlyGlob: glob,
              dates,
            },
            tuiFileManager,
          );
          tui.store.dispatch({
            type: "run-complete",
            result: mapChangesToResult(changes, fileMeta, "all"),
          });
          return { fileAlerts };
        },
        onRawNotify: (relPath, _eventType, callCount) => {
          tui.store.dispatch({
            type: "file-changed",
            files: [relPath],
            delayMs: computeDebounceDelay(5_000, 1.5, callCount, 30_000),
            growthFactor: 1.5,
            callCount,
          });
        },
        canWatch: (p) => tuiFileManager.canWatch(p),
      });
      orchestrator.start();
    },

    stopWatching() {
      orchestrator?.stop();
      orchestrator = null;
    },

    async initVault(dryRun: boolean) {
      const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
      const { changes } = await runner(
        {
          ...baseRunnerArgs,
          mode: "all",
          queueJob,
          dryRun,
          dates,
        },
        tuiFileManager,
      );
      return {
        filesConverted: changes.length,
        filePaths: changes.map((c) => c.vaultFile.relativePath),
        finishedAt: Date.now(),
      } satisfies TuiInitResult;
    },
  };

  const tui = createMainTui({
    vaultPath: resolvedVaultPath,
    actions,
    stateDir,
  });
  process.on("SIGINT", () => {
    orchestrator?.stop();
    tui.stop();
    process.exit(0);
  });
} else if (parsed.watch) {
  // ── Console watch mode ──────────────────────────────────
  log(`Starting Markdown automation pipeline...`);
  log(`Vault: ${resolvedVaultPath}`);
  log(`Mode: watch${parsed.dryRun ? " (dry run)" : ""}`);
  log(`Debounce: ${config.watch?.debounce ?? 30_000}ms`);
  const initSchedule = normalizeAlertSchedule(
    config.watch?.alertSchedule ?? [],
  );
  if (initSchedule.valid.length > 0) {
    log(`Alert schedule: ${initSchedule.valid.join(", ")}`);
  } else {
    log(`Alert schedule: (none configured — alert will not fire)`);
  }
  if (initSchedule.invalid.length > 0) {
    console.warn(
      `[watch] Ignoring invalid alert schedule entries: ${initSchedule.invalid.join(", ")}`,
    );
  }
  log("");
  log(`Watching vault for markdown changes...`);
  log(`Press Ctrl+C to stop.`);
  log("");

  log(`[watch] Running all rules on startup...`);

  const watchConsoleFileManager = new FileWriteManager(resolvedVaultPath);
  const queuedJobs: Job[] = [];
  const consoleQueueJob = (job: Job) => {
    queuedJobs.push(job);
    queue(stateDir, job);
  };

  const consoleRun = async (
    runMode: PluginContext["mode"],
    glob?: string[],
    alertRunContext?: PluginContext["alertRunContext"],
  ) => {
    const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
    const { changes, report, fileAlerts } = await runner(
      {
        mode: runMode,
        vaultPath: resolvedVaultPath,
        queueJob: consoleQueueJob,
        dryRun: parsed.dryRun,
        onlyGlob: glob,
        env: process.env,
        dates,
        alertRunContext,
      },
      watchConsoleFileManager,
    );

    if (changes.length > 0 || queuedJobs.length > 0) {
      log(`=== Report ===`);
      log(report);
      if (queuedJobs.length > 0) {
        log(`Jobs queued:`);
      }
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

    return { fileAlerts };
  };

  const orchestrator = createWatchOrchestrator(resolvedVaultPath, config, {
    run: async (runMode, glob, alertRunContext) => {
      if (runMode === "alert") {
        log("[watch] Running scheduled alert...");
      }
      return consoleRun(runMode, glob, alertRunContext);
    },
    canWatch: (p) => watchConsoleFileManager.canWatch(p),
    onProgress: (text) => {
      process.stdout.write(text);
    },
  });
  orchestrator.start();

  process.on("SIGINT", () => {
    log("\n[watch] Stopping watcher...");
    orchestrator.stop();
    process.exit(0);
  });
} else {
  // ── One-shot mode ───────────────────────────────────────
  log(`Starting Markdown automation pipeline...`);
  log(`Vault: ${resolvedVaultPath}`);
  if (parsed.dryRun) {
    log(`Dry run: true`);
  } else {
    log(`Dry run: false`);
  }
  log("");

  const dates = userLocalTime({ tz: config.timezone ?? "UTC" });
  const { report } = await runner({
    mode: (parsed.mode ?? "all") as PluginContext["mode"],
    vaultPath: resolvedVaultPath,
    queueJob,
    dryRun: parsed.dryRun,
    onlyGlob: parsed.onlyGlob,
    env: process.env,
    dates,
  }).catch((err: unknown) => {
    console.error("Fatal error:", (err as Error).message);
    process.exit(1);
  });
  log(report);
}
