import { Box, Text } from "ink";
import type { MainState } from "./types.js";

type Action = { key: string; label: string };

const STATE_ACTIONS: Record<MainState["name"], Action[]> = {
  idle: [
    { key: "r", label: "run all" },
    { key: "a", label: "alert" },
    { key: "w", label: "watch" },
    { key: "i", label: "init" },
    { key: "o", label: "open-file" },
  ],
  watching: [{ key: "w", label: "stop watch" }],
  running: [],
  picking: [],
  help: [],
};

const GLOBAL_ACTIONS: Action[] = [
  { key: "?", label: "?help" },
  { key: "q", label: "quit" },
];

export function ActionBar({ state }: { state: MainState }) {
  const stateSpecific = STATE_ACTIONS[state.name] ?? [];

  if (state.name === "help") {
    return (
      <Box borderStyle="round" paddingX={1} width="100%">
        <Text dimColor>Press any key to close help</Text>
      </Box>
    );
  }

  if (state.name === "picking") {
    return (
      <Box borderStyle="round" paddingX={1} width="100%">
        <Text dimColor>[Esc] close [↑↓] navigate [Enter] select</Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      justifyContent="flex-start"
      paddingX={2}
      gap={2}
      width="100%"
    >
      {stateSpecific.map((a) => (
        <ActionShortcut key={a.key} keyBind={a.key} children={a.label} />
      ))}
      <ActionShortcut
        keyBind="d"
        color={state.dryRun ? "yellow" : undefined}
        dimColor={!state.dryRun}
        children={`toggle dry-run${state.dryRun ? "✓" : ""}`}
      />
      {GLOBAL_ACTIONS.map((a) => (
        <ActionShortcut key={a.key} keyBind={a.key}>
          {a.label}
        </ActionShortcut>
      ))}
    </Box>
  );
}

function ActionShortcut({
  keyBind,
  children,
  ...props
}: {
  keyBind: string;
  children: string;
  dimColor?: boolean;
  color?: string;
}) {
  const keyIndex = children.indexOf(keyBind);
  const before = children.slice(0, keyIndex);
  const after = children.slice(keyIndex + 1);

  return (
    <Text dimColor {...props}>
      {before}
      <Text color="cyan">{`[${keyBind}]`}</Text>
      {after}
    </Text>
  );
}
