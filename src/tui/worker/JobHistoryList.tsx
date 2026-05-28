import { Box, Text } from "ink";
import { formatDuration } from "../main/formatResults.js";
import type { WorkerTuiState } from "./types.js";

const MAX_VISIBLE = 20;

export function JobHistoryList({
  state,
  selectedIndex,
  expandedIndex,
  detailMode,
}: {
  state: WorkerTuiState;
  selectedIndex: number;
  expandedIndex: number | null;
  detailMode: "summary" | "full";
}) {
  const jobs = state.jobHistory;
  const visible = jobs.slice(-MAX_VISIBLE);

  if (visible.length === 0 && state.name !== "busy") {
    return (
      <Box>
        <Text dimColor>No jobs processed yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Text bold underline>
        Job History
      </Text>
      {state.currentJob && (
        <Box>
          <Text color="blue">
            {" > "} {state.currentJob.type}{" "}
          </Text>
          <Text dimColor>running...</Text>
        </Box>
      )}
      {visible.map((entry, i) => {
        const idx = jobs.length - MAX_VISIBLE + i;
        const isSelected = idx === selectedIndex;
        const isExpanded = idx === expandedIndex;
        const elapsed = formatDuration(entry.finishedAt - entry.startedAt);
        const icon = entry.status === "completed" ? "✓" : "✗";
        const color = entry.status === "completed" ? "green" : "red";

        return (
          <Box key={entry.id} flexDirection="column">
            <Box>
              <Text bold={isSelected} inverse={isSelected} wrap="truncate">
                {isSelected ? " > " : "   "}
                <Text color={color}>{icon}</Text>
                {" "}{entry.type}{" "}
                <Text dimColor>{elapsed}</Text>
              </Text>
            </Box>
            {isExpanded && (
              <Box marginLeft={4} flexDirection="column">
                <Text dimColor>ID: {entry.id}</Text>
                {detailMode === "full" ? (
                  <Text wrap="wrap">{entry.detail}</Text>
                ) : (
                  <Text dimColor>
                    Status: {entry.status}
                    {entry.error && ` | Error: ${entry.error}`}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
