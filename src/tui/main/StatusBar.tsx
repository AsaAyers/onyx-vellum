import { Box, Spacer, Text } from "ink";
import type { MainState } from "./types.js";
import { computeDebounceRemaining } from "./watchHelpers.js";

export function StatusBar({
  state,
  now,
}: {
  state: MainState;
  now: number | null;
}) {
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
      <Spacer />
      <DebounceCountdown state={state} now={now} />
    </Box>
  );
}

function DebounceCountdown({
  state,
  now,
}: {
  state: MainState;
  now: number | null;
}) {
  if (state.name === "watching" && state.watchingSub) {
    const sub = state.watchingSub;
    let countdown: string | null = null;
    if (sub.name === "debouncing" && now !== null) {
      const remaining = computeDebounceRemaining(sub.since, sub.delayMs, now);
      countdown = `${(remaining / 1_000).toFixed(1)}s`;
    }
    return (
      <Box flexDirection="column">
        {countdown && <Text dimColor>Debounce: {countdown}</Text>}
      </Box>
    );
  }
  return <></>;
}
