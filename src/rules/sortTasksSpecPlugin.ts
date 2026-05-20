import { visit } from "unist-util-visit";
import type { Plugin, Processor } from "unified";
import type { Root, List } from "mdast";
import "../markdown/ast-augmentations.js";
import type { Config } from "../config.js";
import { fileMatchesSources } from "../engine/runner.js";
import invariant from "tiny-invariant";
import type { Node } from "mdast";
import { sortTaskItems } from "./sortTasks.js";

/**
 * remark plugin to sort tasks within each list in a markdown file.
 * - For each list, sort listItems by checked status (unchecked first), then by text (case-insensitive).
 */
export const sortTasksSpecPlugin: Plugin<[Config["rules"]["sortTasks"]], Root> =
  function (this: Processor<Node | undefined>, config) {
    const processor = this;
    const settings = processor.data("settings");
    invariant(
      settings?.onyxVellum,
      "onyxVellum settings must be provided for sortTasksSpecPlugin",
    );
    const vaultPath = settings.onyxVellum.vaultPath;
    return function (tree, file) {
      if (
        config?.sources &&
        file.path &&
        !fileMatchesSources(file.path, config.sources, vaultPath)
      ) {
        return tree;
      }
      visit(tree as Root, "list", (listNode: List) => {
        if (!Array.isArray(listNode.children)) return;
        listNode.spread = false;
        listNode.children = sortTaskItems(listNode.children);
      });
    };
  };
