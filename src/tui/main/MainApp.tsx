import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { Box, Text, useStdout } from "ink";
import { useInput } from "ink";
import type { Store } from "../shared/store.js";
import type { MainState, MainEvent, MainActions } from "./types.js";
import { StatusBar } from "./StatusBar.js";
import { ActionBar } from "./ActionBar.js";
import { ResultsPanel } from "./ResultsPanel.js";
import { FileChangeList } from "./FileChangeList.js";
import { FilePicker } from "./FilePicker.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { BorderBox } from "./BorderBox.js";
import { RecentJobsPanel } from "./RecentJobsPanel.js";
import { FileDiffPanel } from "./FileDiffPanel.js";
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
    if (s.name === "help") {
      store.dispatch({ type: "hide-help" });
      return;
    }

    if (key.escape) {
      store.dispatch({ type: "close-picker" });
      store.dispatch({ type: "hide-help" });
      store.dispatch({ type: "close-file-view" });
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

    if (key.upArrow) {
      store.dispatch({ type: "file-list-navigate", direction: "up" });
      return;
    }

    if (key.downArrow) {
      store.dispatch({ type: "file-list-navigate", direction: "down" });
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

  const { stdout } = useStdout();

  return (
    <Box flexDirection="column" height={stdout.rows} width={stdout.columns}>
      <StatusBar state={state} now={now} />
      <Box flexGrow={1} alignItems="flex-start">
        {state.name === "help" ? (
          <HelpOverlay />
        ) : (
          <MainView
            state={state}
            now={now}
            startedRef={startedRef}
            vaultPath={vaultPath}
            store={store}
            actions={actions}
          />
        )}
      </Box>
      <ActionBar state={state} />
    </Box>
  );
}

function MainView({
  state,
  now,
  startedRef,
  vaultPath,
  store,
  actions,
}: {
  state: MainState;
  now: number;
  startedRef: RefObject<number | null>;
  vaultPath: string;
  store: Store<MainState, MainEvent>;
  actions: MainActions;
}) {
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
      return <SideBySideView state={state} now={now} />;
    case "picking":
      return (
        <FilePicker store={store} actions={actions} vaultPath={vaultPath} />
      );
    case "idle":
      if (state.lastRun) {
        return <SideBySideView state={state} now={null} />;
      }
      return (
        <Box>
          <Text>Press r to run, w to watch, ? for help</Text>
        </Box>
      );
  }
}

function SideBySideView({
  state,
  now,
}: {
  state: MainState;
  now: number | null;
}) {
  const fileCount = Object.keys(state.fileDetails).length;
  if (fileCount === 0 && !state.lastRun) return null;

  const cursorKey = state.fileViewCursor;
  const isSentinel = cursorKey === "__sentinel__";

  const { title, content } = rightPanelContent(
    state,
    now,
    cursorKey,
    isSentinel,
  );

  return (
    <Box width="100%" height="100%">
      <Box flexGrow={3} flexShrink={0} paddingX={1}>
        <BorderBox title="Recent Jobs" flexGrow={1}>
          <RecentJobsPanel state={state} />
        </BorderBox>
      </Box>
      <Box flexGrow={7} flexShrink={0} paddingX={1}>
        <BorderBox title={title} flexGrow={1}>
          {content}
        </BorderBox>
      </Box>
    </Box>
  );
}

function rightPanelContent(
  state: MainState,
  now: number | null,
  cursorKey: string,
  isSentinel: boolean,
): { title: string; content: React.ReactNode } {
  if (!isSentinel) {
    const detail = state.fileDetails[cursorKey];
    if (detail) {
      const fileName = cursorKey.includes(":")
        ? cursorKey.slice(cursorKey.indexOf(":") + 1)
        : cursorKey;
      return {
        title: fileName,
        content: <FileDiffPanel detail={detail} fileName={fileName} />,
      };
    }
  }

  if (state.name === "watching" && state.watchingSub) {
    const sub = state.watchingSub;
    let countdown: string | null = null;
    if (sub.name === "debouncing" && now !== null) {
      const remaining = computeDebounceRemaining(sub.since, sub.delayMs, now);
      countdown = `${(remaining / 1_000).toFixed(1)}s`;
    }
    return {
      title: "Pending changes",
      content: (
        <Box flexDirection="column">
          {countdown && <Text dimColor>Debounce: {countdown}</Text>}
          <FileChangeList watchingSub={sub} />
        </Box>
      ),
    };
  }

  if (state.lastRun) {
    return {
      title: "Run summary",
      content: <ResultsPanel lastRun={state.lastRun} />,
    };
  }

  return {
    title: "No data",
    content: <Text dimColor>No results yet.</Text>,
  };
}
