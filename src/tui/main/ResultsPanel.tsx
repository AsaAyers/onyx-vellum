import { Box, Text } from "ink";
import type { MainState } from "./types.js";
import { formatDuration, formatFinishedTime, formatMode } from "./formatResults.js";

export function ResultsPanel({ lastRun }: { lastRun: NonNullable<MainState["lastRun"]> }) {
  const elapsed = lastRun.finishedAt > 0
    ? formatDuration(Date.now() - lastRun.finishedAt)
    : null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{formatMode(lastRun.mode)}</Text>
        <Text> completed at </Text>
        <Text>{formatFinishedTime(lastRun.finishedAt)}</Text>
        {elapsed && <Text dimColor> ({elapsed} ago)</Text>}
      </Box>
      <Box>
        <Text>Files written: </Text>
        <Text bold color={lastRun.filesWritten > 0 ? "green" : "dim"}>
          {lastRun.filesWritten}
        </Text>
      </Box>
      {lastRun.error && (
        <Box>
          <Text color="red">Error: {lastRun.error}</Text>
        </Box>
      )}
      {lastRun.filePaths.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>Files:</Text>
          {lastRun.filePaths.slice(0, 20).map((p) => (
            <Box key={p} marginLeft={2}>
              <Text dimColor>{p}</Text>
            </Box>
          ))}
          {lastRun.filePaths.length > 20 && (
            <Box marginLeft={2}>
              <Text dimColor>...and {lastRun.filePaths.length - 20} more</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
