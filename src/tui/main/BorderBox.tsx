import type { ReactNode } from "react";
import { Box, Text } from "ink";

export function BorderBox({
  title,
  children,
  flexGrow,
}: {
  title: string;
  children: ReactNode;
  flexGrow?: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={flexGrow}>
      <Box borderStyle="round" flexDirection="column" flexGrow={1}>
        {children}
      </Box>
      <Box position="absolute" marginLeft={1}>
        <Text>
          {"─── "}
          <Text bold>{title}</Text>
          {" ───"}
        </Text>
      </Box>
    </Box>
  );
}
