import {
  getInlineFields,
  setInlineField,
} from "../markdown/inlineFieldsPlugin.js";
import { visit } from "unist-util-visit";
import type { ListItem } from "mdast";
import "../markdown/ast-augmentations.js";
import { format } from "date-fns-tz";
import { addDays } from "date-fns";
import { makePlugin } from "./makePlugin.js";

/** Inline date fields that may contain relative date literals. */
const DATE_KEYS = ["due", "start", "snooze", "done"] as const;

/**
 * remark plugin to normalize 'today' literals in date fields to the current date.
 * - Finds any inline field with value 'today' and replaces it with the ISO date for today.
 */
export const normalizeTodayPlugin = makePlugin(
  "normalizeTodayLiteral",
  function ({ tree, ctx }) {
    const { timezone, todayDate } = ctx;

    const toISO = (d: Date) => format(d, "yyyy-MM-dd", { timeZone: timezone });

    const todayStr = format(todayDate, "yyyy-MM-dd", { timeZone: timezone });
    const yesterdayDate = addDays(todayDate, -1);
    const tomorrowDate = addDays(todayDate, 1);
    const yesterdayStr = toISO(yesterdayDate);
    const tomorrowStr = toISO(tomorrowDate);
    // Normalize all recognized date literals in DATE_KEYS only, on the inlineFields node
    // ...existing code...
    visit(tree, "listItem", (node: ListItem) => {
      const fields = getInlineFields(node);
      for (const key of DATE_KEYS) {
        const value = fields[key];
        if (typeof value === "string") {
          const v = value.trim().toLowerCase();
          if (v === "today") {
            setInlineField(node, key, todayStr);
          } else if (v === "yesterday") {
            setInlineField(node, key, yesterdayStr);
          } else if (v === "tomorrow") {
            setInlineField(node, key, tomorrowStr);
          }
        }
      }
    });
    return tree;
  },
);
