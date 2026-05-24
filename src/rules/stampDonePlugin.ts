import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";

/**
 * remark plugin to stamp the current date into the `done` field of checked tasks that lack it.
 * - For each checked listItem, if there is no `done` field, set it to today.
 */
export const stampDonePlugin = makePlugin(
  "stampDone",
  function ({ tree, ctx }) {
    const today = ctx.dates.today;
    visit(tree as Root, "listItem", (node) => {
      if (!node.checked) return;
      const fields = getInlineFields(node);
      fields.done ??= today;
    });
  },
);
