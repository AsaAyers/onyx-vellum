import { taskArraySchema } from "../markdown/tasks.js";
import { z } from "zod";
import type { TranscriptResult } from "./worker/summarizeText.js";

export type TranscriptionStatus =
  | "pending"
  | "trimDeadAir"
  | "transcribing"
  | "processingTranscript"
  | "gatheringTasks"
  | "done"
  | "fail";

export type TranscriptionJob = {
  jobId: string;
  sourceAudioWikilink: string;
  status: TranscriptionStatus;
  transcriptText?: string;
  errorMessage?: string;
  tasks: z.infer<typeof taskArraySchema>;
  transcriptResult?: TranscriptResult;
  trimmed?: boolean;
};

export function formatTranscriptFile({
  jobId,
  sourceAudioWikilink,
  status,
  transcriptResult,
  errorMessage,
  transcriptText,
  trimmed,
  tasks,
}: TranscriptionJob) {
  const frontmatter = `---
status: ${status}
trimmedAudio: ${trimmed ? "yes" : "no"}
jobId: ${jobId}${transcriptResult?.filename ? `\nfilename: "${transcriptResult.filename}"` : ""}
---`;

  const parts: string[] = [];

  parts.push(`
Source audio: ${sourceAudioWikilink}
`);

  switch (status) {
    case "pending":
      parts.push("> Transcription is pending.");
      break;
    case "transcribing":
      parts.push("> Transcription is in progress.");
      break;
    case "processingTranscript":
      parts.push("> Transcript is being processed.");
      break;
    case "trimDeadAir":
      parts.push("> Removing dead air before final transcription.");
      break;
    case "done": /* do nothing */
  }

  if (errorMessage) {
    parts.push(`## Error

${errorMessage}
`);
  }

  const transcriptContent = transcriptText ?? "";
  if (transcriptContent) {
    parts.push(`# Transcript\n\n${transcriptContent}`);
  }

  if (transcriptResult?.summary) {
    parts.push(`# Summary\n\n${transcriptResult.summary}`);
  }

  if (Array.isArray(tasks) && tasks.length > 0) {
    parts.push(`# Tasks\n\n${tasks.join("\n")}`);
  }

  return `${frontmatter}${parts.join("\n")}`;
}
