import { visit } from "unist-util-visit";
import type { Root, List, ListItem } from "mdast";
import { makePlugin } from "./makePlugin.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";

export function sortTasksPlugin(items: ListItem[]): ListItem[] {
  return items
    .map((item, index) => ({
      item,
      index,
      doneDate: getInlineFields(item).done,
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
      if (aDone !== bDone) return Number(aDone) - Number(bDone);

      const fieldsA = getInlineFields(a.item);
      const fieldsB = getInlineFields(b.item);
      if (fieldsA.sleep && fieldsB.sleep) {
        return fieldsA.sleep.localeCompare(fieldsB.sleep);
      }
      if (fieldsA.sleep || fieldsB.sleep) {
        return fieldsA.sleep ? 1 : -1;
      }
      if (fieldsA.due && fieldsB.due) {
        return fieldsA.due.localeCompare(fieldsB.due);
      }
      if (fieldsA.due || fieldsB.due) {
        return fieldsA.due ? -1 : 1;
      }

      if (fieldsA.done && fieldsB.done) {
        return -fieldsA.done.localeCompare(fieldsB.done);
      }
      return 0;
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
