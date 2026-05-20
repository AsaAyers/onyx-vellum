import { visit } from "unist-util-visit";
import type { Plugin, Processor } from "unified";
import type { Root } from "mdast";
import "../markdown/ast-augmentations.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import type { Config } from "../config.js";
import { fileMatchesSources } from "../engine/runner.js";
import invariant from "tiny-invariant";
import type { Node } from "mdast";

/**
 * remark plugin to remove unchecked ephemeral tasks that are overdue.
 * - For each unchecked listItem, if it has an ephemeral field, a due field, and due < today, remove it from the AST.
 */
export const removeEphemeralOverdueTasksPlugin: Plugin<
  [Config["rules"]["removeEphemeralOverdueTasks"]],
  Root
> = function (this: Processor<Node | undefined>, config) {
  const processor = this;
  const settings = processor.data("settings");
  invariant(
    settings?.onyxVellum,
    "onyxVellum settings must be provided for removeEphemeralOverdueTasksPlugin",
  );
  const vaultPath = settings.onyxVellum.vaultPath;
  const todayStr = settings?.onyxVellum?.today;
  return function (tree, file) {
    if (
      config?.sources &&
      file.path &&
      !fileMatchesSources(file.path, config.sources, vaultPath)
    ) {
      return tree;
    }
    if (!todayStr) return;
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
  };
};
