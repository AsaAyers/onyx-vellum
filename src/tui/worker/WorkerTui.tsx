import { render } from "ink";
import { createStore, type Store } from "../shared/store.js";
import { WorkerApp } from "./WorkerApp.js";
import { workerReducer, INITIAL_WORKER_STATE } from "./workerMachine.js";
import type { WorkerTuiState, WorkerTuiEvent } from "./types.js";

export interface WorkerTuiHandle {
  store: Store<WorkerTuiState, WorkerTuiEvent>;
  stop: () => void;
  waitUntilExit: () => Promise<unknown>;
}

export function createWorkerTui(config: {
  onStop?: () => void;
}): WorkerTuiHandle {
  const store = createStore<WorkerTuiState, WorkerTuiEvent>({
    initial: INITIAL_WORKER_STATE,
    reducer: workerReducer,
  });

  const { unmount, waitUntilExit } = render(
    <WorkerApp store={store} onStop={config.onStop} />,
    { patchConsole: true },
  );

  return {
    store,
    stop: () => {
      unmount();
    },
    waitUntilExit,
  };
}
