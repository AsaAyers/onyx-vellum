import {
  getInlineFields,
  setInlineField,
} from "../markdown/inlineFieldsPlugin.js";
import { visit } from "unist-util-visit";
import type { ListItem } from "mdast";
import { makePlugin } from "./makePlugin.js";
import { DATE_KEYS, resolveRelativeDateLiteral } from "./dateLiterals.js";

/**
 * remark plugin to normalize 'today' literals in date fields to the current date.
 * - Finds any inline field with value 'today' and replaces it with the ISO date for today.
 */
export const normalizeTodayPlugin = makePlugin(
  "normalizeTodayLiteral",
  function ({ tree, ctx }) {
    // Normalize all recognized date literals in DATE_KEYS only, on the inlineFields node
    visit(tree, "listItem", (node: ListItem) => {
      const fields = getInlineFields(node);
      for (const key of DATE_KEYS) {
        const value = fields[key];
        if (typeof value === "string") {
          const resolved = resolveRelativeDateLiteral(value, ctx.dates);
          if (resolved) {
            setInlineField(node, key, resolved);
          }
        }
      }
    });
    return tree;
  },
);
