import { Box, Text } from "ink";

export function ActionBar() {
  return (
    <Box borderStyle="round" paddingX={1} width="100%">
      <Text dimColor>
        [r] run all &nbsp;&nbsp;[a] alert &nbsp;&nbsp;[w] watch &nbsp;&nbsp;[i]
        init &nbsp;&nbsp;[o] open file &nbsp;&nbsp;[d] dry-run &nbsp;&nbsp;[?]
        help &nbsp;&nbsp;[q] quit
      </Text>
    </Box>
  );
}
