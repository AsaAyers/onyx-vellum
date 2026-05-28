import { describe, it, expect } from "vitest";
import { computeDebounceRemaining } from "../../src/tui/main/watchHelpers.js";

describe("computeDebounceRemaining", () => {
  it("returns full delay when no time has passed", () => {
    expect(computeDebounceRemaining(1000, 5000, 1000)).toBe(5000);
  });

  it("returns remaining time when some has passed", () => {
    expect(computeDebounceRemaining(1000, 5000, 3000)).toBe(3000);
  });

  it("returns 0 when delay has elapsed", () => {
    expect(computeDebounceRemaining(1000, 5000, 7000)).toBe(0);
  });

  it("returns 0 when past the delay", () => {
    expect(computeDebounceRemaining(1000, 5000, 10000)).toBe(0);
  });

  it("returns 0 for zero delay", () => {
    expect(computeDebounceRemaining(1000, 0, 2000)).toBe(0);
  });
});
