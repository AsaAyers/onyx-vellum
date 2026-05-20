import { visit } from "unist-util-visit";
import type { Plugin, Processor } from "unified";
import type { Root } from "mdast";
import "../markdown/ast-augmentations.js";

/**
 * remark plugin to stamp the current date into the `done` field of checked tasks that lack it.
 * - For each checked listItem, if there is no `done` field, set it to today.
 */
export const stampDonePlugin: Plugin = function () {
  return function (this: Processor, tree) {
    const settings = this.data("settings");
    const todayStr = settings?.onyxVellum?.today;
    if (!todayStr) return;
    visit(tree as Root, "listItem", (node) => {
      if (!node.checked) return;
      node.data ??= {};
      const fields = node.data.inlineFields ?? {};
      if (!fields.done) {
        fields.done = todayStr;
      }
      node.data.inlineFields = fields;
    });
  };
};
