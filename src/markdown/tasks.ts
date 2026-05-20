import { z } from "zod";
import { visit } from "unist-util-visit";
import type { WikiLinkNode } from "./types.js";
import type { List, Text, Paragraph, ListItem } from "mdast";
import type { Root } from "mdast";

export const TaskInputSchema = z.object({
  text: z
    .string()
    .describe(
      "Task title and inline fields, e.g. 'Pay rent due:2026-05-03 repeat:mwf'.",
    ),
  checked: z.boolean().describe("Whether the task is complete."),
  fields: z
    .record(z.string())
    .default({})
    .describe(
      "Inline fields (e.g. due:today start:2026-01-01 snooze:2026-02-01 done:yesterday repeat)." +
        `
# dates

Dates are in ISO format (e.g. 2026-12-31) or one of the following keywords:
- today
- tomorrow
- yesterday

# repeat grammar

\`\`\`
repeat := <skipWeeks>? <days>
skipWeeks := one or more decimal digits   (number of weeks to skip; default 0)
days      := "d" | [smtwhfa]+
             ("d" is a daily shorthand for all seven days)
\`\`\`

Weekday alphabet: 's'=Sunday · 'm'=Monday · 't'=Tuesday · 'w'=Wednesday · 'h'=Thursday · 'f'=Friday · 'a'=Saturday

**Daily shorthand 'd'** is an alias for 'smtwhfa' (all seven days). The two
forms are completely interchangeable; prefer 'd' for brevity.
      `,
    ),
  sourcePath: z
    .string()
    .default("")
    .describe(
      "Vault-relative source path for extracted tasks. Leave empty when unknown.",
    ),
});

export class Task {
  text: string;
  title: string;
  checked: boolean;
  fields: Record<string, string>;
  /** Vault-relative path of the file this task was extracted from. */
  sourcePath: string;

  constructor({
    text,
    fields = {},
    checked,
    sourcePath = "",
  }: z.input<typeof TaskInputSchema>) {
    const { title, fields: extractedFields } = splitKnownInlineFields(text);
    const normalizedFields = normalizeKnownFields(fields);
    this.text = text;
    this.title = title;
    this.checked = checked;
    this.fields = { ...extractedFields, ...normalizedFields };
    this.sourcePath = sourcePath;
  }

  toString(): string {
    const serialized = serializeTaskText(this.title, this.fields);
    return `* [${this.checked ? "x" : " "}] ${serialized}`;
  }
}

export const TaskSchema = TaskInputSchema.transform((task) => new Task(task));

export const taskArraySchema = z
  .array(TaskSchema)
  .describe(
    "Tasks explicitly mentioned or clearly implied by the transcript. Empty array if none.",
  );

function isWikiLinkNode(node: unknown): node is WikiLinkNode {
  if (typeof node !== "object" || node === null) return false;
  if (!("type" in node) || !("value" in node)) return false;
  return node.type === "wikiLink" && typeof node.value === "string";
}

export function getListItemText(item: ListItem): string {
  const parts: string[] = [];
  for (const child of item.children) {
    if (child.type === "paragraph") {
      for (const inline of (child as Paragraph).children) {
        if (inline.type === "text") {
          parts.push((inline as Text).value);
          continue;
        }
        const inlineNode: unknown = inline;
        if (isWikiLinkNode(inlineNode)) {
          const alias = inlineNode.data?.alias;
          if (alias && alias !== inlineNode.value) {
            parts.push(`[[${inlineNode.value}|${alias}]]`);
          } else {
            parts.push(`[[${inlineNode.value}]]`);
          }
        }
      }
    }
  }
  return parts.join("").trim();
}

const KNOWN_INLINE_FIELD_ORDER = [
  "due",
  "sleep",
  "start",
  "snooze",
  "done",
  "repeat",
  "copied",
  "ephemeral",
] as const;
type KnownInlineFieldKey = (typeof KNOWN_INLINE_FIELD_ORDER)[number];

function normalizeKnownFieldKey(key: string): KnownInlineFieldKey | undefined {
  const lower = key.toLowerCase();
  return KNOWN_INLINE_FIELD_ORDER.find((known) => known === lower);
}

function normalizeKnownFields(
  fields: Record<string, string>,
): Partial<Record<KnownInlineFieldKey, string>> {
  const normalized: Partial<Record<KnownInlineFieldKey, string>> = {};
  for (const [key, value] of Object.entries(fields)) {
    const knownKey = normalizeKnownFieldKey(key);
    if (!knownKey) continue;
    normalized[knownKey] = value;
  }
  return normalized;
}

