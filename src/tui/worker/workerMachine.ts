import type { WorkerTuiState, WorkerTuiEvent } from "./types.js";
import { unreachable } from "../../unreachable.js";

export const INITIAL_WORKER_STATE: WorkerTuiState = {
  name: "starting",
  startedAt: null,
  recoveredCount: 0,
  currentJob: null,
  jobHistory: [],
};

export function workerReducer(
  state: WorkerTuiState,
  event: WorkerTuiEvent,
): WorkerTuiState {
  switch (event.type) {
    case "started": {
      if (state.name === "starting") {
        return { ...state, name: "idle", startedAt: Date.now() };
      }
      break;
    }

    case "recovery-complete": {
      if (state.name === "starting" || state.name === "idle") {
        return { ...state, recoveredCount: event.recovered };
      }
      break;
    }

    case "poll-idle": {
      return state;
    }

    case "job-started": {
      if (state.name === "idle" || state.name === "busy") {
        return {
          ...state,
          name: "busy",
          currentJob: {
            id: event.jobId,
            type: event.jobType,
            detail: event.detail,
            startedAt: Date.now(),
          },
        };
      }
      break;
    }

    case "job-completed": {
      if (state.name === "busy" && state.currentJob) {
        const entry: WorkerTuiState["jobHistory"][number] = {
          id: event.jobId,
          type: event.jobType,
          status: "completed",
          startedAt: state.currentJob.startedAt,
          finishedAt: Date.now(),
          detail: event.detail,
        };
        return {
          ...state,
          name: "idle",
          currentJob: null,
          jobHistory: [...state.jobHistory, entry],
        };
      }
      break;
    }

    case "job-failed": {
      if (state.name === "busy" && state.currentJob) {
        const entry: WorkerTuiState["jobHistory"][number] = {
          id: event.jobId,
          type: event.jobType,
          status: "failed",
          startedAt: state.currentJob.startedAt,
          finishedAt: Date.now(),
          detail: event.detail,
          error: event.error,
        };
        return {
          ...state,
          name: "idle",
          currentJob: null,
          jobHistory: [...state.jobHistory, entry],
        };
      }
      break;
    }

    case "stop": {
      return { ...state, name: "stopped" };
    }

    default:
      unreachable(event);
  }
  return state;
}
