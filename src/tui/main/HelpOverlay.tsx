import { Box, Text } from "ink";

const BINDINGS: { key: string; desc: string }[] = [
  { key: "r", desc: "Run all files" },
  { key: "a", desc: "Run alert rules" },
  { key: "w", desc: "Toggle watch mode" },
  { key: "o", desc: "Open file picker" },
  { key: "i", desc: "Init vault (convert format)" },
  { key: "d", desc: "Toggle dry-run mode" },
  { key: "?", desc: "Show this help" },
  { key: "q", desc: "Quit" },
  { key: "Esc", desc: "Close overlay / modal" },
];

export function HelpOverlay() {
  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      borderStyle="round"
    >
      <Text bold>Keyboard shortcuts</Text>
      <Box flexDirection="column" marginTop={1}>
        {BINDINGS.map(({ key, desc }) => (
          <Box key={key}>
            <Text bold wrap="truncate">
              {"  "}{key.padEnd(5)}
            </Text>
            <Text>{desc}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press any key to close</Text>
      </Box>
    </Box>
  );
}
