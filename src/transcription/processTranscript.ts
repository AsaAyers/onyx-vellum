import { Ollama } from "ollama";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { taskArraySchema } from "../markdown/tasks.js";

const CleanedTranscript = z
  .string()
  .describe(
    "Grammatically cleaned transcript. Preserve meaning, speaker labels, decisions, and uncertainty. Do not invent content.",
  );
const TranscriptResult = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*\.md$/)
    .describe("Filesystem-safe kebab-case markdown filename ending in .md."),

  summary: z.string().describe("Concise summary of what was discussed."),

  cleanedTranscript: CleanedTranscript,
});

export type TranscriptResult = z.infer<typeof TranscriptResult>;

export const ollama = new Ollama({
  host: process.env.OLLAMA_HOST ?? "http://ollama-api:11434",
});

export async function processTranscript(
  rawTranscript: string,
): Promise<TranscriptResult> {
  const model = process.env.OLLAMA_MODEL ?? "gemma3";

  const response = await ollama.chat({
    ...createCleanupRequest(model, rawTranscript, TranscriptResult),
    stream: true,
  });

  let content = "";
  for await (const part of response) {
    content += part.message.content;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Ollama returned invalid JSON:\n${content}`);
  }

  return TranscriptResult.parse(parsed);
}

export async function gatherTasks(cleanTranscript: string) {
  const model = process.env.OLLAMA_MODEL ?? "gemma3";

  const response = await ollama.chat({
    ...createTaskRequest(model, cleanTranscript, taskArraySchema),
    stream: true,
  });

  let content = "";
  for await (const part of response) {
    content += part.message.content;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Ollama returned invalid JSON:\n${content}`);
  }

  return taskArraySchema.parse(parsed);
}

export function createCleanupRequest(
  model: string,
  rawTranscript: string,
  zodSchema: z.ZodTypeAny,
): import("ollama").ChatRequest & { stream?: false } {
  const schema = zodToJsonSchema(zodSchema, {
    name: "TranscriptResult",
  });
  return {
    model,
    stream: false,
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
          "- tasks",
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

export function createTaskRequest(
  model: string,
  cleanTranscript: string,
  zodSchema: z.ZodTypeAny,
): import("ollama").ChatRequest & { stream?: false } {
  const schema = zodToJsonSchema(zodSchema, {
    name: "TranscriptResult",
  });
  return {
    model,
    stream: false,
    format: schema,

    options: {
      temperature: 0,
    },

    messages: [
      {
        role: "system",
        content: [
          "You are a highly accurate task extraction engine.",
          "Your primary function is to analyze transcripts of voice recordings and identify all actionable tasks mentioned within the transcript.",
          "Return ONLY JSON data conforming to the provided schema.  No introductory or concluding text, no Markdown formatting, and no extraneous information.",
          "You MUST accurately identify all tasks, even if they are implied.  Do not invent tasks. Focus on extracting explicit mentions and clear implications from the text.",
          "If no tasks are found, return an empty `tasks` array.",
          "",
          "If a task is mentioned that has already been completed, mark it as checked.  Otherwise, mark it as unchecked.",
          "",
          "Extract inline fields from the task text and put them into the 'fields' object",
          "See the schema for all known fields.",
          "",
          "example:",
          "clean the car every other week on Saturdays. Take out the trash today, due today, snooze until yesterday on thursdays",
          "",
          "Expected:",
          JSON.stringify(
            taskArraySchema.parse([
              {
                sourcePath: "unknown",
                title: "Clean the car",
                text: "Clean the car",
                checked: false,
                fields: {
                  repeat: "1a",
                },
              },
              {
                sourcePath: "unknown",
                title: "Take out the trash",
                text: "Take out the trash",
                checked: false,
                fields: {
                  due: "today",
                  snooze: "yesterday",
                  repeat: "h",
                },
              },
            ] satisfies z.infer<typeof taskArraySchema>),
          ),
          "",
          "JSON schema:",
          JSON.stringify(taskArraySchema, null, 2),
        ].join("\n"),
      },
      {
        role: "user",
        content: ["Process this transcript:", cleanTranscript].join("\n"),
      },
    ],
  };
}
