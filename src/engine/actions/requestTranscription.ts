import { randomUUID } from "node:crypto";
import type { MarkdownLink } from "../../markdown/links.js";
import type { RequestTranscriptionAction } from "../../rules/types.js";
import type { ActionOutcome, LinkActionContext } from "./types.js";
import { resolveTranscriptContext } from "./linkTranscriptionContext.js";
import { formatTranscriptFile } from "../../transcription/format.js";
import type { TranscriptionPipelineJob } from "../../transcription/types.js";

export function buildJobId(createdAt: Date): string {
  const createdAtMs = createdAt.getTime();
  const uuid = randomUUID();
  return `${createdAtMs.toString(36)}-${uuid}`;
}

export function applyRequestTranscription(
  taskText: string,
  action: RequestTranscriptionAction,
  link: MarkdownLink | undefined,
  ctx?: LinkActionContext,
): ActionOutcome {
  void action;
  if (!link || !ctx) {
    return { text: taskText };
  }
  const transcript = resolveTranscriptContext(link, ctx);
  if (!transcript || transcript.transcriptExists) {
    return { text: taskText };
  }

  const createdAt = ctx.today.toISOString();
  const job: TranscriptionPipelineJob = {
    type: "transcription-pipeline",
    id: ctx.jobIdFactory(ctx.today),
    audioPath: transcript.audioPath,
    transcriptPath: transcript.transcriptPath,
    sourceNotePath: ctx.sourceNotePath,
    createdAt,
  };

  return {
    text: taskText,
    newFiles: {
      [transcript.transcriptPath]: formatTranscriptFile({
        jobId: job.id,
        sourceAudioWikilink: `[[${link.target}]]`,
        status: "pending",
        tasks: [],
      }),
    },
    transcriptionJobs: [job],
  };
}
