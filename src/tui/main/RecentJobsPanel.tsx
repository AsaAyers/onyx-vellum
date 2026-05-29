import { Box, Text } from "ink";
import type { MainState } from "./types.js";

function isStale(key: string, lastRunFinishedAt: number): boolean {
  const colonIdx = key.indexOf(":");
  if (colonIdx === -1) return false;
  const ts = Number.parseInt(key.slice(0, colonIdx), 10);
  return !Number.isNaN(ts) && ts < lastRunFinishedAt;
}

function sentinelLabel(stateName: MainState["name"]): string {
  return stateName === "watching" ? "← Pending" : "← Summary";
}

export function RecentJobsPanel({ state }: { state: MainState }) {
  const fileKeys = Object.keys(state.fileDetails).sort();
  const lastRunTs = state.lastRun?.finishedAt ?? 0;
  const isCursorOnSentinel = state.fileViewCursor === "__sentinel__";

  return (
    <Box flexDirection="column">
      <Box>
        <Text
          bold
          inverse={isCursorOnSentinel}
          color={isCursorOnSentinel ? undefined : "dim"}
        >
          {"  "}
          {sentinelLabel(state.name)}
        </Text>
      </Box>
      {fileKeys.map((key) => {
        const selected = state.fileViewCursor === key;
        const stale = isStale(key, lastRunTs);
        return (
          <Box key={key} paddingLeft={1} paddingRight={1}>
            <Text
              inverse={selected}
              dimColor={!selected && stale}
              wrap="truncate-start"
            >
              {selected ? "> " : "  "}
              {key.slice(key.indexOf(":") + 1)}
              {stale && !selected ? " (previous)" : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
