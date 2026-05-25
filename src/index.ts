#!/usr/bin/env node
import { runAllRules, runInitPass } from "./engine/runner.js";
import { createGlobalDebouncer, startVaultWatcher } from "./engine/watcher.js";
import {
  createAlertScheduler,
  normalizeAlertSchedule,
} from "./engine/scheduler.js";
import { createStopAll } from "./engine/watchMode.js";
import { userLocalTime } from "./engine/timezone.js";
import { HELP_TEXT } from "./helpText.js";
import { loadConfig, CONFIG_FILENAME } from "./config.js";
import type { PluginContext } from "./markdown/PluginContext.js";
import { enqueue, resolveStateDir } from "./transcription/queue.js";
import type { Job } from "./transcription/types.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
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
  console.log(HELP_TEXT);
  process.exit(0);
}

const vaultPath = process.env["VAULT_PATH"];
if (!vaultPath) {
  console.error("Error: VAULT_PATH environment variable is required.");
  process.exit(1);
}

console.log(`Starting Markdown automation pipeline...`);
console.log(`Vault: ${vaultPath}`);

if (init) {
  if (watch) {
    console.error("Error: --watch is not compatible with --init.");
    process.exit(1);
  }
  console.log(`Mode: init${dryRun ? " (dry run)" : ""}`);
  console.log("");

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
  async function queueJob(job: Job) {
    if (!dryRun) {
      await enqueue(stateDir, job);
    }
  }
  const ruleContext: Omit<Parameters<typeof runAllRules>[0], "dates"> = {
    mode,
    vaultPath,
    queueJob,
    dryRun,
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
    const { report } = await runAllRules({
      ...ruleContext,
      mode,
      dates,
      onlyGlob: glob,
    });

    console.log(`=== Report ===`);
    console.log(report);
  };

  if (watch) {
    // Watch mode: load config to read the debounce and schedule settings.
    const debounce = config.watch?.debounce ?? 30_000;
    // Mutable so the scheduler picks up changes when the config is reloaded.
    const initialSchedule = normalizeAlertSchedule(
      config.watch?.alertSchedule ?? [],
    );
    let alertSchedule: string[] = initialSchedule.valid;
    let timezone = config.timezone ?? "UTC";

    console.log(`Mode: watch${dryRun ? " (dry run)" : ""}`);
    console.log(`Debounce: ${debounce}ms`);
    if (alertSchedule.length > 0) {
      console.log(`Alert schedule: ${alertSchedule.join(", ")}`);
    } else {
      console.log(`Alert schedule: (none configured — alert will not fire)`);
    }
    if (initialSchedule.invalid.length > 0) {
      console.warn(
        `[watch] Ignoring invalid alert schedule entries: ${initialSchedule.invalid.join(", ")}`,
      );
    }
    console.log("");
    console.log(`Watching vault for markdown changes...`);
    console.log(`Press Ctrl+C to stop.`);
    console.log("");

    console.log(`[watch] Running all rules on startup...`);
    run("all");

    const fastDebounce = 5_000;
    const fullDebouncer = createGlobalDebouncer(
      debounce - fastDebounce,
      (relPaths) => run("all", relPaths),
    );

    const stop = startVaultWatcher(
      vaultPath,
      async (relPaths) => {
        const configChanged = relPaths.includes(CONFIG_FILENAME);
        if (configChanged) {
          console.log(`[watch] Config changed, reloading...`);
          try {
            const newConfig = await loadConfig(vaultPath);
            const normalized = normalizeAlertSchedule(
              newConfig.watch?.alertSchedule ?? [],
            );
            alertSchedule = normalized.valid;
            timezone = newConfig.timezone ?? "UTC";
            if (alertSchedule.length > 0) {
              console.log(
                `[watch] Alert schedule updated: ${alertSchedule.join(", ")}`,
              );
            } else {
              console.log(
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
        relPaths.forEach((p) => fullDebouncer.notify(p, "change"));
      },
      { debounce: fastDebounce, additionalFiles: [CONFIG_FILENAME] },
    );

    // Run incompleteTaskAlert (and its transitive deps) on schedule only.
    const stopScheduler = createAlertScheduler(
      () => alertSchedule,
      async () => {
        console.log("[watch] Running scheduled alert...");
        await runAllRules({
          ...ruleContext,
          mode: "alert",
          dates: userLocalTime({ tz: timezone }),
        });
      },
      timezone,
    );

    const stopAll = createStopAll([stop, stopScheduler]);

    process.on("SIGINT", () => {
      console.log("\n[watch] Stopping watcher...");
      stopAll();
      process.exit(0);
    });
  } else {
    if (dryRun) {
      console.log(`Dry run: true`);
    } else {
      console.log(`Dry run: false`);
    }
    console.log("");

    await run(mode, onlyGlob).catch((err: unknown) => {
      console.error("Fatal error:", (err as Error).message);
      process.exit(1);
    });
  }
}
