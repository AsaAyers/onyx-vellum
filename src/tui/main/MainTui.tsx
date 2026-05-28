import { render } from "ink";
import { createStore, type Store } from "../shared/store.js";
import { MainApp } from "./MainApp.js";
import { mainReducer, INITIAL_STATE } from "./mainMachine.js";
import type { MainState, MainEvent, MainActions } from "./types.js";

export interface MainTuiHandle {
  store: Store<MainState, MainEvent>;
  stop: () => void;
  waitUntilExit: () => Promise<unknown>;
}

export function createMainTui(config: {
  vaultPath: string;
  actions: MainActions;
  stateDir: string;
}): MainTuiHandle {
  const store = createStore<MainState, MainEvent>({
    initial: INITIAL_STATE,
    reducer: mainReducer,
  });

  const { unmount, waitUntilExit } = render(
    <MainApp store={store} actions={config.actions} />,
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
