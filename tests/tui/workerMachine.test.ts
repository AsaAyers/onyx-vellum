import { describe, it, expect } from "vitest";
import { workerReducer, INITIAL_WORKER_STATE } from "../../src/tui/worker/workerMachine.js";
import type { WorkerTuiState, WorkerTuiEvent } from "../../src/tui/worker/types.js";

describe("workerReducer", () => {
  describe("initial state", () => {
    it("starts in starting with expected defaults", () => {
      expect(INITIAL_WORKER_STATE).toEqual({
        name: "starting",
        startedAt: null,
        recoveredCount: 0,
        currentJob: null,
        jobHistory: [],
      });
    });
  });

  describe("started", () => {
    it("transitions starting → idle and records start time", () => {
      const before = Date.now();
      const ev: WorkerTuiEvent = { type: "started" };
      const next = workerReducer(INITIAL_WORKER_STATE, ev);
      expect(next.name).toBe("idle");
      expect(next.startedAt).toBeGreaterThanOrEqual(before);
    });

    it("does nothing when not in starting state", () => {
      const idle: WorkerTuiState = { ...INITIAL_WORKER_STATE, name: "idle", startedAt: 100 };
      const ev: WorkerTuiEvent = { type: "started" };
      expect(workerReducer(idle, ev)).toBe(idle);
    });
  });

  describe("recovery-complete", () => {
    it("records recovery count in starting state", () => {
      const ev: WorkerTuiEvent = { type: "recovery-complete", recovered: 3 };
      const next = workerReducer(INITIAL_WORKER_STATE, ev);
      expect(next.recoveredCount).toBe(3);
    });

    it("records recovery count in idle state", () => {
      const idle: WorkerTuiState = { ...INITIAL_WORKER_STATE, name: "idle", startedAt: 100 };
      const ev: WorkerTuiEvent = { type: "recovery-complete", recovered: 1 };
      const next = workerReducer(idle, ev);
      expect(next.recoveredCount).toBe(1);
    });
  });

  describe("poll-idle", () => {
    it("returns state unchanged", () => {
      const idle: WorkerTuiState = { ...INITIAL_WORKER_STATE, name: "idle", startedAt: 100 };
      const ev: WorkerTuiEvent = { type: "poll-idle" };
      expect(workerReducer(idle, ev)).toBe(idle);
    });
  });

  describe("job-started", () => {
    it("transitions idle → busy with current job", () => {
      const idle: WorkerTuiState = { ...INITIAL_WORKER_STATE, name: "idle", startedAt: 100 };
      const before = Date.now();
      const ev: WorkerTuiEvent = {
        type: "job-started",
        jobId: "job-1",
        jobType: "transcribe",
        detail: "{}",
      };
      const next = workerReducer(idle, ev);
      expect(next.name).toBe("busy");
      expect(next.currentJob).toEqual({
        id: "job-1",
        type: "transcribe",
        detail: "{}",
        startedAt: expect.any(Number),
      });
      expect(next.currentJob!.startedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("job-completed", () => {
    it("transitions busy → idle, adds entry to history", () => {
      const busy: WorkerTuiState = {
        ...INITIAL_WORKER_STATE,
        name: "busy",
        startedAt: 100,
        currentJob: { id: "job-1", type: "transcribe", detail: "{}", startedAt: 90 },
      };
      const before = Date.now();
      const ev: WorkerTuiEvent = {
        type: "job-completed",
        jobId: "job-1",
        jobType: "transcribe",
        detail: '{"id":"job-1"}',
      };
      const next = workerReducer(busy, ev);
      expect(next.name).toBe("idle");
      expect(next.currentJob).toBeNull();
      expect(next.jobHistory).toHaveLength(1);
      expect(next.jobHistory[0]).toMatchObject({
        id: "job-1",
        type: "transcribe",
        status: "completed",
        startedAt: 90,
        detail: '{"id":"job-1"}',
      });
      expect(next.jobHistory[0].finishedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("job-failed", () => {
    it("transitions busy → idle, adds failed entry with error", () => {
      const busy: WorkerTuiState = {
        ...INITIAL_WORKER_STATE,
        name: "busy",
        startedAt: 100,
        currentJob: { id: "job-2", type: "clean-transcription", detail: "{}", startedAt: 95 },
      };
      const ev: WorkerTuiEvent = {
        type: "job-failed",
        jobId: "job-2",
        jobType: "clean-transcription",
        detail: "{}",
        error: "timeout",
      };
      const next = workerReducer(busy, ev);
      expect(next.name).toBe("idle");
      expect(next.currentJob).toBeNull();
      expect(next.jobHistory).toHaveLength(1);
      expect(next.jobHistory[0]).toMatchObject({
        id: "job-2",
        type: "clean-transcription",
        status: "failed",
        detail: "{}",
        error: "timeout",
      });
    });
  });

  describe("stop", () => {
    it("transitions any state → stopped", () => {
      const ev: WorkerTuiEvent = { type: "stop" };
      const next = workerReducer(INITIAL_WORKER_STATE, ev);
      expect(next.name).toBe("stopped");
    });
  });

  describe("unexpected events", () => {
    it("ignores job-completed when not busy", () => {
      const ev: WorkerTuiEvent = {
        type: "job-completed",
        jobId: "j1",
        jobType: "transcribe",
        detail: "{}",
      };
      expect(workerReducer(INITIAL_WORKER_STATE, ev)).toBe(INITIAL_WORKER_STATE);
    });

    it("ignores job-failed when not busy", () => {
      const ev: WorkerTuiEvent = {
        type: "job-failed",
        jobId: "j1",
        jobType: "transcribe",
        detail: "{}",
        error: "err",
      };
      expect(workerReducer(INITIAL_WORKER_STATE, ev)).toBe(INITIAL_WORKER_STATE);
    });
  });
});
