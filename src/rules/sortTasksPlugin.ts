import { visit } from "unist-util-visit";
import type { Root, List, ListItem } from "mdast";
import { makePlugin } from "./makePlugin.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";

export function sortTasksPlugin(items: ListItem[]): ListItem[] {
  return items
    .map((item, index) => ({
      item,
      index,
    }))
    .sort((a, b) => {
      if (
        typeof a.item.checked !== "boolean" ||
        typeof b.item.checked !== "boolean"
      ) {
        // Only sort tasks, not lists
        return 0;
      }

      const aDone = a.item.checked === true;
      const bDone = b.item.checked === true;

      // 1. Incomplete before complete
      if (aDone !== bDone) return Number(aDone) - Number(bDone);

      const fieldsA = getInlineFields(a.item);
      const fieldsB = getInlineFields(b.item);
      const numA = Object.keys(fieldsA).length;
      const numB = Object.keys(fieldsB).length;

      // 2. No fields before fields (binary: only 0 vs >0 matters)
      if (numA === 0 && numB > 0) return -1;
      if (numA > 0 && numB === 0) return 1;

      if (!aDone) {
        // -- Incomplete tasks --
        const aSleep = !!fieldsA.sleep;
        const bSleep = !!fieldsB.sleep;

        // 3. Non-sleeping before sleeping
        if (aSleep !== bSleep) return aSleep ? 1 : -1;

        if (aSleep) {
          // 4a. Sleeping: sort by sleep date ascending
          return fieldsA.sleep.localeCompare(fieldsB.sleep);
        }

        // 4b. Non-sleeping: sort by due date ascending
        if (fieldsA.due && fieldsB.due) {
          return fieldsA.due.localeCompare(fieldsB.due);
        }
        if (fieldsA.due && !fieldsB.due) return -1;
        if (!fieldsA.due && fieldsB.due) return 1;
        return 0;
      } else {
        // -- Complete tasks --
        // Sort by done date descending
        if (fieldsA.done && fieldsB.done) {
          return -fieldsA.done.localeCompare(fieldsB.done);
        }
        if (fieldsA.done && !fieldsB.done) return -1;
        if (!fieldsA.done && fieldsB.done) return 1;
        return 0;
      }
    })
    .map(({ item }) => item);
}

/**
 * remark plugin to sort tasks within each list in a markdown file.
 * - For each list, sort listItems by checked status (unchecked first), then by text (case-insensitive).
 */
export const sortTasksSpecPlugin = makePlugin("sortTasks", function ({ tree }) {
  visit(tree as Root, "list", (listNode: List) => {
    const children = listNode.children;
    if (!Array.isArray(children)) return;
    listNode.children = sortTasksPlugin(children);

    if (
      listNode.children.some(
        (child, index) => children.indexOf(child) !== index,
      )
    ) {
      // Compress sorted lists
      listNode.spread = false;
    }
  });
});
