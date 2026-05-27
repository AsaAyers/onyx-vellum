import type { CleanTranscript } from "../types.js";
import type { JobWorker } from "./types.js";
import { type ChatRequest } from "ollama";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { callModel } from "../callModel.js";
import { extractSourceText } from "./extractSourceText.js";

const zCleanedTranscript = z
  .string()
  .describe(
    "Grammatically cleaned transcript. Preserve meaning, speaker labels, decisions, and uncertainty. Do not invent content.",
  );
const zTranscriptResult = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*\.md$/)
    .describe("Filesystem-safe kebab-case markdown filename ending in .md."),

  summary: z.string().describe("Concise summary of what was discussed."),

  cleanedTranscript: zCleanedTranscript,
});

const sarcasm = (text: string) =>
  [...text]
    .map((c, i) => (i % 2 == 0 ? c.toUpperCase() : c.toLowerCase()))
    .join("");

export type TranscriptResult = z.infer<typeof zTranscriptResult>;
async function processRawTranscript(
  rawTranscript: string,
): Promise<TranscriptResult> {
  if (process.env.NODE_ENV === "test") {
    const fakeTranscriptResult: TranscriptResult = {
      filename: "some-serious-content.md",
      cleanedTranscript: sarcasm(rawTranscript.split("\n").join(" ")),
      summary: sarcasm("Summary: " + rawTranscript.slice(0, 20) + "..."),
    };
    return fakeTranscriptResult;
  }
  return callModel(
    zTranscriptResult,
    createCleanupRequest(rawTranscript, zTranscriptResult),
  );
}

function createCleanupRequest(
  rawTranscript: string,
  zodSchema: z.ZodTypeAny,
): ChatRequest {
  const model = process.env.OLLAMA_MODEL ?? "gemma3";
  const schema = zodToJsonSchema(zodSchema, {
    name: "TranscriptResult",
  });
  return {
    model,
    stream: true,
    format: schema,

    options: {
      temperature: 0,
    },

    messages: [
      {
        role: "system",
        content: [
          "Return ONLY JSON data conforming to the provided schema.  No introductory or concluding text, no Markdown formatting, and no extraneous information.",
          "Clean up the transcript of a voice recording to improve grammar, punctuation, and readability while preserving the original meaning, decisions, speaker labels, and any uncertainty or ambiguity in the transcript.  Do not add any information that is not present in the original transcript.",
          "Clean up newlines that got injected into the middle of sentences, but preserve newlines that represent actual pauses or speaker changes.",
          "Clean up filler words like 'um', 'uh', 'like', 'you know', etc. only if they do not contribute to the meaning or tone of the conversation.",
          "File names should be lowercase kebab-case and end with .md.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "Process this transcript.",
          "",
          "Required output:",
          "- filename",
          "- summary",
          "- cleanedTranscript",
          "",
          "JSON schema:",
          JSON.stringify(schema, null, 2),
          "",
          "Transcript:",
          rawTranscript,
        ].join("\n"),
      },
    ],
  };
}

export const cleanTranscript: JobWorker<CleanTranscript> = async function (
  ctx,
) {
  const { job, fileOperations, debug } = ctx;

  const sourceText = await extractSourceText(
    ctx.job.vaultPath,
    ctx.job.source,
    ctx,
  );
  if (!sourceText) {
    throw new Error("Source text not found for transcription");
  }

  debug(`Extracted source text: ${sourceText.slice(0, 100)}...`);
  const r = await processRawTranscript(sourceText);

  fileOperations.updateFile({
    location: job.source,
    content: r.cleanedTranscript.split(/\n\n+/).join("\n"),
    frontmatter: {
      filename: r.filename,
      cleanText: new Date().toISOString(),
    },
  });
  fileOperations.updateFile({
    location: {
      file: job.target.location.file,
      header: "Summary",
      position: "start",
    },
    content: r.summary,
  });
};
