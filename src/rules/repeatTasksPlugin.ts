import { visit } from "unist-util-visit";
import type { ListItem, Root } from "mdast";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import { rolloverTask, parseDateInTz } from "./rolloverTask.js";

/**
 * remark plugin to perform completed task rollover using inline field data.
 * - Finds checked, recurring tasks completed today (done:today, repeat, not copied)
 * - Inserts a fresh incomplete copy after it, with advanced date fields
 * - Strips repeat from the original to prevent re-processing
 */
export const repeatTasksPlugin = makePlugin(
  "repeatTasks",
  function ({ tree, ctx, debug, file: _file }) {
    const { tz } = ctx.dates;

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

      const doneDate = parseDateInTz(fields.done, tz);
      if (!doneDate) return;

      const result = rolloverTask(fields, doneDate, tz);
      if (!result) return;

      const newListItem: ListItem = JSON.parse(JSON.stringify(node));
      newListItem.checked = false;
      const newFields = getInlineFields(newListItem);
      Object.assign(newFields, result.clone);
      delete newFields.done;
      delete newFields.copied;
      debug({ newFields });

      parent.children.splice(idx + 1, 0, newListItem);

      // Strip repeat from original to prevent re-processing
      delete fields.repeat;
    });
  },
);
