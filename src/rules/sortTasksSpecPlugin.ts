import { visit } from "unist-util-visit";
import type { Root, List, ListItem } from "mdast";
import "../markdown/ast-augmentations.js";
import type { Parent as ParentNode } from "mdast";
import { getInlineField } from "../markdown/inlineFields.js";
import { parseDateStr } from "./scheduleUtils.js";
import type { WikiLinkNode } from "../markdown/types.js";
import { makePlugin } from "./makePlugin.js";

function isWikiLinkLike(node: unknown): node is WikiLinkNode {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "value" in node &&
    (node as { type?: string }).type === "wikiLink" &&
    typeof (node as { value?: unknown }).value === "string"
  );
}

function textFromNode(node: unknown): string {
  if (isWikiLinkLike(node)) {
    const alias = node.data?.alias;
    return alias && alias !== node.value
      ? `[[${node.value}|${alias}]]`
      : `[[${node.value}]]`;
  }

  if (typeof node === "object" && node !== null) {
    const value =
      "value" in node && typeof (node as { value?: unknown }).value === "string"
        ? (node as { value: string }).value
        : "";
    const childText =
      "children" in node && Array.isArray((node as ParentNode).children)
        ? (node as ParentNode).children.map(textFromNode).join("")
        : "";
    return `${value}${childText}`;
  }

  return "";
}

function taskText(item: ListItem): string {
  const parts: string[] = [];
  for (const child of item.children) {
    if (child.type !== "paragraph") continue;
    for (const inline of child.children) {
      parts.push(textFromNode(inline));
    }
  }
  return parts.join("").trim();
}

function completionTime(item: ListItem, timezone: string): number {
  const done = getInlineField(taskText(item), "done");
  if (!done) return Number.NEGATIVE_INFINITY;
  const parsed = parseDateStr(done, timezone);
  if (!parsed) return Number.NEGATIVE_INFINITY;
  return parsed.getTime();
}

function sortTaskItems(items: ListItem[], timezone: string): ListItem[] {
  return items
    .map((item, index) => ({
      item,
      index,
      doneDate: completionTime(item, timezone),
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
      if (a.doneDate !== b.doneDate) return b.doneDate - a.doneDate;
      return 0;
    })
    .map(({ item }) => item);
}

/**
 * remark plugin to sort tasks within each list in a markdown file.
 * - For each list, sort listItems by checked status (unchecked first), then by text (case-insensitive).
 */
export const sortTasksSpecPlugin = makePlugin(
  "sortTasks",
  function ({ tree, ctx }) {
    const { timezone = "UTC" } = ctx;
    visit(tree as Root, "list", (listNode: List) => {
      if (!Array.isArray(listNode.children)) return;
      listNode.spread = false;
      listNode.children = sortTaskItems(listNode.children, timezone);
    });
  },
);