function splitKnownInlineFields(text: string): {
  title: string;
  fields: Partial<Record<KnownInlineFieldKey, string>>;
} {
  const fields: Partial<Record<KnownInlineFieldKey, string>> = {};
  const titleTokens: string[] = [];

  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  for (const token of tokens) {
    // Parse `key:value` tokens; unknown keys are preserved in title.
    const match = token.match(/^([A-Za-z][A-Za-z0-9]*):(\S+)$/);
    if (!match) {
      titleTokens.push(token);
      continue;
    }

    const knownKey = normalizeKnownFieldKey(match[1]);
    if (!knownKey) {
      titleTokens.push(token);
      continue;
    }

    // First known value wins when duplicates appear (e.g. due:a due:b).
    if (fields[knownKey] === undefined) {
      fields[knownKey] = match[2];
    }
  }

  return {
    title: titleTokens.join(" ").trim(),
    fields,
  };
}

function serializeTaskText(
  title: string,
  fields: Record<string, string>,
): string {
  const fieldTokens = KNOWN_INLINE_FIELD_ORDER.map((key) =>
    fields[key] !== undefined ? `${key}:${fields[key]}` : undefined,
  ).filter((token): token is string => token !== undefined);

  const base = title.trim();
  if (base.length === 0) return fieldTokens.join(" ").trim();
  if (fieldTokens.length === 0) return base;
  return `${base} ${fieldTokens.join(" ")}`;
}

export function extractTasks(tree: Root, sourcePath: string): Task[] {
  const tasks: Task[] = [];
  visit(tree, "listItem", (node: ListItem) => {
    if (node.checked !== null && node.checked !== undefined) {
      const text = getListItemText(node);
      tasks.push(
        new Task({
          text,
          checked: node.checked,
          fields: {},
          sourcePath,
        }),
      );
    }
  });
  return tasks;
}

export function removeTask(tree: Root, taskText: string): boolean {
  let found = false;
  visit(tree, "list", (listNode) => {
    const list = listNode as List;
    const idx = list.children.findIndex((item) => {
      if (item.checked === null || item.checked === undefined) return false;
      return getListItemText(item) === taskText;
    });
    if (idx !== -1) {
      list.children.splice(idx, 1);
      found = true;
    }
  });
  return found;
}

export function setTaskChecked(
  tree: Root,
  taskText: string,
  checked: boolean,
): boolean {
  let found = false;
  visit(tree, "listItem", (node: ListItem) => {
    if (node.checked !== null && node.checked !== undefined) {
      if (getListItemText(node) === taskText) {
        node.checked = checked;
        found = true;
      }
    }
  });
  return found;
}

/**
 * Insert a new task list item immediately after the item whose text equals
 * `afterText`.  The new item's checked state is set to `checked` and its text
 * content to `newTaskText`.
 * Returns true if the anchor item was found and the new item was inserted.
 */
export function insertTaskAfter(
  tree: Root,
  afterText: string,
  newTaskText: string,
  checked: boolean,
): boolean {
  let inserted = false;
  visit(tree, "list", (listNode) => {
    const list = listNode as List;
    const idx = list.children.findIndex((item) => {
      if (item.checked === null || item.checked === undefined) return false;
      return getListItemText(item) === afterText;
    });
    if (idx !== -1 && !inserted) {
      const newItem: ListItem = {
        type: "listItem",
        checked,
        spread: false,
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: newTaskText } as Text],
          } as Paragraph,
        ],
      };
      list.children.splice(idx + 1, 0, newItem);
      inserted = true;
    }
  });
  return inserted;
}

/**
 * Replace the text content of a task list item in the AST.
 * Finds the item whose displayed text equals `oldText` and rewrites the
 * paragraph's inline children to a single Text node with `newText`.
 * Returns true if the item was found and updated.
 */
export function updateTaskText(
  tree: Root,
  oldText: string,
  newText: string,
): boolean {
  let found = false;
  visit(tree, "listItem", (node: ListItem) => {
    if (node.checked !== null && node.checked !== undefined) {
      if (getListItemText(node) === oldText) {
        for (const child of node.children) {
          if (child.type === "paragraph") {
            (child as Paragraph).children = [
              { type: "text", value: newText } as Text,
            ];
            found = true;
          }
        }
      }
    }
  });
  return found;
}
