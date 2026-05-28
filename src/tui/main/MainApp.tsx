import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import type { Store } from "../shared/store.js";
import type { MainState, MainEvent, MainActions } from "./types.js";
import { StatusBar } from "./StatusBar.js";
import { ActionBar } from "./ActionBar.js";
import { ResultsPanel } from "./ResultsPanel.js";
import { FileChangeList } from "./FileChangeList.js";
import { FilePicker } from "./FilePicker.js";
import { formatDuration } from "./formatResults.js";
import { computeDebounceRemaining } from "./watchHelpers.js";

export function MainApp({
  store,
  actions,
  vaultPath,
}: {
  store: Store<MainState, MainEvent>;
  actions: MainActions;
  vaultPath: string;
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
    const s = stateRef.current;
    if (s.name !== "running" && s.name !== "watching") return;
    if (s.name === "watching" && s.watchingSub?.name !== "debouncing") return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  });

  useInput((input, key) => {
    const s = stateRef.current;

    if (s.name === "picking") return;

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
        // Initial run, then start watching
        store.dispatch({ type: "run-start", runMode: "all" });
        actions.runAll(s.dryRun).then(
          (result) => {
            store.dispatch({ type: "run-complete", result });
            actions.startWatching();
            store.dispatch({ type: "toggle-watching" });
          },
          (err: Error) => {
            store.dispatch({ type: "run-error", error: err.message });
          },
        );
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
          {renderMainView(state, now, startedRef, vaultPath, store, actions)}
        </Box>
      </Box>
      <ActionBar state={state} />
    </Box>
  );
}

function WatchView({ state, now }: { state: MainState; now: number }) {
  const sub = state.watchingSub;
  if (!sub) return null;

  let countdown: string | null = null;
  if (sub.name === "debouncing") {
    const remaining = computeDebounceRemaining(sub.since, sub.delayMs, now);
    countdown = `${(remaining / 1_000).toFixed(1)}s`;
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Box flexDirection="column" flexGrow={1}>
          <Box>
            <Text bold underline>
              Files
            </Text>
            {countdown && <Text dimColor> (debounce: {countdown})</Text>}
          </Box>
          <FileChangeList watchingSub={sub} />
        </Box>
        {state.lastRun && (
          <Box flexDirection="column" marginLeft={2}>
            <Text bold underline>
              Last run
            </Text>
            <ResultsPanel lastRun={state.lastRun} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

function renderMainView(
  state: MainState,
  now: number,
  startedRef: RefObject<number | null>,
  vaultPath: string,
  store: Store<MainState, MainEvent>,
  actions: MainActions,
) {
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
      return <WatchView state={state} now={now} />;
    case "picking":
      return (
        <FilePicker store={store} actions={actions} vaultPath={vaultPath} />
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
