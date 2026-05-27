import { visit, SKIP } from "unist-util-visit";
import type { Handlers, InlineFieldsNode } from "./types.js";
import type { ListItem, PhrasingContent, Root } from "mdast";
import type { Processor } from "unified";
import type { VFile } from "vfile";
import createDebug from "debug";

const debug = createDebug("onyx:inlineFieldsPlugin");

export const EMOJI_MAP: Record<string, string> = {
  sleep: "💤",
  due: "📅",
  done: "✅",
  repeat: "🔁",
  ephemeral: "⏳",
};

const EMOJI_REVERSE: Record<string, string> = {
  "💤": "sleep",
  "📅": "due",
  "✅": "done",
  "🔁": "repeat",
  "⏳": "ephemeral",
};

// Utility to get the inlineFields object from the last inlineFields node in a ListItem
export function getInlineFields(i: ListItem): Record<string, string> {
  for (let idx = i.children.length - 1; idx >= 0; idx--) {
    const child = i.children[idx];
    if (child.type === "paragraph" && Array.isArray(child.children)) {
      for (let j = child.children.length - 1; j >= 0; j--) {
        const c = child.children[j];
        if (c.type === "inlineFields") {
          c.data ??= {};
          c.data.inlineFields ??= {};
          return c.data.inlineFields as Record<string, string>;
        }
      }
      // Node not found, insert it at the end of the last paragraph
      const newNode: InlineFieldsNode = {
        type: "inlineFields",
        value: "",
        data: { inlineFields: {} },
      };
      (child.children as PhrasingContent[]).push(newNode);
      return newNode.data.inlineFields as Record<string, string>;
    }
  }
  return {};
}

// Utility to set a single inline field on a ListItem (mutates the last inlineFields node)
export function setInlineField(i: ListItem, key: string, value: string): void {
  const fields = getInlineFields(i);
  debug(`Setting inline field on list item: ${key}=${value}`);
  fields[key] = value;
}

// Utility to extract inline fields from text and return them as an object
export function extractInlineFields(text: string): {
  clean: string;
  fields: Record<string, string>;
} {
  const fieldPattern = /(?:^|\s)((?:💤|📅|✅|🔁|⏳|[a-zA-Z][\w-]*)):([^\s]+)/g;
  let match;
  let cleanText = text;
  const fields: Record<string, string> = {};
  // Track the indexes to remove, so we can do it in one pass
  const removals: { start: number; end: number }[] = [];
  while ((match = fieldPattern.exec(text)) !== null) {
    const rawKey = match[1];
    const value = match[2];
    const textKey = EMOJI_REVERSE[rawKey] ?? rawKey;
    if (KNOWN_INLINE_FIELD_ORDER.includes(textKey)) {
      fields[textKey] = value;
      const start = match.index;
      const end = match.index + match[0].length;
      removals.push({ start, end });
    }
  }
  if (removals.length > 0) {
    let result = "";
    let last = 0;
    for (let i = 0; i < removals.length; i++) {
      const { start, end } = removals[i];
      const before = cleanText.slice(last, start);
      // If the match starts with a space and the previous char in result is a space, skip the extra space
      if (before === " " && result.endsWith(" ")) {
        // skip
      } else {
        result += before;
      }
      last = end;
    }
    result += cleanText.slice(last);
    // Collapse all runs of 2+ spaces to a single space, but do not trim
    cleanText = result.replace(/ {2,}/g, " ");
  }
  return { clean: cleanText, fields };
}

/**
 * remark plugin to extract inline fields from task text and store them in .data.inlineFields on each listItem node.
 * Removes inline fields from the text node, so downstream plugins work with clean text and structured data.
 */

export const inlineFieldsPlugin = function (this: Processor) {
  return function (tree: Root, _file: VFile): Root | void {
    visit(tree, "listItem", (listItemNode: ListItem) => {
      const extractedFields: Record<string, string> = {};
      visit(listItemNode, ["list", "text"], (textNode) => {
        if (textNode.type === "list") return SKIP; // Don't extract from nested lists
        if (textNode.type === "text") {
          const { clean, fields } = extractInlineFields(textNode.value);
          Object.assign(extractedFields, fields);
          textNode.value = clean;
        }
      });
      Object.assign(getInlineFields(listItemNode), extractedFields);
    });
  };
};

// Handler for remark-stringify to serialize inline fields from the nearest listItem
const KNOWN_INLINE_FIELD_ORDER = [
  "sleep",
  "due",
  "repeat",
  "done",
  "copied",
  "ephemeral",
];

export const inlineFieldsNodeHandler: Handlers["inlineFields"] = (
  _node,
  _parent,
  _state,
) => {
  // Always serialize fields from the node's data property (never early return)
  const fields = _node.data?.inlineFields ?? {};
  const tokens: string[] = [];
  for (const key of KNOWN_INLINE_FIELD_ORDER) {
    if (fields[key]) {
      const emoji = EMOJI_MAP[key];
      tokens.push(emoji ? `${emoji}:${fields[key]}` : `${key}:${fields[key]}`);
    }
  }
  for (const key of Object.keys(fields)) {
    if (!KNOWN_INLINE_FIELD_ORDER.includes(key)) {
      tokens.push(`${key}:${fields[key]}`);
    }
  }
  return tokens.length ? " " + tokens.join(" ") : "";
};
