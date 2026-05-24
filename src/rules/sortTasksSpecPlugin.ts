import { visit } from "unist-util-visit";
import type { Root, List, ListItem } from "mdast";
import "../markdown/ast-augmentations.js";
import { makePlugin } from "./makePlugin.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";

function sortTaskItems(items: ListItem[]): ListItem[] {
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

      if (!aDone) return a.index - b.index;
      const fieldsA = getInlineFields(a.item);
      const fieldsB = getInlineFields(b.item);
      if (fieldsA.done && fieldsB.done) {
        return fieldsA.done.localeCompare(fieldsB.done);
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
    if (!Array.isArray(listNode.children)) return;
    listNode.spread = false;
    listNode.children = sortTaskItems(listNode.children);
  });
});
