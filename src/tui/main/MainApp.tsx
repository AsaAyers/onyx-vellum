import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import type { MutableRefObject } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import type { Store } from "../shared/store.js";
import type { MainState, MainEvent, MainActions } from "./types.js";
import { StatusBar } from "./StatusBar.js";
import { ActionBar } from "./ActionBar.js";
import { ResultsPanel } from "./ResultsPanel.js";
import { formatDuration } from "./formatResults.js";

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
  const startedRef = useRef<number | null>(null);
  if (state.name === "running" && startedRef.current === null) {
    startedRef.current = Date.now();
  }
  if (state.name !== "running") {
    startedRef.current = null;
  }

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (stateRef.current.name !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [state.name === "running"]);

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
      <Box flexGrow={1} alignItems="flex-start" paddingY={1}>
        <Box width="100%" paddingX={1}>
          {renderMainView(state, now, startedRef)}
        </Box>
      </Box>
      <ActionBar state={state} />
    </Box>
  );
}

function renderMainView(state: MainState, now: number, startedRef: MutableRefObject<number | null>) {
  switch (state.name) {
    case "running":
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">
            Running {state.runMode ?? "pipeline"}...
          </Text>
          <Text dimColor>
            {startedRef.current != null
              ? `${formatDuration(now - startedRef.current)} elapsed`
              : "Starting..."}
          </Text>
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
        return <ResultsPanel lastRun={state.lastRun} />;
      }
      return (
        <Box>
          <Text>Press r to run, w to watch, ? for help</Text>
        </Box>
      );
  }
}
