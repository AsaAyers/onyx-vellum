import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";

/**
 * remark plugin to remove unchecked ephemeral tasks that are overdue.
 * - For each unchecked listItem, if it has an ephemeral field, a due field, and due < today, remove it from the AST.
 */
export const removeEphemeralOverdueTasksPlugin = makePlugin(
  "removeEphemeralOverdueTasks",
  function ({ tree, ctx }) {
    const todayStr = ctx.dates.today;
    visit(tree as Root, "list", (listNode) => {
      // Remove matching listItems in-place
      if (!Array.isArray(listNode.children)) return;
      listNode.children = listNode.children.filter((item) => {
        if (item.type !== "listItem" || item.checked) return true;
        const fields = getInlineFields(item);
        if (!("ephemeral" in fields)) return true;
        if (!("due" in fields)) return true;
        // Compare due date to today
        // ISO date string comparison is safe for yyyy-mm-dd
        if (fields.due < todayStr) {
          return false; // Remove this item
        }
        return true;
      });
    });
  },
);
