export type WorkerTuiState = {
  name: "starting" | "idle" | "busy" | "stopped";
  startedAt: number | null;
  recoveredCount: number;
  currentJob: { id: string; type: string; detail: string; startedAt: number } | null;
  jobHistory: JobHistoryEntry[];
};

export type JobHistoryEntry = {
  id: string;
  type: string;
  status: "completed" | "failed";
  startedAt: number;
  finishedAt: number;
  detail: string;
  error?: string;
};

export type WorkerTuiEvent =
  | { type: "started" }
  | { type: "recovery-complete"; recovered: number }
  | { type: "poll-idle" }
  | { type: "job-started"; jobId: string; jobType: string; detail: string }
  | { type: "job-completed"; jobId: string; jobType: string; detail: string }
  | { type: "job-failed"; jobId: string; jobType: string; detail: string; error: string }
  | { type: "stop" };
