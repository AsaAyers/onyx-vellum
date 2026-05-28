import { Box, Text } from "ink";
import type { MainState } from "./types.js";

export function ActionBar({ state }: { state: MainState }) {
  return (
    <Box borderStyle="round" paddingX={1} width="100%">
      <Text dimColor>
        [r] run all  [a] alert  [w] watch  [i]
        init  [o] open file  
        <Text color={state.dryRun ? "yellow" : undefined}>
          [d] dry-run{state.dryRun ? " ✓" : ""}
        </Text>
        [?] help  [q] quit
      </Text>
    </Box>
  );
}
