#!/usr/bin/env node
import { runAllRules, runInitPass } from "./engine/runner.js";
import { startVaultWatcher } from "./engine/watcher.js";
import {
  createAlertScheduler,
  normalizeAlertSchedule,
} from "./engine/scheduler.js";
import { ALERT_RULE, createStopAll } from "./engine/watchMode.js";
import { toTimezoneDate } from "./engine/timezone.js";
import { HELP_TEXT } from "./helpText.js";
import { loadConfig, CONFIG_FILENAME } from "./config.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
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
  // Rule selection is required: either "all" or one or more rule names.
  if (positional.length === 0) {
    console.error('Error: specify "all" or a list of rule names to run.');
    console.error("");
    console.error("Examples:");
    console.error("  onyx-vellum all");
    console.error("  onyx-vellum --dry-run stampDone");
    console.error("");
    console.error("Run with --help for full usage information.");
    process.exit(1);
  }

  const selectedRuleNames: string[] | "all" =
    positional.length === 1 && positional[0] === "all" ? "all" : positional;

  // Single shared entry-point for rule execution.  Closures in all parameters
  // so both the one-shot and watch paths use exactly the same runAllRules call.
  const run = async (glob?: string[], timezone?: string): Promise<void> => {
    await runAllRules({
      vaultPath,
      today: toTimezoneDate(new Date(), timezone),
      dryRun,
      verbose,
      env: process.env,
      selectedRuleNames,
      onlyGlob: glob,
    });
  };

  if (watch) {
    // Watch mode: load config to read the debounce and schedule settings.
    loadConfig(vaultPath)
      .then(async (config) => {
        const debounce = config.watch?.debounce ?? 60_000;
        // Mutable so the scheduler picks up changes when the config is reloaded.
        const initialSchedule = normalizeAlertSchedule(
          config.watch?.alertSchedule ?? [],
        );
        let alertSchedule: string[] = initialSchedule.valid;
        let timezone = config.timezone;

        console.log(`Mode: watch${dryRun ? " (dry run)" : ""}`);
        console.log(`Debounce: ${debounce}ms`);
        if (alertSchedule.length > 0) {
          console.log(`Alert schedule: ${alertSchedule.join(", ")}`);
        } else {
          console.log(
            `Alert schedule: (none configured — alert will not fire)`,
          );
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

        const getNonConfigPaths = (relPaths: string[]): string[] =>
          relPaths.filter((p) => p !== CONFIG_FILENAME);

        console.log(`[watch] Running all rules on startup...`);
        await runAllRules({
          vaultPath,
          today: toTimezoneDate(new Date(), timezone),
          dryRun,
          verbose,
          env: process.env,
        });

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
                timezone = newConfig.timezone;
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

            const targetPaths = getNonConfigPaths(relPaths);
            if (targetPaths.length === 0) return;

            console.log(`[watch] Running rules for: ${targetPaths.join(", ")}`);

            await runAllRules({
              vaultPath,
              today: toTimezoneDate(new Date(), timezone),
              dryRun,
              verbose,
              env: process.env,
              onlyGlob: targetPaths,
            });
          },
          { debounce, additionalFiles: [CONFIG_FILENAME] },
        );

        // Run incompleteTaskAlert (and its transitive deps) on schedule only.
        const stopScheduler = createAlertScheduler(
          () => alertSchedule,
          async () => {
            console.log("[watch] Running scheduled alert...");
            await runAllRules({
              vaultPath,
              today: toTimezoneDate(new Date(), timezone),
              dryRun,
              verbose,
              env: process.env,
              selectedRuleNames: [ALERT_RULE],
            });
          },
          { getTimezone: () => timezone },
        );

        const stopAll = createStopAll([stop, stopScheduler]);

        process.on("SIGINT", () => {
          console.log("\n[watch] Stopping watcher...");
          stopAll();
          process.exit(0);
        });
      })
      .catch((err: unknown) => {
        console.error("Fatal error:", (err as Error).message);
        process.exit(1);
      });
  } else {
    if (dryRun) {
      console.log(`Dry run: true${verbose ? " (verbose)" : ""}`);
    } else {
      console.log(`Dry run: false`);
    }
    console.log("");

    loadConfig(vaultPath)
      .then((config) => run(onlyGlob, config.timezone))
      .catch((err: unknown) => {
        console.warn(
          `Warning: could not load vault config — ${(err as Error).message}. Using built-in defaults and local server timezone.`,
        );
        return run(onlyGlob);
      })
      .catch((err: unknown) => {
        console.error("Fatal error:", (err as Error).message);
        process.exit(1);
      });
  }
}
