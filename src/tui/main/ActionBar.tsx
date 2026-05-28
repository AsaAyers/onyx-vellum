import { Box, Text } from "ink";
import type { MainState } from "./types.js";

export function ActionBar({ state }: { state: MainState }) {
  return (
    <Box borderStyle="round" paddingX={1} width="100%">
      <Text dimColor>
        [r]un all [a]lert [w]atch [i]nit [o]pen-file
        <Text color={state.dryRun ? "yellow" : undefined}>
          {" "}
          [d]ry-run{state.dryRun ? " ✓" : ""}{" "}
        </Text>
        [?]help [q]uit
      </Text>
    </Box>
  );
}
