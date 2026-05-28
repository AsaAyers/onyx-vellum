import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatFinishedTime,
  formatMode,
} from "../../src/tui/main/formatResults.js";

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds with one decimal", () => {
    expect(formatDuration(1_200)).toBe("1.2s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("formats exact minute", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });
});

describe("formatFinishedTime", () => {
  it("formats epoch ms to HH:MM:SS", () => {
    const d = new Date(2026, 4, 3, 14, 5, 3);
    expect(formatFinishedTime(d.getTime())).toBe("14:05:03");
  });

  it("pads single digits", () => {
    const d = new Date(2026, 0, 1, 9, 5, 3);
    expect(formatFinishedTime(d.getTime())).toBe("09:05:03");
  });
});

describe("formatMode", () => {
  it('formats "all"', () => {
    expect(formatMode("all")).toBe("Full run");
  });

  it('formats "alert"', () => {
    expect(formatMode("alert")).toBe("Alert");
  });

  it('formats "single"', () => {
    expect(formatMode("single")).toBe("Single file");
  });
});
