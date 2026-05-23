import { describe, it, expect, vi } from "vitest";
import { createStopAll } from "../src/engine/watchMode.js";

describe("createStopAll", () => {
  it("calls each stop handler once in order", () => {
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();

    const stopAll = createStopAll([first, second, third]);
    stopAll();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
    expect(first.mock.invocationCallOrder[0]).toBeLessThan(
      second.mock.invocationCallOrder[0],
    );
    expect(second.mock.invocationCallOrder[0]).toBeLessThan(
      third.mock.invocationCallOrder[0],
    );
  });
});
