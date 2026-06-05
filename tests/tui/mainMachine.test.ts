import { describe, it, expect } from "vitest";
import { mainReducer, INITIAL_STATE } from "../../src/tui/main/mainMachine.js";
import type { MainState, MainEvent } from "../../src/tui/main/types.js";

const makeRunResult = (overrides?: Partial<MainState["lastRun"]>) => ({
  filesWritten: 1,
  filePaths: ["test.md"],
  mode: "all" as const,
  finishedAt: Date.now(),
  fileDetails: {},
  ...overrides,
});

const makeInitResult = (overrides?: Partial<MainState["lastInit"]>) => ({
  filesConverted: 1,
  filePaths: ["test.md"],
  finishedAt: Date.now(),
  ...overrides,
});

const RUNNING: MainState = {
  ...INITIAL_STATE,
  name: "running",
  runMode: "all",
};

const WATCHING_READY: MainState = {
  ...INITIAL_STATE,
  name: "watching",
  watchingSub: { name: "ready" },
};

const PICKING: MainState = {
  ...INITIAL_STATE,
  name: "picking",
};

const HELP: MainState = {
  ...INITIAL_STATE,
  name: "help",
};

describe("mainReducer", () => {
  describe("initial state", () => {
    it("starts in idle with expected defaults", () => {
      expect(INITIAL_STATE).toEqual({
        name: "idle",
        dryRun: false,
        lastRun: null,
        lastInit: null,
        runMode: null,
        watchingSub: null,
        fileDetails: {},
        fileViewCursor: "__sentinel__",
      });
    });
  });

  describe("run-start", () => {
    it("transitions idle → running", () => {
      const ev: MainEvent = { type: "run-start", runMode: "all" };
      const next = mainReducer(INITIAL_STATE, ev);
      expect(next.name).toBe("running");
      expect(next.runMode).toBe("all");
    });

    it("transitions picking → running", () => {
      const ev: MainEvent = { type: "run-start", runMode: "single" };
      const next = mainReducer(PICKING, ev);
      expect(next.name).toBe("running");
      expect(next.runMode).toBe("single");
    });

    it("is ignored when running", () => {
      const next = mainReducer(RUNNING, {
        type: "run-start",
        runMode: "all",
      });
      expect(next).toBe(RUNNING);
    });

    it("is ignored when watching", () => {
      const next = mainReducer(WATCHING_READY, {
        type: "run-start",
        runMode: "all",
      });
      expect(next).toBe(WATCHING_READY);
    });

    it("is ignored when on help", () => {
      const next = mainReducer(HELP, { type: "run-start", runMode: "all" });
      expect(next).toBe(HELP);
    });
  });

  describe("run-complete", () => {
    it("transitions running → idle and stores lastRun", () => {
      const result = makeRunResult();
      const next = mainReducer(RUNNING, {
        type: "run-complete",
        result,
      });
      expect(next.name).toBe("idle");
      expect(next.runMode).toBeNull();
      expect(next.lastRun).toEqual(result);
    });

    it("is ignored when idle", () => {
      const result = makeRunResult();
      const next = mainReducer(INITIAL_STATE, {
        type: "run-complete",
        result,
      });
      expect(next).toBe(INITIAL_STATE);
    });

    it("transitions watching/processing → watching/ready with processedFiles", () => {
      const processing: MainState = {
        ...INITIAL_STATE,
        name: "watching",
        watchingSub: { name: "processing", filePaths: ["a.md"] },
      };
      const result = makeRunResult({ filePaths: ["a.md"] });
      const next = mainReducer(processing, {
        type: "run-complete",
        result,
      });
      expect(next.name).toBe("watching");
      expect(next.watchingSub).toEqual({
        name: "ready",
        processedFiles: ["a.md"],
      });
      expect(next.lastRun).toEqual(result);
    });

    it("updates lastRun in watching/ready", () => {
      const result = makeRunResult({ filePaths: ["b.md"] });
      const next = mainReducer(WATCHING_READY, {
        type: "run-complete",
        result,
      });
      expect(next.name).toBe("watching");
      expect(next.lastRun).toEqual(result);
    });
  });

  describe("init-start", () => {
    it("transitions idle → running with runMode=init", () => {
      const next = mainReducer(INITIAL_STATE, { type: "init-start" });
      expect(next.name).toBe("running");
      expect(next.runMode).toBe("init");
    });

    it("is ignored when already running", () => {
      const next = mainReducer(RUNNING, { type: "init-start" });
      expect(next).toBe(RUNNING);
    });
  });

  describe("init-complete", () => {
    it("transitions running(init) → idle and stores lastInit + lastRun", () => {
      const initState: MainState = {
        ...INITIAL_STATE,
        name: "running",
        runMode: "init",
      };
      const result = makeInitResult({ filesConverted: 5 });
      const next = mainReducer(initState, {
        type: "init-complete",
        result,
      });
      expect(next.name).toBe("idle");
      expect(next.runMode).toBeNull();
      expect(next.lastInit).toEqual(result);
      expect(next.lastRun).toMatchObject({
        filesWritten: 5,
        filePaths: result.filePaths,
        mode: "all",
        finishedAt: result.finishedAt,
        error: undefined,
        fileDetails: {},
      });
    });

    it("is ignored when running with non-init runMode", () => {
      const result = makeInitResult();
      const next = mainReducer(RUNNING, {
        type: "init-complete",
        result,
      });
      expect(next).toBe(RUNNING);
    });

    it("is ignored when idle", () => {
      const result = makeInitResult();
      const next = mainReducer(INITIAL_STATE, {
        type: "init-complete",
        result,
      });
      expect(next).toBe(INITIAL_STATE);
    });
  });

  describe("run-error", () => {
    it("transitions running → idle with error info", () => {
      const next = mainReducer(RUNNING, {
        type: "run-error",
        error: "boom",
      });
      expect(next.name).toBe("idle");
      expect(next.runMode).toBeNull();
      expect(next.lastRun).toMatchObject({
        filesWritten: 0,
        filePaths: [],
        error: "boom",
      });
    });

    it("transitions watching/processing → watching/ready", () => {
      const processing: MainState = {
        ...INITIAL_STATE,
        name: "watching",
        watchingSub: { name: "processing", filePaths: [] },
      };
      const next = mainReducer(processing, {
        type: "run-error",
        error: "boom",
      });
      expect(next.name).toBe("watching");
      expect(next.watchingSub).toEqual({ name: "ready" });
      expect(next.lastRun?.error).toBe("boom");
    });

    it("is ignored when idle", () => {
      const next = mainReducer(INITIAL_STATE, {
        type: "run-error",
        error: "boom",
      });
      expect(next).toBe(INITIAL_STATE);
    });

    it("stores error in watching/ready", () => {
      const next = mainReducer(WATCHING_READY, {
        type: "run-error",
        error: "boom",
      });
      expect(next.name).toBe("watching");
      expect(next.lastRun?.error).toBe("boom");
    });
  });

  describe("toggle-watching", () => {
    it("transitions idle → watching/ready", () => {
      const next = mainReducer(INITIAL_STATE, {
        type: "toggle-watching",
      });
      expect(next.name).toBe("watching");
      expect(next.watchingSub).toEqual({ name: "ready" });
    });

    it("transitions watching → idle and clears watchingSub", () => {
      const next = mainReducer(WATCHING_READY, {
        type: "toggle-watching",
      });
      expect(next.name).toBe("idle");
      expect(next.watchingSub).toBeNull();
    });

    it("is ignored when running", () => {
      const next = mainReducer(RUNNING, { type: "toggle-watching" });
      expect(next).toBe(RUNNING);
    });

    it("is ignored when picking", () => {
      const next = mainReducer(PICKING, { type: "toggle-watching" });
      expect(next).toBe(PICKING);
    });
  });

  describe("file-changed", () => {
    const fc = (files: string[], delayMs: number) =>
      ({
        type: "file-changed",
        files,
        delayMs,
        growthFactor: 1.5,
        callCount: 1,
      }) as const;

    const debouncing = (
      overrides?: Partial<{
        queuedFiles: string[];
        since: number;
        delayMs: number;
        growthFactor: number;
        callCount: number;
      }>,
    ): MainState => ({
      ...INITIAL_STATE,
      name: "watching" as const,
      watchingSub: {
        name: "debouncing" as const,
        queuedFiles: [],
        since: 100,
        delayMs: 1000,
        growthFactor: 1.5,
        callCount: 1,
        ...overrides,
      },
    });

    it("transitions watching/ready → watching/debouncing", () => {
      const next = mainReducer(WATCHING_READY, fc(["a.md"], 1000));
      expect(next.name).toBe("watching");
      expect(next.watchingSub).toMatchObject({
        name: "debouncing",
        queuedFiles: ["a.md"],
        delayMs: 1000,
      });
      expect(next.watchingSub).toHaveProperty("since");
    });

    it("accumulates files when already debouncing", () => {
      const d = debouncing({ queuedFiles: ["a.md"] });
      const next = mainReducer(d, fc(["b.md", "a.md"], 2000));
      expect(next.name).toBe("watching");
      expect(next.watchingSub).toMatchObject({
        name: "debouncing",
        queuedFiles: ["a.md", "b.md"],
        delayMs: 2000,
      });
    });

    it("is ignored when idle", () => {
      const next = mainReducer(INITIAL_STATE, fc(["a.md"], 1000));
      expect(next).toBe(INITIAL_STATE);
    });

    it("is ignored when processing", () => {
      const processing: MainState = {
        ...INITIAL_STATE,
        name: "watching",
        watchingSub: { name: "processing", filePaths: [] },
      };
      const next = mainReducer(processing, fc(["a.md"], 1000));
      expect(next).toBe(processing);
    });
  });

  describe("debounce-fired", () => {
    it("transitions watching/debouncing → watching/processing", () => {
      const debouncing: MainState = {
        ...INITIAL_STATE,
        name: "watching",
        watchingSub: {
          name: "debouncing",
          queuedFiles: ["a.md"],
          since: 100,
          delayMs: 1000,
          growthFactor: 1.5,
          callCount: 1,
        },
      };
      const next = mainReducer(debouncing, { type: "debounce-fired" });
      expect(next.name).toBe("watching");
      expect(next.watchingSub).toEqual({
        name: "processing",
        filePaths: ["a.md"],
      });
    });

    it("is ignored when watching/ready", () => {
      const next = mainReducer(WATCHING_READY, { type: "debounce-fired" });
      expect(next).toBe(WATCHING_READY);
    });

    it("is ignored when watching/processing", () => {
      const processing: MainState = {
        ...INITIAL_STATE,
        name: "watching",
        watchingSub: { name: "processing", filePaths: [] },
      };
      const next = mainReducer(processing, { type: "debounce-fired" });
      expect(next).toBe(processing);
    });

    it("is ignored when idle", () => {
      const next = mainReducer(INITIAL_STATE, { type: "debounce-fired" });
      expect(next).toBe(INITIAL_STATE);
    });
  });

  describe("toggle-dry-run", () => {
    it("flips dryRun from false to true", () => {
      const next = mainReducer(INITIAL_STATE, { type: "toggle-dry-run" });
      expect(next.dryRun).toBe(true);
    });

    it("flips dryRun from true to false", () => {
      const dirty = { ...INITIAL_STATE, dryRun: true };
      const next = mainReducer(dirty, { type: "toggle-dry-run" });
      expect(next.dryRun).toBe(false);
    });

    it("works in any state", () => {
      const next = mainReducer(RUNNING, { type: "toggle-dry-run" });
      expect(next.dryRun).toBe(true);
    });
  });

  describe("open-picker / close-picker", () => {
    it("transitions idle → picking", () => {
      const next = mainReducer(INITIAL_STATE, { type: "open-picker" });
      expect(next.name).toBe("picking");
    });

    it("is ignored when running", () => {
      const next = mainReducer(RUNNING, { type: "open-picker" });
      expect(next).toBe(RUNNING);
    });

    it("transitions picking → idle", () => {
      const next = mainReducer(PICKING, { type: "close-picker" });
      expect(next.name).toBe("idle");
    });

    it("is ignored when idle", () => {
      const next = mainReducer(INITIAL_STATE, { type: "close-picker" });
      expect(next).toBe(INITIAL_STATE);
    });
  });

  describe("show-help / hide-help", () => {
    it("transitions idle → help", () => {
      const next = mainReducer(INITIAL_STATE, { type: "show-help" });
      expect(next.name).toBe("help");
    });

    it("transitions picking → help", () => {
      const next = mainReducer(PICKING, { type: "show-help" });
      expect(next.name).toBe("help");
    });

    it("is a no-op when already on help", () => {
      const next = mainReducer(HELP, { type: "show-help" });
      expect(next).toBe(HELP);
    });

    it("transitions help → idle", () => {
      const next = mainReducer(HELP, { type: "hide-help" });
      expect(next.name).toBe("idle");
    });

    it("is ignored when idle", () => {
      const next = mainReducer(INITIAL_STATE, { type: "hide-help" });
      expect(next).toBe(INITIAL_STATE);
    });
  });
});
