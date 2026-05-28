import { Box, Text } from "ink";
import type { WatchingSubState } from "./types.js";

export function FileChangeList({
  watchingSub,
}: {
  watchingSub: WatchingSubState;
}) {
  switch (watchingSub.name) {
    case "ready": {
      const files = watchingSub.processedFiles;
      if (!files || files.length === 0) {
        return (
          <Box flexDirection="column">
            <Text dimColor>No files processed yet.</Text>
          </Box>
        );
      }
      return (
        <Box flexDirection="column">
          {files.map((p) => (
            <Box key={p}>
              <Text color="green">✓ </Text>
              <Text dimColor>{p}</Text>
            </Box>
          ))}
        </Box>
      );
    }

    case "debouncing": {
      return (
        <Box flexDirection="column">
          {watchingSub.queuedFiles.map((p) => (
            <Box key={p}>
              <Text color="yellow">⏳ </Text>
              <Text>{p}</Text>
            </Box>
          ))}
        </Box>
      );
    }

    case "processing": {
      const processed = watchingSub.processedFiles ?? [];
      return (
        <Box flexDirection="column">
          {processed.map((p) => (
            <Box key={p}>
              <Text color="green">✓ </Text>
              <Text dimColor>{p}</Text>
            </Box>
          ))}
          {watchingSub.filePaths
            .filter((p) => !processed.includes(p))
            .map((p) => (
              <Box key={p}>
                <Text color="cyan">{">"} </Text>
                <Text>{p}</Text>
              </Box>
            ))}
        </Box>
      );
    }
  }
}
