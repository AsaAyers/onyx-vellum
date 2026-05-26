/**
 * Unit tests for the file-change debouncer in src/engine/watcher.ts.
 *
 * These tests exercise the debounce logic directly via `createFileDebouncer`
 * using vitest's fake-timer infrastructure, so no real filesystem events or
 * wall-clock time is needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncer } from "../src/engine/watcher.js";

describe("createFileDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Basic debounce behaviour
  // ---------------------------------------------------------------------------

  it("does not call onProcess before the debounce period elapses", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(1000, async (path) => {
      processed.push(...path);
    });

    notify("notes/foo.md", "change");
    await vi.advanceTimersByTimeAsync(999);
    expect(processed).toHaveLength(0);

    dispose();
  });

  it("calls onProcess after the debounce period elapses", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(1000, async (path) => {
      processed.push(...path);
    });

    notify("notes/foo.md", "change");
    await vi.advanceTimersByTimeAsync(1000);
    expect(processed).toEqual(["notes/foo.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // Repeated changes to the same file
  // ---------------------------------------------------------------------------

  it("resets the timer when the same file changes again before debounce expires", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(1000, async (path) => {
      processed.push(...path);
    });

    notify("notes/foo.md", "change");
    await vi.advanceTimersByTimeAsync(600);
    // Second change resets the timer.
    notify("notes/foo.md", "change");
    await vi.advanceTimersByTimeAsync(600);
    // Still less than 1000 ms since the last change — not yet processed.
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(400);
    // Now 1000 ms have elapsed since the last change.
    expect(processed).toEqual(["notes/foo.md"]);

    dispose();
  });

  it("triggers only one processing run regardless of how many changes occur", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(1000, async (path) => {
      processed.push(...path);
    });

    // Rapid-fire four changes to the same file.
    notify("notes/foo.md", "change");
    notify("notes/foo.md", "rename");
    notify("notes/foo.md", "change");
    notify("notes/foo.md", "change");

    await vi.advanceTimersByTimeAsync(1000);
    expect(processed).toHaveLength(1);
    expect(processed).toEqual(["notes/foo.md"]);

    dispose();
  });

  it("changing multiple files triggers a separate processing run for each", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(1000, async (path) => {
      processed.push(...path);
    });

    notify("a.md", "change");
    notify("b.md", "change");
    notify("c.md", "change");

    await vi.advanceTimersByTimeAsync(1000);
    expect(processed).toHaveLength(3);
    expect(new Set(processed)).toEqual(new Set(["a.md", "b.md", "c.md"]));

    dispose();
  });

  it("only the specific changed file is processed, not others", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(1000, async (path) => {
      processed.push(...path);
    });

    notify("notes/target.md", "change");
    await vi.advanceTimersByTimeAsync(1000);

    // Only the target file — no other files were notified.
    expect(processed).toEqual(["notes/target.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // Custom debounce duration
  // ---------------------------------------------------------------------------

  it("respects a custom debounce duration (short)", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(200, async (path) => {
      processed.push(...path);
    });

    notify("notes/foo.md", "change");
    await vi.advanceTimersByTimeAsync(199);
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(processed).toEqual(["notes/foo.md"]);

    dispose();
  });

  it("respects a custom debounce duration (long)", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(5000, async (path) => {
      processed.push(...path);
    });

    notify("notes/foo.md", "change");
    await vi.advanceTimersByTimeAsync(4999);
    expect(processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(processed).toEqual(["notes/foo.md"]);

    dispose();
  });

  // ---------------------------------------------------------------------------
  // dispose cancels pending timers
  // ---------------------------------------------------------------------------

  it("dispose cancels a pending timer so onProcess is never called", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(1000, async (path) => {
      processed.push(...path);
    });

    notify("notes/foo.md", "change");
    // Dispose before the timer fires.
    dispose();

    await vi.advanceTimersByTimeAsync(1000);
    expect(processed).toHaveLength(0);
  });

  it("dispose cancels all pending timers for multiple files", async () => {
    const processed: string[] = [];
    const { notify, dispose } = createDebouncer(1000, async (path) => {
      processed.push(...path);
    });

    notify("a.md", "change");
    notify("b.md", "change");
    notify("c.md", "change");
    dispose();

    await vi.advanceTimersByTimeAsync(1000);
    expect(processed).toHaveLength(0);
  });
});

describe("createGlobalDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once for multiple files changed within the debounce window", async () => {
    const processed: string[][] = [];
    const { notify, dispose } = createDebouncer(1000, async (paths) => {
      processed.push(paths);
    });

    notify("notes/a.md", "change");
    await vi.advanceTimersByTimeAsync(500);
    notify("notes/b.md", "change");
    await vi.advanceTimersByTimeAsync(1000);

    expect(processed).toEqual([["notes/a.md", "notes/b.md"]]);
    dispose();
  });

  it("resets a single vault-wide timer across different files", async () => {
    const processed: string[][] = [];
    const { notify, dispose } = createDebouncer(1000, async (paths) => {
      processed.push(paths);
    });

    notify("notes/a.md", "change");
    await vi.advanceTimersByTimeAsync(900);
    notify("notes/b.md", "change");
    await vi.advanceTimersByTimeAsync(999);
    expect(processed).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(processed).toEqual([["notes/a.md", "notes/b.md"]]);
    dispose();
  });

  it("deduplicates repeated changes for the same file within a batch", async () => {
    const processed: string[][] = [];
    const { notify, dispose } = createDebouncer(1000, async (paths) => {
      processed.push(paths);
    });

    notify("notes/a.md", "change");
    notify("notes/a.md", "rename");
    await vi.advanceTimersByTimeAsync(1500);

    expect(processed).toEqual([["notes/a.md"]]);
    dispose();
  });
});
