import { extractInlineFields, EMOJI_MAP } from "./inlineFieldsPlugin.js";
import { z } from "zod";

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
      "Inline fields (e.g. due:today snooze:2026-02-01 done:yesterday repeat:1s)." +
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

const KNOWN_INLINE_FIELD_ORDER = [
  "due",
  "sleep",
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
  const { clean, fields: allFields } = extractInlineFields(text);
  const fields: Partial<Record<KnownInlineFieldKey, string>> = {};
  for (const [key, value] of Object.entries(allFields)) {
    const knownKey = normalizeKnownFieldKey(key);
    if (knownKey && fields[knownKey] === undefined) {
      fields[knownKey] = value;
    }
  }
  return {
    title: clean.trimEnd(),
    fields,
  };
}

function serializeTaskText(
  title: string,
  fields: Record<string, string>,
): string {
  const fieldTokens = KNOWN_INLINE_FIELD_ORDER.map((key) => {
    if (fields[key] === undefined) return undefined;
    const emoji = EMOJI_MAP[key];
    return emoji ? `${emoji}:${fields[key]}` : `${key}:${fields[key]}`;
  }).filter((token): token is string => token !== undefined);

  const base = title.trim();
  if (base.length === 0) return fieldTokens.join(" ").trim();
  if (fieldTokens.length === 0) return base;
  return `${base} ${fieldTokens.join(" ")}`;
}
