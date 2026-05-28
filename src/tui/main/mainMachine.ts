import type { MainState, MainEvent } from "./types.js";
import { unreachable } from "../../unreachable.js";

export const INITIAL_STATE: MainState = {
  name: "idle",
  dryRun: false,
  lastRun: null,
  lastInit: null,
  runMode: null,
  watchingSub: null,
};

function initAsRunResult(
  result: NonNullable<MainState["lastInit"]>,
): NonNullable<MainState["lastRun"]> {
  return {
    filesWritten: result.filesConverted,
    filePaths: result.filePaths,
    mode: "all",
    finishedAt: result.finishedAt,
    error: result.error,
  };
}

export function mainReducer(state: MainState, event: MainEvent): MainState {
  switch (event.type) {
    case "run-start": {
      if (state.name === "idle" || state.name === "picking") {
        return { ...state, name: "running", runMode: event.runMode };
      }
      break;
    }

    case "run-complete": {
      if (state.name === "running") {
        return { ...state, name: "idle", lastRun: event.result, runMode: null };
      }
      break;
    }

    case "init-start": {
      if (state.name === "idle") {
        return { ...state, name: "running", runMode: "init" };
      }
      break;
    }

    case "init-complete": {
      if (state.name === "running" && state.runMode === "init") {
        return {
          ...state,
          name: "idle",
          runMode: null,
          lastInit: event.result,
          lastRun: initAsRunResult(event.result),
        };
      }
      break;
    }

    case "run-error": {
      if (state.name === "running") {
        const detectedMode =
          state.runMode === "all" ||
            state.runMode === "alert" ||
            state.runMode === "single"
            ? state.runMode
            : "all";
        return {
          ...state,
          name: "idle",
          runMode: null,
          lastRun: {
            filesWritten: 0,
            filePaths: [],
            mode: detectedMode,
            finishedAt: Date.now(),
            error: event.error,
          },
        };
      }
      if (
        state.name === "watching" &&
        state.watchingSub?.name === "processing"
      ) {
        return { ...state, watchingSub: { name: "ready" } };
      }
      break;
    }

    case "toggle-watching": {
      if (state.name === "idle") {
        return { ...state, name: "watching", watchingSub: { name: "ready" } };
      }
      if (state.name === "watching") {
        return { ...state, name: "idle", watchingSub: null };
      }
      break;
    }

    case "file-changed": {
      if (
        state.name === "watching" &&
        state.watchingSub?.name !== "processing"
      ) {
        const existing =
          state.watchingSub?.name === "debouncing"
            ? state.watchingSub.queuedFiles
            : [];
        return {
          ...state,
          watchingSub: {
            name: "debouncing",
            queuedFiles: [...new Set([...existing, ...event.files])],
            since: Date.now(),
            delayMs: event.delayMs,
          },
        };
      }
      break;
    }

    case "debounce-fired": {
      if (
        state.name === "watching" &&
        state.watchingSub?.name === "debouncing"
      ) {
        return { ...state, watchingSub: { name: "processing" } };
      }
      break;
    }

    case "toggle-dry-run": {
      return { ...state, dryRun: !state.dryRun };
    }

    case "open-picker": {
      if (state.name === "idle") {
        return { ...state, name: "picking" };
      }
      break;
    }

    case "close-picker": {
      if (state.name === "picking") {
        return { ...state, name: "idle" };
      }
      break;
    }

    case "show-help": {
      if (state.name !== "help") {
        return { ...state, name: "help" };
      }
      break;
    }

    case "hide-help": {
      if (state.name === "help") {
        return { ...state, name: "idle" };
      }
      break;
    }

    default:
      unreachable(event);
  }
  return state;
}
