import { visit } from "unist-util-visit";
import type { ListItem } from "./tasks.js";
import type { Handlers } from "./types.js";
import type { Root } from "mdast";
import type { Paragraph, Text as TaskText } from "./tasks.js";

/**
 * remark plugin to extract inline fields from task text and store them in .data.inlineFields on each listItem node.
 * Removes inline fields from the text node, so downstream plugins work with clean text and structured data.
 */
export function inlineFields() {
  return (tree: Root) => {
    visit(tree, "listItem", (node: ListItem) => {
      // Only operate on paragraphs with a single text node child
      const para = node.children.find(
        (c): c is Paragraph =>
          c.type === "paragraph" && Array.isArray((c as Paragraph).children),
      );
      if (!para || para.children.length !== 1) return;
      const textNode = para.children[0];
      if (textNode.type !== "text" || typeof textNode.value !== "string")
        return;
      const text = textNode.value;
      // Extract inline fields (e.g. key:value pairs)
      const fieldPattern = /(?:^|\s)([a-zA-Z][\w-]*):([^\s]+)/g;
      let match;
      const fields: Record<string, string> = {};
      let cleanText = text;
      while ((match = fieldPattern.exec(text)) !== null) {
        fields[match[1]] = match[2];
        // Remove the field from the text
        cleanText = cleanText.replace(match[0], "");
      }
      node.data = node.data || {};
      node.data.inlineFields = fields;
      textNode.value = cleanText.trim();
    });
  };
}

// Handler for remark-stringify to serialize inline fields in deterministic order
const KNOWN_INLINE_FIELD_ORDER = [
  "due",
  "sleep",
  "start",
  "snooze",
  "done",
  "repeat",
  "copied",
  "ephemeral",
];

type TextWithInlineFields = TaskText & {
  data?: { inlineFields?: Record<string, string> };
};
export const inlineFieldsHandler: Handlers["text"] = (
  node: TextWithInlineFields,
) => {
  const fields = node.data?.inlineFields;
  if (!fields || Object.keys(fields).length === 0) return node.value;
  // Re-serialize fields in canonical order
  const tokens: string[] = [];
  for (const key of KNOWN_INLINE_FIELD_ORDER) {
    if (fields[key]) tokens.push(`${key}:${fields[key]}`);
  }
  // Add any extra fields not in the known order
  for (const key of Object.keys(fields)) {
    if (!KNOWN_INLINE_FIELD_ORDER.includes(key)) {
      tokens.push(`${key}:${fields[key]}`);
    }
  }
  return [node.value, ...tokens].filter(Boolean).join(" ").trim();
};
