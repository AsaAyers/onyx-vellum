export interface TuiRunResult {
  filesWritten: number;
  filePaths: string[];
  mode: "all" | "alert" | "single";
  finishedAt: number;
  error?: string;
}

export interface TuiInitResult {
  filesConverted: number;
  filePaths: string[];
  finishedAt: number;
  error?: string;
}

export type WatchingSubState =
  | { name: "ready" }
  | {
      name: "debouncing";
      queuedFiles: string[];
      since: number;
      delayMs: number;
    }
  | { name: "processing" };

export interface MainState {
  name: "idle" | "running" | "watching" | "picking" | "help";
  dryRun: boolean;
  lastRun: TuiRunResult | null;
  lastInit: TuiInitResult | null;
  runMode: "all" | "alert" | "init" | "single" | null;
  watchingSub: WatchingSubState | null;
}

export type MainEvent =
  | { type: "run-start"; runMode: "all" | "alert" | "single" }
  | { type: "run-complete"; result: TuiRunResult }
  | { type: "init-start" }
  | { type: "init-complete"; result: TuiInitResult }
  | { type: "run-error"; error: string }
  | { type: "toggle-watching" }
  | { type: "file-changed"; files: string[]; delayMs: number }
  | { type: "debounce-fired" }
  | { type: "toggle-dry-run" }
  | { type: "open-picker" }
  | { type: "close-picker" }
  | { type: "show-help" }
  | { type: "hide-help" };

export interface MainActions {
  runAll(dryRun: boolean): Promise<TuiRunResult>;
  runAlert(dryRun: boolean): Promise<TuiRunResult>;
  runSingleFile(relPath: string, dryRun: boolean): Promise<TuiRunResult>;
  startWatching(): void;
  stopWatching(): void;
  initVault(dryRun: boolean): Promise<TuiInitResult>;
}
