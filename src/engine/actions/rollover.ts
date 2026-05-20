import { addDays, differenceInCalendarDays } from "date-fns";
import {
  getInlineField,
  removeInlineField,
  setInlineField,
} from "../../markdown/inlineFields.js";
import {
  computeNextDue,
  parseDateStr,
  parseRepeat,
} from "../../rules/scheduleUtils.js";
import type { RolloverAction } from "../../rules/types.js";
import { formatDate } from "./dateHelpers.js";
import type { ActionOutcome } from "./types.js";
import type { List, ListItem } from "mdast";

export function applyRollover(
  item: ListItem,
  parentList: List,
  _action: RolloverAction,
  today: Date,
): ActionOutcome {
  // Helper to get the text of the task
  function getTextFromItem(item: ListItem): string {
    let text = "";
    for (const child of item.children) {
      if (child.type === "paragraph") {
        for (const inline of child.children) {
          if (inline.type === "text") {
            text += inline.value;
          }
        }
      }
    }
    return text.trim();
  }

  // Get the original text
  const taskText = getTextFromItem(item);
  let cloneText = removeInlineField(taskText, "done");

  // Apply the repeat schedule to the clone's dates, leaving the original task's dates untouched.
  const repeatStr = getInlineField(cloneText, "repeat");
  if (repeatStr) {
    const schedule = parseRepeat(repeatStr);
    if (schedule) {
      const doneStr = getInlineField(taskText, "done");
      const doneDate = doneStr ? (parseDateStr(doneStr) ?? today) : today;
      const newDue = computeNextDue(doneDate, schedule);
      const newDueStr = formatDate(newDue);

      const existingDueStr = getInlineField(cloneText, "due");
      const oldDue = existingDueStr
        ? (parseDateStr(existingDueStr) ?? doneDate)
        : doneDate;
      const delta = differenceInCalendarDays(newDue, oldDue);

      cloneText = setInlineField(cloneText, "due", newDueStr);

      const startStr = getInlineField(cloneText, "start");
      if (startStr) {
        const startDate = parseDateStr(startStr);
        if (startDate) {
          cloneText = setInlineField(
            cloneText,
            "start",
            formatDate(addDays(startDate, delta)),
          );
        }
      }

      const snoozeStr = getInlineField(cloneText, "snooze");
      if (snoozeStr) {
        const snoozeDate = parseDateStr(snoozeStr);
        if (snoozeDate) {
          cloneText = setInlineField(
            cloneText,
            "snooze",
            formatDate(addDays(snoozeDate, delta)),
          );
        }
      }
    }
  }

  // Mark the original task as copied (mutate the node)
  for (const child of item.children) {
    if (child.type === "paragraph") {
      for (const inline of child.children) {
        if (inline.type === "text") {
          // Replace the text value with the updated one
          inline.value = setInlineField(taskText, "copied", "1");
        }
      }
    }
  }

  // Insert the duplicate after the current item in the parent list
  const idx = parentList.children.indexOf(item);
  if (idx !== -1) {
    const newItem: ListItem = JSON.parse(JSON.stringify(item));
    // Set the text of the new item to the cloneText
    for (const child of newItem.children) {
      if (child.type === "paragraph") {
        for (const inline of child.children) {
          if (inline.type === "text") {
            inline.value = cloneText;
          }
        }
      }
    }
    parentList.children.splice(idx + 1, 0, newItem);
  }

  return {
    text: getTextFromItem(item),
    // No need to return insertDuplicateAfter, as the AST is mutated directly
  };
}
