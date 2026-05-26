import { watch } from "node:fs";
import { resolve, relative } from "node:path";
import { FileWriteManager } from "./io.js";
import { writeFile } from "node:fs/promises";
import createDebug from "debug";

const debug = createDebug("onyx:watcher");

// eslint-disable-next-line no-console
const log = console.log.bind(console);

export type WatcherOptions = {
  /** Debounce duration in milliseconds. Defaults to 60 000 (60 s). */
  debounce?: number;
  /**
   * Extra vault-relative file paths to watch in addition to `*.md` files.
   * A file-change event is forwarded to `onProcess` whenever the changed
   * file's relative path appears in this set.  Useful for watching
   * configuration files such as `.onyx-vellum.json`.
   */
  additionalFiles?: string[];
};

/**
 * Creates a vault-wide debouncer that batches all changed files into one run.
 *
 * Each call to `notify(relPath, eventType)` adds `relPath` to a pending set and
 * resets a single timer shared by the whole vault. After `debounceMs`
 * milliseconds of inactivity, `onProcess` is invoked once with all changed
 * files since the previous run.
 */
export function createDebouncer(
  debounceMs: number,
  onProcess: (relPaths: string[]) => Promise<void>,
  backoff = false,
): {
  notify: (relPath: string, eventType: string) => void;
  dispose: () => void;
} {
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

    const ms = backoff
      ? Math.min(60_000, Math.log(calls * 3 + 1) * debounceMs)
      : debounceMs;
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
export function startVaultWatcher(
  vaultPath: string,
  onProcess: (relPaths: string[]) => Promise<void>,
  opts: WatcherOptions = {},
): () => void {
  const debounceMs = opts.debounce ?? 60_000;
  const extraFiles = new Set(opts.additionalFiles ?? []);
  const debouncer = createDebouncer(debounceMs, onProcess);

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
      if (!FileWriteManager.canWatch(absPath)) return;

      if (extraFiles.has(relPath)) {
        // Explicitly registered files (e.g. the config file) are always
        // forwarded regardless of extension or hidden status.
        debouncer.notify(relPath, eventType ?? "change");
        return;
      }

      if (!relPath.endsWith(".md")) return;

      // Skip hidden files and directories (any path segment starting with '.').
      // Obsidian and other tools write to .obsidian/, .trash/, etc., and those
      // events should never trigger rule processing.
      const segments = relPath.split(/[/\\]/);
      if (segments.some((seg) => seg.startsWith("."))) return;

      debouncer.notify(relPath, eventType ?? "change");
    },
  );

  return (): void => {
    watcher.close();
    debouncer.dispose();
    clearInterval(heartbeat);
  };
}
