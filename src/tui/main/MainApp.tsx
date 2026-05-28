import { useRef } from "react";
import { useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import type { Store } from "../shared/store.js";
import type { MainState, MainEvent, MainActions } from "./types.js";
import { StatusBar } from "./StatusBar.js";
import { ActionBar } from "./ActionBar.js";

export function MainApp({
  store,
  actions,
}: {
  store: Store<MainState, MainEvent>;
  actions: MainActions;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useInput((input, key) => {
    const s = stateRef.current;

    if (key.escape) {
      store.dispatch({ type: "close-picker" });
      store.dispatch({ type: "hide-help" });
      return;
    }

    if (input === "q") {
      process.exit(0);
    }

    if (input === "?") {
      store.dispatch({ type: "show-help" });
      return;
    }

    if (input === "d") {
      store.dispatch({ type: "toggle-dry-run" });
      return;
    }

    if (input === "r") {
      if (s.name !== "idle") return;
      store.dispatch({ type: "run-start", runMode: "all" });
      actions.runAll(s.dryRun).then(
        (result) => store.dispatch({ type: "run-complete", result }),
        (err: Error) =>
          store.dispatch({
            type: "run-error",
            error: err.message,
          }),
      );
      return;
    }

    if (input === "a") {
      if (s.name !== "idle") return;
      store.dispatch({ type: "run-start", runMode: "alert" });
      actions.runAlert(s.dryRun).then(
        (result) => store.dispatch({ type: "run-complete", result }),
        (err: Error) =>
          store.dispatch({
            type: "run-error",
            error: err.message,
          }),
      );
      return;
    }

    if (input === "w") {
      if (s.name === "watching") {
        actions.stopWatching();
        store.dispatch({ type: "toggle-watching" });
        return;
      }
      if (s.name === "idle") {
        actions.startWatching();
        store.dispatch({ type: "toggle-watching" });
        return;
      }
      return;
    }

    if (input === "i") {
      if (s.name !== "idle") return;
      store.dispatch({ type: "init-start" });
      actions.initVault(s.dryRun).then(
        (result) => store.dispatch({ type: "init-complete", result }),
        (err: Error) =>
          store.dispatch({
            type: "run-error",
            error: err.message,
          }),
      );
      return;
    }

    if (input === "o") {
      if (s.name !== "idle") return;
      store.dispatch({ type: "open-picker" });
      return;
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar state={state} />
      <Box flexGrow={1}>
        <Box width="100%" justifyContent="center" alignItems="center">
          <Box>{renderMainView(state)}</Box>
        </Box>
      </Box>
      <ActionBar />
    </Box>
  );
}

function renderMainView(state: MainState) {
  switch (state.name) {
    case "running":
      return (
        <Box>
          <Text>Running {state.runMode ?? "pipeline"}...</Text>
        </Box>
      );
    case "watching":
      return (
        <Box>
          <Text>Watching for file changes...</Text>
        </Box>
      );
    case "picking":
      return (
        <Box>
          <Text>Select a file...</Text>
        </Box>
      );
    case "help":
      return (
        <Box>
          <Text>Help overlay (press any key to close)</Text>
        </Box>
      );
    case "idle":
      if (state.lastRun) {
        return (
          <Box flexDirection="column">
            <Box>
              <Text>
                Last run: {state.lastRun.mode} ({state.lastRun.finishedAt})
              </Text>
            </Box>
            <Box>
              <Text>Files written: {state.lastRun.filesWritten}</Text>
            </Box>
            {state.lastRun.filePaths.map((p) => (
              <Box key={p}>
                <Text> {p}</Text>
              </Box>
            ))}
          </Box>
        );
      }
      return (
        <Box>
          <Text>Press r to run, w to watch, ? for help</Text>
        </Box>
      );
  }
}
