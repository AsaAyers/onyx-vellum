/**
 * Unit tests for createAlertScheduler in src/engine/scheduler.ts.
 *
 * These tests exercise the schedule-matching and deduplication logic using
 * vitest's fake-timer infrastructure so no real wall-clock time is needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createAlertScheduler,
  normalizeAlertSchedule,
} from "../src/engine/scheduler.js";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("normalizeAlertSchedule", () => {
  it("normalizes single-digit values and deduplicates entries", () => {
    const result = normalizeAlertSchedule(["9:5", "09:05", " 09:5 "]);
    expect(result.valid).toEqual(["09:05"]);
    expect(result.invalid).toEqual([]);
  });

  it("returns invalid entries separately", () => {
    const result = normalizeAlertSchedule(["08:00", "25:00", "abc"]);
    expect(result.valid).toEqual(["08:00"]);
    expect(result.invalid).toEqual(["25:00", "abc"]);
  });
});

describe("createAlertScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Empty schedule — alert never fires
  // ---------------------------------------------------------------------------

  it("never fires when schedule is empty", async () => {
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => [],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(alerts).toHaveLength(0);

    stop();
  });

  // ---------------------------------------------------------------------------
  // Fires at the scheduled time
  // ---------------------------------------------------------------------------

  it("fires when the current time matches a scheduled entry", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 8, 0, 0)); // 08:00:00
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:00"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(1);

    stop();
  });

  it("fires immediately on startup when current time matches", () => {
    vi.setSystemTime(new Date(2026, 4, 7, 8, 0, 0)); // 08:00:00
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:00"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    expect(alerts).toHaveLength(1);
    stop();
  });

  it("does not fire when the current time does not match the schedule", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 9, 30, 0)); // 09:30
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:00", "18:00"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(0);

    stop();
  });

  it("matches schedule entries with single-digit hour/minute formatting", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 9, 5, 0)); // 09:05
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["9:5"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    expect(alerts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(alerts).toHaveLength(1);
    stop();
  });

  it("fires for any entry in a multi-time schedule that matches", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 18, 0, 0)); // 18:00
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:00", "12:00", "18:00"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(1);

    stop();
  });

  // ---------------------------------------------------------------------------
  // Fires at most once per minute window
  // ---------------------------------------------------------------------------

  it("fires at most once even when the interval checks multiple times in the same minute", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 8, 0, 0)); // 08:00:00
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:00"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 }, // check every second
    );

    // Advance 5 seconds — five checks, all at 08:00 — only one alert.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(alerts).toHaveLength(1);

    stop();
  });

  // ---------------------------------------------------------------------------
  // Fires again at a subsequent scheduled time
  // ---------------------------------------------------------------------------

  it("fires again when a different scheduled time is reached", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 8, 0, 0)); // 08:00
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:00", "09:00"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    // First check fires at 08:00.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(1);

    // Jump clock to 09:00.
    vi.setSystemTime(new Date(2026, 4, 7, 9, 0, 0));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(2);

    stop();
  });

  it("fires again at the same time on the next day", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 8, 0, 0)); // day 1, 08:00
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:00"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(1);

    // Jump to the next day at 08:00.
    vi.setSystemTime(new Date(2026, 4, 8, 8, 0, 0));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(2);

    stop();
  });

  // ---------------------------------------------------------------------------
  // stop() cancels the interval
  // ---------------------------------------------------------------------------

  it("stop function cancels interval ticks after startup check", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 8, 0, 0));
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:01"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    // Cancel before the first interval tick reaches 08:01.
    stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(0);
  });

  it("stop function cancels the interval even if called after the first fire", async () => {
    vi.setSystemTime(new Date(2026, 4, 7, 8, 0, 0));
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["08:00"],
      async () => {
        alerts.push("fired");
      },
      tz,
      { intervalMs: 1_000 },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(1);

    // Stop, then jump to next day at 08:00.
    stop();
    vi.setSystemTime(new Date(2026, 4, 8, 8, 0, 0));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(alerts).toHaveLength(1); // no additional fire
  });

  it("evaluates schedule times in configured timezone when provided", () => {
    // 2026-05-07T00:30:00Z is 17:30 in America/Los_Angeles (previous day).
    vi.setSystemTime(new Date("2026-05-07T00:30:00.000Z"));
    const alerts: string[] = [];
    const stop = createAlertScheduler(
      () => ["17:30"],
      async () => {
        alerts.push("fired");
      },
      "America/Los_Angeles",
      {
        intervalMs: 1_000,
      },
    );

    expect(alerts).toHaveLength(1);
    stop();
  });
});
