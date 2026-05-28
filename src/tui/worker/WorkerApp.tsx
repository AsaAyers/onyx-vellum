import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import type { Store } from "../shared/store.js";
import type { WorkerTuiState, WorkerTuiEvent } from "./types.js";
import { WorkerStatusBar } from "./WorkerStatusBar.js";
import { JobHistoryList } from "./JobHistoryList.js";

export function WorkerApp({
  store,
  onStop,
}: {
  store: Store<WorkerTuiState, WorkerTuiEvent>;
  onStop?: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [now, setNow] = useState(Date.now());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [detailMode, setDetailMode] = useState<"summary" | "full">("summary");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useInput((input, key) => {
    const s = stateRef.current;

    if (input === "q" || (key.ctrl && input === "c")) {
      store.dispatch({ type: "stop" });
      onStop?.();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) =>
        Math.min(s.jobHistory.length - 1, i + 1),
      );
      return;
    }

    if (key.return && s.jobHistory.length > 0) {
      setExpandedIndex((prev) =>
        prev === selectedIndex ? null : selectedIndex,
      );
      return;
    }

    if (input === "d") {
      setDetailMode((m) => (m === "summary" ? "full" : "summary"));
      return;
    }
  });

  const s = store.getState();

  return (
    <Box flexDirection="column" height="100%">
      <WorkerStatusBar state={s} now={now} />
      <Box flexGrow={1} paddingY={1} paddingX={1}>
        <Box width="100%">
          <JobHistoryList
            state={s}
            selectedIndex={selectedIndex}
            expandedIndex={expandedIndex}
            detailMode={detailMode}
          />
        </Box>
      </Box>
      <Box>
        <Text dimColor>
          [↑↓] navigate  [Enter] expand  [d] {detailMode === "summary" ? "full JSON" : "summary"}  [q] quit
        </Text>
      </Box>
    </Box>
  );
}
