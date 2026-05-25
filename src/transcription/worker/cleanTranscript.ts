import { VFile } from "vfile";
import { readFileOperationTarget } from "../../engine/FileOperationExecutor.js";
import type { CleanTranscript } from "../types.js";
import type { JobWorker } from "./types.js";
import { type ChatRequest } from "ollama";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { callModel } from "../callModel.js";

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
export async function processRawTranscript(
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

export const summarizeTextWorker: JobWorker<CleanTranscript> = async function ({
  job,
  getWriteManager,
  getProcessor,
  fileOperations,
}) {
  const fileManager = getWriteManager(job.vaultPath);
  const processor = await getProcessor(job.vaultPath);
  const vaultFile = job.source.file;
  const file = new VFile({
    path: vaultFile.relativePath,
    value: await fileManager.read(vaultFile),
  });

  const tree = processor.parse(file);
  const children = readFileOperationTarget(tree, job.source);
  const sourceText = processor.stringify(
    {
      type: "root",
      children,
    },
    file,
  );

  const r = await processRawTranscript(sourceText);
  console.log(job.source.file, { file, r });
  job.target.frontmatter ??= {};
  job.target.frontmatter.filename = r.filename;
  job.target.content = r.cleanedTranscript;
  fileOperations.updateFile(job.target);
  fileOperations.updateFile({
    location: {
      file: job.target.location.file,
      header: "Summary",
      position: "end",
    },
    content: r.summary,
  });
};
