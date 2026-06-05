import { createDebouncer, vaultWatcher } from "../engine/vaultWatcher.js";
import {
  createAlertScheduler,
  normalizeAlertSchedule,
} from "../engine/createAlertScheduler.js";
import { CONFIG_FILENAME, loadConfig, type Config } from "../loadConfig.js";
import type { PluginContext } from "../markdown/types.js";

export type WatchRunResult = {
  fileAlerts?: Map<string, null | string[]>;
};

export interface WatchOrchestratorCallbacks {
  run: (
    mode: PluginContext["mode"],
    glob?: string[],
    alertRunContext?: PluginContext["alertRunContext"],
  ) => Promise<WatchRunResult | void>;
  onRawNotify?: (
    relPath: string,
    eventType: string,
    fastCallCount: number,
  ) => void;
  canWatch?: (path: string) => boolean;
}

export interface WatchOrchestratorHandle {
  start: () => void;
  stop: () => void;
}

export function createWatchOrchestrator(
  vaultPath: string,
  config: Config,
  callbacks: WatchOrchestratorCallbacks,
): WatchOrchestratorHandle {
  const fullDebounceMs = config.watch?.debounce ?? 30_000;
  const fastDebounceMs = 5_000;
  // Allow delays to grow up to the full run's timer.
  const fastMaxMs = fullDebounceMs;
  const fastGrowthFactor = 1.25;
  let fastCallCount = 0;

  const initialSchedule = normalizeAlertSchedule(
    config.watch?.alertSchedule ?? [],
  );
  let alertSchedule = initialSchedule.valid;
  let fileAlerts = new Map<string, null | string[]>();
  let timezone = config.timezone ?? "UTC";

  let fullDebouncer: ReturnType<typeof createDebouncer> | null = null;
  let stopWatcher: (() => void) | null = null;
  let stopScheduler: (() => void) | null = null;
  let started = false;

  async function onRun(
    mode: PluginContext["mode"],
    glob?: string[],
    alertRunContext?: PluginContext["alertRunContext"],
  ) {
    const result = await callbacks.run(mode, glob, alertRunContext);
    if (mode === "all" && result?.fileAlerts) {
      fileAlerts = new Map(result.fileAlerts);
    }
    if (mode === "fast") {
      fastCallCount = 0;
    }
  }

  const getEffectiveSchedule = (): string[] => {
    const fileSchedule = [...fileAlerts.values()]
      .flatMap((times) => times ?? [])
      .sort();
    return [...new Set([...alertSchedule, ...fileSchedule])];
  };

  return {
    start() {
      if (started) return;
      started = true;

      fullDebouncer = createDebouncer({
        baseMs: fullDebounceMs,
        maxMs: Math.min(fullDebounceMs * 2, 60_000),
        onProcess: (relPaths) => onRun("all", relPaths),
        growthFactor: 1.15,
      });

      stopWatcher = vaultWatcher(
        vaultPath,
        async (relPaths) => {
          const configChanged = relPaths.includes(CONFIG_FILENAME);
          if (configChanged) {
            console.warn(`[watch] Config changed, reloading...`);
            try {
              const newConfig = await loadConfig(vaultPath);
              const normalized = normalizeAlertSchedule(
                newConfig.watch?.alertSchedule ?? [],
              );
              alertSchedule = normalized.valid;
              timezone = newConfig.timezone ?? "UTC";
            } catch (err) {
              console.error(
                `[watch] Failed to reload config:`,
                (err as Error).message,
              );
            }
            return;
          }
          await onRun("fast", relPaths);
        },
        {
          debounce: fastDebounceMs,
          maxDebounce: fastMaxMs,
          growthFactor: fastGrowthFactor,
          additionalFiles: [CONFIG_FILENAME],
          onRawNotify: (relPath, eventType) => {
            if (relPath === CONFIG_FILENAME) {
              callbacks.onRawNotify?.(relPath, eventType, 0);
              return;
            }
            fastCallCount++;
            fullDebouncer!.notify(relPath, eventType);
            callbacks.onRawNotify?.(relPath, eventType, fastCallCount);
          },
          canWatch: callbacks.canWatch,
        },
      );

      stopScheduler = createAlertScheduler(
        getEffectiveSchedule,
        async (scheduledMinute) => {
          await onRun("alert", undefined, {
            scheduledMinute,
            baseAlertSchedule: alertSchedule,
          });
        },
        timezone,
      );

      onRun("all");
    },

    stop() {
      if (!started) return;
      started = false;
      stopWatcher?.();
      stopScheduler?.();
      fullDebouncer?.dispose();
      stopWatcher = null;
      stopScheduler = null;
      fullDebouncer = null;
    },
  };
}
