import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Store } from "../shared/store.js";
import type { MainState, MainEvent, MainActions } from "./types.js";
import { walkMarkdownFiles } from "../../engine/FileWriteManager.js";
import { filterFiles } from "./filePickerHelpers.js";

const MAX_VISIBLE = 20;

export function FilePicker({
  store,
  actions,
  vaultPath,
}: {
  store: Store<MainState, MainEvent>;
  actions: MainActions;
  vaultPath: string;
}) {
  const [query, setQuery] = useState("");
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const stateRef = useRef(store.getState());
  stateRef.current = store.getState();

  useEffect(() => {
    walkMarkdownFiles(vaultPath, vaultPath).then((files) => {
      const paths = files.map((f) => f.relativePath).sort();
      setAllFiles(paths);
    });
  }, [vaultPath]);

  const filtered = filterFiles(allFiles, query);
  const clampedIndex = Math.min(selectedIndex, filtered.length - 1);
  const visibleFiles = filtered.slice(0, MAX_VISIBLE);

  useInput((input, key) => {
    if (key.escape) {
      store.dispatch({ type: "close-picker" });
      return;
    }

    if (key.return && filtered.length > 0) {
      const selectedPath = filtered[clampedIndex];
      store.dispatch({ type: "close-picker" });
      store.dispatch({ type: "run-start", runMode: "single" });
      actions.runSingleFile(selectedPath, stateRef.current.dryRun).then(
        (result) => store.dispatch({ type: "run-complete", result }),
        (err: Error) =>
          store.dispatch({ type: "run-error", error: err.message }),
      );
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
      return;
    }

    if (key.backspace || key.delete || input === "\b" || (input && input.charCodeAt(0) === 127)) {
      setQuery((q) => q.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text bold>Filter: </Text>
        <Text>{query}</Text>
        <Text dimColor> ({filtered.length} files)</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visibleFiles.length === 0 ? (
          <Text dimColor>No files match</Text>
        ) : (
          visibleFiles.map((f, i) => (
            <Box key={f}>
              <Text inverse={i === clampedIndex} wrap="truncate">
                {i === clampedIndex ? " > " : "   "}{f}
              </Text>
            </Box>
          ))
        )}
        {filtered.length > MAX_VISIBLE && (
          <Text dimColor>...and {filtered.length - MAX_VISIBLE} more</Text>
        )}
      </Box>
    </Box>
  );
}
