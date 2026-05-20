import { visit } from "unist-util-visit";
import {
  parseRepeat,
  computeNextDue,
  parseDateStr,
  formatDateStr,
} from "./scheduleUtils.js";
import type { Paragraph, Text, ListItem, Root } from "mdast";
import type { Plugin } from "unified";

import "../markdown/ast-augmentations.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";

/**
 * remark plugin to perform completed task rollover using inline field data.
 * - Finds checked, recurring tasks completed today (done:today, repeat, not copied)
 * - Appends copied:1 to the completed task
 * - Inserts a fresh incomplete copy after it, with advanced date fields
 */
export const rolloverPlugin: Plugin = function () {
  const processor = this;
  return function (tree, _file) {
    const settings = processor.data("settings");
    const today = settings?.onyxVellum?.today;
    if (!today) return;
    // Tree needs to be passed "as Root" here in order to pick up the correct
    // type inferrence.
    visit(tree as Root, "listItem", (node, idx, parent) => {
      const fields = getInlineFields(node);
      if (!fields.repeat || !fields.done || fields.copied !== undefined) return;

      if (node.checked !== true) return;
      const doneDate = parseDateStr(fields.done);
      if (!doneDate) return;
      const todayStr = formatDateStr(today);
      if (fields.done !== todayStr) return;
      fields.copied = "1";
      const repeat = parseRepeat(fields.repeat);
      if (!repeat) return;
      const newDue = computeNextDue(doneDate, repeat);
      const newDueStr = formatDateStr(newDue);
      const cloneFields = { ...fields };
      delete cloneFields.done;
      cloneFields.due = newDueStr;
      if (fields.start) {
        const startDate = parseDateStr(fields.start);
        if (startDate) {
          const delta =
            (newDue.getTime() - doneDate.getTime()) / (1000 * 60 * 60 * 24);
          const newStart = new Date(
            startDate.getTime() + delta * 24 * 60 * 60 * 1000,
          );
          cloneFields.start = formatDateStr(newStart);
        }
      }
      if (fields.snooze) {
        const snoozeDate = parseDateStr(fields.snooze);
        if (snoozeDate) {
          const delta =
            (newDue.getTime() - doneDate.getTime()) / (1000 * 60 * 60 * 24);
          const newSnooze = new Date(
            snoozeDate.getTime() + delta * 24 * 60 * 60 * 1000,
          );
          cloneFields.snooze = formatDateStr(newSnooze);
        }
      }
      const origPara = node.children.find((c) => c.type === "paragraph");
      const origText = origPara?.children.find((c) => c.type === "text");
      const baseText = origText
        ? origText.value.replace(/\s*([a-zA-Z][\w-]*):[^\s]+/g, "").trim()
        : "";
      const newText: Text = { type: "text", value: baseText };
      const newPara: Paragraph = { type: "paragraph", children: [newText] };
      const newListItem: ListItem = {
        type: "listItem",
        checked: false,
        children: [newPara],
        data: { inlineFields: cloneFields },
      };
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
