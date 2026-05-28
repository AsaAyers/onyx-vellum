import { Box, Text } from "ink";
import type { MainState } from "./types.js";

export function StatusBar({ state }: { state: MainState }) {
  const statusText = {
    idle: "idle",
    running: "running",
    watching: "watching",
    picking: "picking",
    help: "help",
  }[state.name];

  const statusColor = {
    idle: "green",
    running: "yellow",
    watching: "cyan",
    picking: "blue",
    help: "dim",
  }[state.name];

  return (
    <Box borderStyle="round" paddingX={1} width="100%">
      <Text bold>onyx-vellum</Text>
      <Text> </Text>
      <Text color={statusColor}>● {statusText}</Text>
      {state.dryRun && <Text color="yellow"> [dry-run]</Text>}
    </Box>
  );
}
