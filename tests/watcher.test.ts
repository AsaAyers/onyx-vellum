import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncer, vaultWatcher } from "../src/engine/vaultWatcher.js";

// ---------------------------------------------------------------------------
// Mock node:fs (watch) — shared state for vaultWatcher tests
// ---------------------------------------------------------------------------

import type { FSWatcher } from "node:fs";

const watchMockContext = vi.hoisted(() => {
  const watchCallback: (
    eventType: string,
    filename: string | null,
  ) => void = () => {};
  const mockWatcher: FSWatcher = {
    close: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
  } as unknown as FSWatcher;
  return { watchCallback, mockWatcher };
});

vi.mock("node:fs", () => ({
  watch: (
    _path: string,
    _opts: { recursive: boolean },
    callback: (eventType: string, filename: string | null) => void,
  ) => {
    watchMockContext.watchCallback = callback;
    return watchMockContext.mockWatcher;
  },
}));

// Silence heartbeat writes.
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(),
}));

describe("createDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // First change always uses baseMs (calls=1, growthFactor^(0) = 1).
  // ---------------------------------------------------------------------------

  it("starts with baseMs delay for the first change", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 10_000,
      onProcess: async (paths) => {
        processed.push(...paths);
      },
      growthFactor: 2,
    });

    notify("notes/foo.md", "change");
    await vi.advanceTimersByTimeAsync(999);
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(processed).toEqual(["notes/foo.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // Additional changes multiply the delay by growthFactor each time.
  // ---------------------------------------------------------------------------

  it("multiplies delay on successive changes within the same batch", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 10_000,
      onProcess: async (paths) => {
        processed.push(...paths);
      },
      growthFactor: 2,
    });

    notify("a.md", "change"); // calls=1, delay=1000, would fire at t=1000
    await vi.advanceTimersByTimeAsync(100);
    notify("a.md", "change"); // calls=2, delay=2000, reset to fire at t=2100

    // Not yet at the multiplied delay.
    await vi.advanceTimersByTimeAsync(1999); // t=2099
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1); // t=2100
    expect(processed).toEqual(["a.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // The delay is capped at maxMs however large growthFactor × calls gets.
  // ---------------------------------------------------------------------------

  it("caps delay at maxMs", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 2_500,
      onProcess: async (paths) => {
        processed.push(...paths);
      },
      growthFactor: 10,
    });

    // calls=1: delay = min(2500, 1000) = 1000
    // calls=2: delay = min(2500, 1000 × 10¹ = 10000) = 2500  ← capped
    notify("a.md", "change");
    await vi.advanceTimersByTimeAsync(200);
    notify("a.md", "change");

    await vi.advanceTimersByTimeAsync(2499); // t=2699
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1); // t=2700 = 200 + 2500
    expect(processed).toEqual(["a.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // The calls counter resets every time the timer fires, so a subsequent batch
  // of changes starts again from baseMs.
  // ---------------------------------------------------------------------------

  it("resets the calls counter after the timer fires", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 10_000,
      onProcess: async (paths) => {
        processed.push(...paths);
      },
      growthFactor: 2,
    });

    // First batch — single change, delay = 1000.
    notify("a.md", "change");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(processed).toEqual(["a.md"]);
    processed.length = 0;

    // Second batch — should start fresh (calls=1, delay=1000).
    notify("b.md", "change");
    await vi.advanceTimersByTimeAsync(999);
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(processed).toEqual(["b.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // Custom growthFactor is honoured (1.5, 3, etc.).
  // ---------------------------------------------------------------------------

  it("supports a custom growthFactor", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 10_000,
      onProcess: async (paths) => {
        processed.push(...paths);
      },
      growthFactor: 3,
    });

    // calls=1: delay = 1000
    // calls=2: delay = min(10000, round(1000 × 3¹)) = 3000
    notify("a.md", "change");
    await vi.advanceTimersByTimeAsync(500);
    notify("a.md", "change");

    await vi.advanceTimersByTimeAsync(2999); // t=3499
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1); // t=3500 = 500 + 3000
    expect(processed).toEqual(["a.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // Classic debounce: a change cancels the pending timer and reschedules it
  // with the (potentially grown) delay.
  // ---------------------------------------------------------------------------

  it("resets the timer when a new change arrives before the current delay expires", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 10_000,
      onProcess: async (paths) => {
        processed.push(...paths);
      },
      growthFactor: 2,
    });

    notify("a.md", "change"); // calls=1, delay=1000, would fire at t=1000
    await vi.advanceTimersByTimeAsync(900);
    notify("a.md", "change"); // calls=2, delay=2000, reset to fire at t=2900

    // The original deadline (t=1000) was cancelled.
    await vi.advanceTimersByTimeAsync(100);
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1900); // t=2900
    expect(processed).toEqual(["a.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // Batch deduplication — unchanged behaviour with backoff active.
  // ---------------------------------------------------------------------------

  it("deduplicates repeated changes for the same file within a batch", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 10_000,
      onProcess: async (paths) => {
        processed.push(...paths);
      },
      growthFactor: 2,
    });

    notify("notes/a.md", "change"); // calls=1, delay=1000
    notify("notes/a.md", "rename"); // calls=2, delay=2000
    notify("notes/a.md", "change"); // calls=3, delay=4000

    await vi.advanceTimersByTimeAsync(4_000);
    expect(processed).toEqual(["notes/a.md"]);

    dispose();
  });

  it("batches multiple distinct files into a single processing run", async () => {
    const processed: string[][] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 10_000,
      onProcess: async (paths) => {
        processed.push(paths);
      },
      growthFactor: 2,
    });

    notify("notes/a.md", "change");
    await vi.advanceTimersByTimeAsync(500);
    notify("notes/b.md", "change"); // calls=2, delay=2000

    await vi.advanceTimersByTimeAsync(2_000); // t=2500
    expect(processed).toHaveLength(1);
    expect(new Set(processed[0])).toEqual(
      new Set(["notes/a.md", "notes/b.md"]),
    );

    dispose();
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  it("dispose cancels a pending timer so onProcess is never called", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer({
      baseMs: 1_000,
      maxMs: 10_000,
      onProcess: async (paths) => {
        processed.push(...paths);
      },
      growthFactor: 2,
    });

    notify("notes/foo.md", "change");
    dispose();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(processed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// vaultWatcher
// ---------------------------------------------------------------------------

describe("vaultWatcher", () => {
  const vaultPath = "/tmp/test-vault";
  const onProcess = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    onProcess.mockClear();
    watchMockContext.watchCallback = () => {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // File filtering
  // -----------------------------------------------------------------------

  it("forwards .md file changes to the debouncer", () => {
    const stop = vaultWatcher(vaultPath, onProcess);

    watchMockContext.watchCallback("change", "notes/test.md");

    // Fast-forward past the default 60s debounce.
    vi.advanceTimersByTime(60_001);
    expect(onProcess).toHaveBeenCalledWith(["notes/test.md"]);

    stop();
  });

  it("ignores non-.md files", () => {
    const stop = vaultWatcher(vaultPath, onProcess);

    watchMockContext.watchCallback("change", "notes/data.json");
    vi.advanceTimersByTime(60_001);
    expect(onProcess).not.toHaveBeenCalled();

    stop();
  });

  it("ignores files inside hidden path segments (starting with '.')", () => {
    const stop = vaultWatcher(vaultPath, onProcess);

    watchMockContext.watchCallback("change", ".obsidian/config.json");
    watchMockContext.watchCallback("change", "notes/.trash/deleted.md");
    vi.advanceTimersByTime(60_001);
    expect(onProcess).not.toHaveBeenCalled();

    stop();
  });

  it("forwards additionalFiles regardless of extension or hidden segments", () => {
    const stop = vaultWatcher(vaultPath, onProcess, {
      additionalFiles: [".config.yml"],
    });

    // This file is listed in additionalFiles -> should be forwarded.
    watchMockContext.watchCallback("change", ".config.yml");
    vi.advanceTimersByTime(60_001);
    expect(onProcess).toHaveBeenCalledWith([".config.yml"]);

    stop();
  });

  it("ignores null filename events", () => {
    const stop = vaultWatcher(vaultPath, onProcess);

    watchMockContext.watchCallback("change", null);
    vi.advanceTimersByTime(60_001);
    expect(onProcess).not.toHaveBeenCalled();

    stop();
  });

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  it("resets heartbeatTimestamp when the timestamp file changes", () => {
    const stop = vaultWatcher(vaultPath, onProcess);

    // Simulate the watcher writing the timestamp file.
    watchMockContext.watchCallback("change", ".onyx-watch-timestamp");
    // This should reset heartbeatTimestamp without forwarding to onProcess.
    vi.advanceTimersByTime(60_001);
    expect(onProcess).not.toHaveBeenCalled();

    stop();
  });

  // -----------------------------------------------------------------------
  // Stop / cleanup
  // -----------------------------------------------------------------------

  it("stop function closes the watcher and cancels pending debounce", () => {
    const stop = vaultWatcher(vaultPath, onProcess);

    watchMockContext.watchCallback("change", "notes/foo.md");
    stop();

    vi.advanceTimersByTime(60_001);
    expect(onProcess).not.toHaveBeenCalled();
    expect(watchMockContext.mockWatcher.close).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // canWatch gate
  // -----------------------------------------------------------------------

  it("respects FileWriteManager.canWatch (skips when writing is in progress)", async () => {
    const { FileWriteManager } =
      await import("../src/engine/FileWriteManager.js");
    const { VaultFile } = await import("../src/engine/VaultFile.js");
    const fwm = new FileWriteManager(vaultPath);
    const vf = new VaultFile({
      absolutePath: vaultPath + "/notes/doc.md",
      relativePath: "notes/doc.md",
      vaultPath,
      isNew: true,
    });
    fwm.stage(vf, "content");
    await fwm.commit(true);

    const stop = vaultWatcher(vaultPath, onProcess, {
      canWatch: (p) => fwm.canWatch(p),
    });

    watchMockContext.watchCallback("change", "notes/doc.md");
    vi.advanceTimersByTime(60_001);
    expect(onProcess).not.toHaveBeenCalled();

    stop();
  });

  // -----------------------------------------------------------------------
  // createDebouncer error (error does not propagate to consumer)
  // -----------------------------------------------------------------------

  it("createDebouncer onProcess error does not reject the notify call", async () => {
    // A createDebouncer that rejects -> error is caught and logged.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onProcess = vi.fn().mockRejectedValue(new Error("processing failed"));

    const { notify, dispose } = createDebouncer({
      baseMs: 100,
      maxMs: 100,
      onProcess,
    });

    notify("notes/err.md", "change");
    await vi.advanceTimersByTimeAsync(100);

    expect(onProcess).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    dispose();
    consoleSpy.mockRestore();
  });
});
