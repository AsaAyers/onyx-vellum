import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import "../markdown/ast-augmentations.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import { format } from "date-fns-tz";

/**
 * remark plugin to stamp the current date into the `done` field of checked tasks that lack it.
 * - For each checked listItem, if there is no `done` field, set it to today.
 */
export const stampDonePlugin = makePlugin(
  "stampDone",
  function ({ tree, ctx }) {
    const todayStr = format(ctx.todayDate, "yyyy-MM-dd", {
      timeZone: ctx.timezone,
    });
    visit(tree as Root, "listItem", (node) => {
      if (!node.checked) return;
      const fields = getInlineFields(node);
      fields.done ??= todayStr;
    });
  },
);
