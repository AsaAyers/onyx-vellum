import { Box, Text } from "ink";
import type { FileDetail } from "./types.js";

function jobLabel(job: FileDetail["jobs"][number]): string {
  switch (job.type) {
    case "transcribe":
      return `Transcribe ${job.audioPath}`;
    case "clean-transcription":
      return "Clean transcription";
    case "find-tasks":
      return "Find tasks";
    case "summarize-text":
      return "Summarize text";
  }
}

export function FileDiffPanel({
  detail,
  fileName,
}: {
  detail: FileDetail;
  fileName: string;
}) {
  return (
    <Box flexDirection="column">
      <Text bold underline>
        {fileName}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {detail.diff.split("\n").map((line, i) => (
          <Text
            key={i}
            color={
              line.startsWith("+")
                ? "green"
                : line.startsWith("-")
                  ? "red"
                  : line.startsWith("@")
                    ? "cyan"
                    : "dim"
            }
            wrap="truncate"
          >
            {line}
          </Text>
        ))}
      </Box>
      {detail.jobs.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>
            Jobs produced
          </Text>
          {detail.jobs.map((job, i) => (
            <Box key={i} marginLeft={1}>
              <Text dimColor wrap="truncate">
                {jobLabel(job)}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
