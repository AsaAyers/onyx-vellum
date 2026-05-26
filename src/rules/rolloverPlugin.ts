import { visit } from "unist-util-visit";
import { parseRepeat, computeNextDue } from "./scheduleUtils.js";
import { addDays, differenceInCalendarDays } from "date-fns";
import type { ListItem, Root } from "mdast";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import { format } from "date-fns-tz";
import { userLocalTime } from "../engine/userLocalTime.js";

/**
 * remark plugin to perform completed task rollover using inline field data.
 * - Finds checked, recurring tasks completed today (done:today, repeat, not copied)
 * - Appends copied:1 to the completed task
 * - Inserts a fresh incomplete copy after it, with advanced date fields
 */
export const rolloverPlugin = makePlugin(
  "rollover",
  function ({ tree, ctx, debug, file }) {
    // const { tz } = ctx.dates;
    // console.log("rolloverPlugin", { tz });

    const tz = "America/Los_Angeles";

    function formatDate(d: Date): string {
      return format(d, "yyyy-MM-dd", { timeZone: tz });
    }

    visit(tree as Root, "listItem", (node, idx, parent) => {
      if (typeof idx !== "number" || !parent) {
        throw new Error(
          "Expected listItem to have an index in its parent list",
        );
      }
      const fields = getInlineFields(node);

      // Migration: clean up tasks previously marked as copied
      if (fields.copied !== undefined) {
        delete fields.repeat;
        delete fields.copied;
        return;
      }

      if (!fields.repeat || !fields.done) {
        return;
      }
      if (node.checked !== true) {
        return;
      }
      const doneDate = userLocalTime({
        tz: ctx.dates.tz,
        strDate: fields.done,
      }).date;
      if (!doneDate) {
        return;
      }
      const repeat = parseRepeat(fields.repeat);
      if (!repeat) return;

      const newDue = computeNextDue(doneDate, repeat);
      const cloneFields = { ...fields };
      delete cloneFields.done;
      cloneFields.due = formatDate(newDue);

      // Compute delta in days between old and new due dates
      let oldDueDate: Date | null = null;
      if (fields.due) {
        oldDueDate = userLocalTime({ strDate: fields.due, tz }).date;
      }
      const oldDue = oldDueDate ?? doneDate;
      const deltaDays = differenceInCalendarDays(newDue, oldDue);

      if (fields.snooze) {
        const snoozeDate = userLocalTime({
          strDate: fields.snooze,
          tz,
        }).date;
        debug({ snoozeDate });
        if (snoozeDate) {
          const newSnooze = addDays(snoozeDate, deltaDays);
          cloneFields.snooze = formatDate(newSnooze);
          debug(file.path, "snooze", cloneFields.snooze);
        }
      }

      const newListItem: ListItem = JSON.parse(JSON.stringify(node));
      newListItem.checked = false;
      const newFields = getInlineFields(newListItem);
      Object.assign(newFields, cloneFields);
      delete newFields.done;
      delete newFields.copied;
      debug({ newFields });

      parent.children.splice(idx + 1, 0, newListItem);

      // Strip repeat from original to prevent re-processing
      delete fields.repeat;
    });
  },
);
