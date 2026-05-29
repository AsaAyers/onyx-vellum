import type { MainState, MainEvent } from "./types.js";
import { unreachable } from "../../unreachable.js";

export const SENTINEL = "__sentinel__";

export const INITIAL_STATE: MainState = {
  name: "idle",
  dryRun: false,
  lastRun: null,
  lastInit: null,
  runMode: null,
  watchingSub: null,
  fileDetails: {},
  fileViewCursor: SENTINEL,
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
    fileDetails: {},
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
      const newDetails = event.result.fileDetails;
      const cursor = state.fileViewCursor;

      // If user was viewing a file not in new results, keep it under a dimmed key
      const staleKey = cursor !== SENTINEL && !newDetails[cursor] ? cursor : null;

      if (state.name === "running") {
        // If we're retaining a stale detail, keep it in fileDetails
        const merged = staleKey && state.fileDetails[staleKey]
          ? { [staleKey]: state.fileDetails[staleKey], ...newDetails }
          : newDetails;
        return {
          ...state,
          name: "idle",
          lastRun: event.result,
          runMode: null,
          fileDetails: merged,
          fileViewCursor: staleKey ? staleKey : cursor,
        };
      }
      if (state.name === "watching") {
        const processedFiles =
          state.watchingSub?.name === "processing"
            ? event.result.filePaths
            : state.watchingSub?.name === "ready"
              ? state.watchingSub.processedFiles
              : undefined;
        const merged = staleKey && state.fileDetails[staleKey]
          ? { [staleKey]: state.fileDetails[staleKey], ...newDetails }
          : newDetails;
        return {
          ...state,
          lastRun: event.result,
          fileDetails: merged,
          fileViewCursor: staleKey ? staleKey : cursor,
          watchingSub: { name: "ready", processedFiles },
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
            fileDetails: {},
          },
          fileDetails: {},
          fileViewCursor: SENTINEL,
        };
      }
      if (state.name === "watching") {
        const prevProcessed =
          state.watchingSub?.name === "processing"
            ? state.watchingSub.processedFiles
            : state.watchingSub?.name === "ready"
              ? state.watchingSub.processedFiles
              : undefined;
        return {
          ...state,
          lastRun: {
            filesWritten: 0,
            filePaths: [],
            mode: "all",
            finishedAt: Date.now(),
            error: event.error,
            fileDetails: {},
          },
          fileDetails: {},
          fileViewCursor: SENTINEL,
          watchingSub: { name: "ready", processedFiles: prevProcessed },
        };
      }
      break;
    }

    case "file-list-navigate": {
      const keys = Object.keys(state.fileDetails);
      const sorted = keys.sort();
      const entries = [SENTINEL, ...sorted];
      const currentIdx = entries.indexOf(state.fileViewCursor);
      if (currentIdx === -1) {
        return { ...state, fileViewCursor: SENTINEL };
      }
      const nextIdx = event.direction === "up"
        ? (currentIdx > 0 ? currentIdx - 1 : entries.length - 1)
        : (currentIdx < entries.length - 1 ? currentIdx + 1 : 0);
      return { ...state, fileViewCursor: entries[nextIdx] };
    }

    case "close-file-view": {
      return { ...state, fileViewCursor: SENTINEL };
    }

    case "init-start": {
      if (state.name === "idle") {
        return { ...state, name: "running", runMode: "init" };
      }
      break;
    }

    case "init-complete": {
      if (state.name === "running" && state.runMode === "init") {
        const result = initAsRunResult(event.result);
        return {
          ...state,
          name: "idle",
          runMode: null,
          lastInit: event.result,
          lastRun: result,
          fileDetails: result.fileDetails,
          fileViewCursor: SENTINEL,
        };
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
        const processed =
          state.watchingSub?.name === "ready"
            ? state.watchingSub.processedFiles
            : state.watchingSub?.name === "debouncing"
              ? state.watchingSub.processedFiles
              : undefined;
        return {
          ...state,
          watchingSub: {
            name: "debouncing",
            queuedFiles: [...new Set([...existing, ...event.files])],
            since: Date.now(),
            delayMs: event.delayMs,
            growthFactor: event.growthFactor,
            callCount: event.callCount,
            processedFiles: processed,
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
        return {
          ...state,
          watchingSub: {
            name: "processing",
            filePaths: state.watchingSub.queuedFiles,
            processedFiles: state.watchingSub.processedFiles,
          },
        };
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
