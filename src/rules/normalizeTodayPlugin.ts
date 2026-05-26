import {
  getInlineFields,
  setInlineField,
} from "../markdown/inlineFieldsPlugin.js";
import { visit } from "unist-util-visit";
import type { ListItem } from "mdast";
import { makePlugin } from "./makePlugin.js";

/** Inline date fields that may contain relative date literals. */
const DATE_KEYS = ["due", "snooze", "done"] as const;

/**
 * remark plugin to normalize 'today' literals in date fields to the current date.
 * - Finds any inline field with value 'today' and replaces it with the ISO date for today.
 */
export const normalizeTodayPlugin = makePlugin(
  "normalizeTodayLiteral",
  function ({ tree, ctx }) {
    const { today, yesterday, tomorrow } = ctx.dates;

    // Normalize all recognized date literals in DATE_KEYS only, on the inlineFields node
    // ...existing code...
    visit(tree, "listItem", (node: ListItem) => {
      const fields = getInlineFields(node);
      for (const key of DATE_KEYS) {
        const value = fields[key];
        if (typeof value === "string") {
          const v = value.trim().toLowerCase();
          if (v === "today") {
            setInlineField(node, key, today);
          } else if (v === "yesterday") {
            setInlineField(node, key, yesterday);
          } else if (v === "tomorrow") {
            setInlineField(node, key, tomorrow);
          }
        }
      }
    });
    return tree;
  },
);
