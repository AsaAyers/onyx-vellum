import type { Job } from "../../transcription/types.js";

export type FileDetail = {
  diff: string;
  jobs: Job[];
};

export interface TuiRunResult {
  filesWritten: number;
  filePaths: string[];
  mode: "all" | "alert" | "single";
  finishedAt: number;
  error?: string;
  fileDetails: Record<string, FileDetail>;
}

export interface TuiInitResult {
  filesConverted: number;
  filePaths: string[];
  finishedAt: number;
  error?: string;
}

export type WatchingSubState =
  | { name: "ready"; processedFiles?: string[] }
  | {
      name: "debouncing";
      queuedFiles: string[];
      since: number;
      delayMs: number;
      growthFactor: number;
      callCount: number;
      processedFiles?: string[];
    }
  | { name: "processing"; filePaths: string[]; processedFiles?: string[] };

export interface MainState {
  name: "idle" | "running" | "watching" | "picking" | "help";
  dryRun: boolean;
  lastRun: TuiRunResult | null;
  lastInit: TuiInitResult | null;
  runMode: "all" | "alert" | "init" | "single" | null;
  watchingSub: WatchingSubState | null;
  fileDetails: Record<string, FileDetail>;
  fileViewCursor: string;
}

export type MainEvent =
  | { type: "run-start"; runMode: "all" | "alert" | "single" }
  | { type: "run-complete"; result: TuiRunResult }
  | { type: "init-start" }
  | { type: "init-complete"; result: TuiInitResult }
  | { type: "run-error"; error: string }
  | { type: "toggle-watching" }
  | { type: "file-changed"; files: string[]; delayMs: number; growthFactor: number; callCount: number }
  | { type: "debounce-fired" }
  | { type: "toggle-dry-run" }
  | { type: "open-picker" }
  | { type: "close-picker" }
  | { type: "show-help" }
  | { type: "hide-help" }
  | { type: "file-list-navigate"; direction: "up" | "down" }
  | { type: "close-file-view" };

export interface MainActions {
  runAll(dryRun: boolean): Promise<TuiRunResult>;
  runAlert(dryRun: boolean): Promise<TuiRunResult>;
  runSingleFile(relPath: string, dryRun: boolean): Promise<TuiRunResult>;
  startWatching(): void;
  stopWatching(): void;
  initVault(dryRun: boolean): Promise<TuiInitResult>;
}
