import { visit } from "unist-util-visit";
import type { Plugin, Processor } from "unified";
import type { Root } from "mdast";
import "../markdown/ast-augmentations.js";

/** Inline date fields that may contain relative date literals. */
const DATE_KEYS = ["due", "start", "snooze", "done"] as const;

/**
 * remark plugin to normalize 'today' literals in date fields to the current date.
 * - Finds any inline field with value 'today' and replaces it with the ISO date for today.
 */
export const normalizeTodayPlugin: Plugin<[], Root> = function () {
  /**
   * _file is necessary to make it a remark plugin and not a rehype plugin.
   */
  return function (this: Processor, tree, _file) {
    if (!this) {
      console.trace("what is ", this, tree);
      return;
    }

    const settings = this.data("settings");
    const todayStr = settings?.onyxVellum?.today;
    if (!todayStr) return;
    // Compute yesterday and tomorrow from todayStr
    const todayDate = new Date(todayStr);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const toISO = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(todayDate.getDate() - 1);
    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setDate(todayDate.getDate() + 1);
    const yesterdayStr = toISO(yesterdayDate);
    const tomorrowStr = toISO(tomorrowDate);
    // Normalize all recognized date literals in DATE_KEYS only
    visit(tree, "listItem", (node) => {
      const fields = node.data?.inlineFields ?? {};
      node.data ??= {};
      node.data.inlineFields = fields;
      if (
        !fields ||
        typeof fields !== "object" ||
        Object.keys(fields).length === 0
      )
        return;
      for (const key of DATE_KEYS) {
        const value = fields[key];
        if (typeof value === "string") {
          const v = value.trim().toLowerCase();
          if (v === "today") {
            fields[key] = todayStr;
          } else if (v === "yesterday") {
            fields[key] = yesterdayStr;
          } else if (v === "tomorrow") {
            fields[key] = tomorrowStr;
          }
        }
      }
    });
    return tree;
  };
};
