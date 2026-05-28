import { watch } from "node:fs";
import { resolve, relative } from "node:path";
import { writeFile } from "node:fs/promises";
import createDebug from "debug";

const debug = createDebug("onyx:watcher");

// eslint-disable-next-line no-console
const log = console.log.bind(console);

export type WatcherOptions = {
  /** Base debounce duration in milliseconds. Defaults to 60_000 (60 s). */
  debounce?: number;

  /**
   * Maximum debounce delay in milliseconds when exponential backoff is active.
   * When omitted (or equal to `debounce`), the delay is fixed and no backoff
   * is applied.
   */
  maxDebounce?: number;

  /**
   * Growth factor for exponential backoff.  Each successive change without
   * a processing run multiplies the current delay by this factor.
   * Defaults to 1.5.  Only used when `maxDebounce > debounce`.
   */
  growthFactor?: number;

  /**
   * Extra vault-relative file paths to watch in addition to `*.md` files.
   * A file-change event is forwarded to `onProcess` whenever the changed
   * file's relative path appears in this set.  Useful for watching
   * configuration files such as `.onyx-vellum.json`.
   */
  additionalFiles?: string[];

  /**
   * Callback invoked for every qualifying file-change event before the
   * internal debounce timer is scheduled.  Use this to pipe raw events
   * to an external debouncer (e.g. a "full run" debouncer) so that both
   * debouncers are reset by every change.
   */
  onRawNotify?: (relPath: string, eventType: string) => void;

  /**
   * Optional guard: when provided, file-change events are forwarded only
   * if this function returns true.  Used to suppress events triggered by
   * the runner's own writes (see FileWriteManager.canWatch).
   */
  canWatch?: (path: string) => boolean;
};

/**
 * Creates a vault-wide debouncer that batches all changed files into one run.
 *
 * Each call to `notify(relPath, eventType)` adds `relPath` to a pending set and
 * resets a single timer shared by the whole vault. After `debounceMs`
 * milliseconds of inactivity, `onProcess` is invoked once with all changed
 * files since the previous run.
 */
export function createDebouncer(options: {
  baseMs: number;
  maxMs: number;
  onProcess: (relPaths: string[]) => Promise<void>;
  growthFactor?: number;
}): {
  notify: (relPath: string, eventType: string) => void;
  dispose: () => void;
} {
  const { baseMs, maxMs, onProcess, growthFactor = 1.5 } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();

  let calls = 0;
  const notify = (relPath: string, eventType: string): void => {
    calls++;
    // Quiet extra logs that may happen while typing.
    if (!pending.has(relPath)) {
      log(`[watch] ${eventType}: ${relPath}`);
    }
    pending.add(relPath);

    if (timer !== undefined) {
      clearTimeout(timer);
    }

    const ms = Math.min(
      maxMs,
      Math.round(baseMs * Math.pow(growthFactor, calls - 1)),
    );
    debug(
      `Timer set for ${(ms / 1000).toFixed(0)} s (${calls} call${calls > 1 ? "s" : ""})`,
    );
    timer = setTimeout(() => {
      timer = undefined;
      calls = 0;
      const relPaths = [...pending].sort();
      pending.clear();
      log(`[watch] Processing after idle: ${relPaths.join(", ")}`);
      onProcess(relPaths).catch((err: unknown) => {
        console.error(
          `[watch] Error processing files:`,
          (err as Error).message,
        );
      });
    }, ms);
  };

  const dispose = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pending.clear();
  };

  return { notify, dispose };
}

/**
 * Start watching the vault directory for Markdown file changes.
 *
 * Uses Node.js's native `fs.watch()` with `recursive: true` — no polling.
 * All changed `.md` files are debounced as a single vault-wide batch.
 * `onProcess` fires once after `debounce` milliseconds of vault inactivity and
 * receives the deduplicated set of changed files.
 *
 * @param vaultPath  Absolute path to the vault root to watch.
 * @param onProcess  Async callback invoked with the relative path of a
 *                   changed file once its debounce timer expires.
 * @param opts       Optional configuration (`debounce` in ms, default 60 000).
 * @returns          A stop function — call it to close the watcher and cancel
 *                   any pending timers.
 */
export function vaultWatcher(
  vaultPath: string,
  onProcess: (relPaths: string[]) => Promise<void>,
  opts: WatcherOptions = {},
): () => void {
  const baseMs = opts.debounce ?? 60_000;
  const maxMs = opts.maxDebounce ?? baseMs;
  const growthFactor = opts.growthFactor ?? 1.5;
  const extraFiles = new Set(opts.additionalFiles ?? []);
  const { onRawNotify } = opts;
  const debouncer = createDebouncer({ baseMs, maxMs, onProcess, growthFactor });

  let heartbeatTimestamp = 0;
  const heartbeat = setInterval(async () => {
    if (heartbeatTimestamp !== 0) {
      console.warn(
        `[watch] No file changes detected for ${(
          (Date.now() - heartbeatTimestamp) /
          1000
        ).toFixed(
          0,
        )} s. If this continues, the watcher may be stuck and need to be restarted.`,
      );
    }

    heartbeatTimestamp = Date.now();
    await writeFile(
      resolve(vaultPath, `.onyx-watch-timestamp`),
      String(new Date()),
    );
  }, 30_000);

  const watcher = watch(
    vaultPath,
    { recursive: true },
    (eventType, filename) => {
      if (!filename) return;
      if (filename.endsWith(".onyx-watch-timestamp")) {
        heartbeatTimestamp = 0;
        return;
      }

      // resolve + relative normalises any platform path separators.
      const absPath = resolve(vaultPath, filename);
      const relPath = relative(vaultPath, absPath);
      if (opts.canWatch && !opts.canWatch(absPath)) return;

      if (extraFiles.has(relPath)) {
        // Explicitly registered files (e.g. the config file) are always
        // forwarded regardless of extension or hidden status.
        onRawNotify?.(relPath, eventType ?? "change");
        debouncer.notify(relPath, eventType ?? "change");
        return;
      }

      if (!relPath.endsWith(".md")) return;

      // Skip hidden files and directories (any path segment starting with '.').
      // Obsidian and other tools write to .obsidian/, .trash/, etc., and those
      // events should never trigger rule processing.
      const segments = relPath.split(/[/\\]/);
      if (segments.some((seg) => seg.startsWith("."))) return;

      onRawNotify?.(relPath, eventType ?? "change");
      debouncer.notify(relPath, eventType ?? "change");
    },
  );

  return (): void => {
    watcher.close();
    debouncer.dispose();
    clearInterval(heartbeat);
  };
}
