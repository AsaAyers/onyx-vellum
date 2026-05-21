import { visit } from "unist-util-visit";
import {
  parseRepeat,
  computeNextDue,
  parseDateStr,
  formatDateStr,
} from "./scheduleUtils.js";
import { addDays, differenceInCalendarDays } from "date-fns";
import type { ListItem, Root } from "mdast";
import type { Plugin } from "unified";

import "../markdown/ast-augmentations.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import type { Config } from "../config.js";

/**
 * remark plugin to perform completed task rollover using inline field data.
 * - Finds checked, recurring tasks completed today (done:today, repeat, not copied)
 * - Appends copied:1 to the completed task
 * - Inserts a fresh incomplete copy after it, with advanced date fields
 */
export const rolloverPlugin: Plugin<
  [Config["rules"]["completedTaskRollover"]],
  Root
> = function () {
  const processor = this;
  return function (tree, _file) {
    const settings = processor.data("settings");
    const todayStr = settings?.onyxVellum?.today;
    const timezone = settings?.onyxVellum?.timezone || "UTC";
    if (!todayStr) {
      console.log("[rolloverPlugin] No today value in settings");
      return;
    }
    visit(tree as Root, "listItem", (node, idx, parent) => {
      const fields = getInlineFields(node);
      console.log(
        "[rolloverPlugin] listItem fields:",
        fields,
        "checked:",
        node.checked,
      );
      if (!fields.repeat || !fields.done || fields.copied !== undefined) {
        console.log(
          "[rolloverPlugin] Skipping: missing repeat/done or already copied",
        );
        return;
      }
      if (node.checked !== true) {
        console.log("[rolloverPlugin] Skipping: not checked");
        return;
      }
      const doneDate = parseDateStr(fields.done, timezone);
      if (!doneDate) {
        console.log(
          "[rolloverPlugin] Skipping: done field not a valid date",
          fields.done,
        );
        return;
      }
      // Compare using timezone-aware formatting
      const todayIso = formatDateStr(doneDate, timezone);
      if (todayIso !== todayStr) {
        console.log(
          "[rolloverPlugin] Skipping: done field does not match today (tz aware)",
          todayIso,
          todayStr,
        );
        return;
      }
      fields.copied = "1";
      const repeat = parseRepeat(fields.repeat);
      if (!repeat) return;
      const newDue = computeNextDue(doneDate, repeat);
      const newDueStr = formatDateStr(newDue, timezone);
      const cloneFields = { ...fields };
      delete cloneFields.done;
      cloneFields.due = newDueStr;

      // Compute delta in days between old and new due dates
      let oldDueDate: Date | null = null;
      if (fields.due) {
        oldDueDate = parseDateStr(fields.due, timezone);
      }
      const oldDue = oldDueDate ?? doneDate;
      const deltaDays = differenceInCalendarDays(newDue, oldDue);

      if (fields.start) {
        const startDate = parseDateStr(fields.start, timezone);
        if (startDate) {
          const newStart = addDays(startDate, deltaDays);
          cloneFields.start = formatDateStr(newStart, timezone);
        }
      }
      if (fields.snooze) {
        const snoozeDate = parseDateStr(fields.snooze, timezone);
        if (snoozeDate) {
          const newSnooze = addDays(snoozeDate, deltaDays);
          cloneFields.snooze = formatDateStr(newSnooze, timezone);
        }
      }

      const newListItem: ListItem = JSON.parse(JSON.stringify(node));
      newListItem.checked = false;
      const newFields = getInlineFields(newListItem);
      Object.assign(newFields, cloneFields);
      delete newFields.done;
      delete newFields.copied;

      if (typeof idx === "number" && parent) {
        parent.children.splice(idx + 1, 0, newListItem);
      } else {
        throw new Error(
          "Expected listItem to have an index in its parent list",
        );
      }
    });
  };
};
