import { type ChatRequest } from "ollama";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Task, taskArraySchema } from "../../markdown/Task.js";
import { callModel } from "../callModel.js";
import type { FindTasksJob } from "../types.js";
import type { JobWorker } from "./types.js";
import { extractSourceText } from "./extractSourceText.js";
import type { List, ListItem } from "mdast";
import type { InlineFieldsNode } from "../../markdown/types.js";

const fakeTasks = taskArraySchema.parse([
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
  {
    sourcePath: "unknown",
    title: "Call mom",
    text: "Call mom",
    checked: false,
    fields: {
      due: "after cleaning the car",
    },
  },
]);

function createTaskRequest(
  cleanTranscript: string,
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

export const findTasks: JobWorker<FindTasksJob> = async function (ctx) {
  let tasks: Task[] = [];
  if (process.env.NODE_ENV === "test") {
    tasks = fakeTasks;
  } else {
    const sourceText = await extractSourceText(
      ctx.job.vaultPath,
      ctx.job.source,
      ctx,
    );
    tasks = await callModel(
      taskArraySchema,
      createTaskRequest(sourceText, taskArraySchema),
    );
  }

  const list: List = {
    type: "list",
    ordered: false,
    start: null,
    spread: false,
    children: tasks.map((task) => {
      const listItem: ListItem = {
        type: "listItem",
        spread: false,
        checked: task.checked,
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "text",
                value: task.text,
              },
            ],
          },
        ],
      };
      if (Object.keys(task.fields).length > 0) {
        const inlineFields: InlineFieldsNode = {
          type: "inlineFields",
          value: "",
          data: {
            inlineFields: task.fields,
          },
        };
        // @ts-expect-error - This is a custom node type
        listItem.children.push(inlineFields);
      }
      return listItem;
    }),
  };

  ctx.job.target.frontmatter ??= {};
  ctx.job.target.frontmatter.tasks = new Date().toISOString();
  ctx.job.target.content = list;
  ctx.fileOperations.updateFile(ctx.job.target);
};
