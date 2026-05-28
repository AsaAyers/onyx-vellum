import { Box, Text } from "ink";
import { formatDuration } from "../main/formatResults.js";
import type { WorkerTuiState } from "./types.js";

function statusLabel(name: WorkerTuiState["name"]): { label: string; color: "yellow" | "green" | "blue" | "red" } {
  switch (name) {
    case "starting": return { label: "Starting", color: "yellow" };
    case "idle": return { label: "Idle", color: "green" };
    case "busy": return { label: "Busy", color: "blue" };
    case "stopped": return { label: "Stopped", color: "red" };
  }
}

export function WorkerStatusBar({ state, now }: { state: WorkerTuiState; now: number }) {
  const { label, color } = statusLabel(state.name);
  const uptime = state.startedAt ? formatDuration(now - state.startedAt) : null;

  return (
    <Box>
      <Box marginRight={2}>
        <Text bold color={color}>
          {label}
        </Text>
      </Box>
      {uptime && <Text dimColor>Uptime: {uptime}</Text>}
      {state.recoveredCount > 0 && (
        <Text dimColor> | Recovered: {state.recoveredCount}</Text>
      )}
    </Box>
  );
}
