import { getInlineField } from "../markdown/inlineFields.js";
import { parseDateStr } from "./scheduleUtils.js";
import type { RuleSpec } from "./types.js";
import type { ListItem, Parent as ParentNode } from "mdast";

type WikiLinkLink = {
  type: "wikiLink";
  value: string;
  data?: { alias?: string };
};

function isWikiLinkLike(node: unknown): node is WikiLinkLink {
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

function completionTime(item: ListItem): number {
  const done = getInlineField(taskText(item), "done");
  if (!done) return Number.NEGATIVE_INFINITY;
  const parsed = parseDateStr(done);
  if (!parsed) return Number.NEGATIVE_INFINITY;
  return parsed.getTime();
}

export function sortTaskItems(items: ListItem[]): ListItem[] {
  return items
    .map((item, index) => ({ item, index, doneTime: completionTime(item) }))
    .sort((a, b) => {
      // Do not sort bulletted lists, only checklist items.
      if (a.item.checked === null || b.item.checked === null) {
        return 0;
      }
      const aDone = a.item.checked === true;
      const bDone = b.item.checked === true;
      if (aDone !== bDone) return Number(aDone) - Number(bDone);
      if (!aDone) return a.index - b.index;
      if (a.doneTime !== b.doneTime) return b.doneTime - a.doneTime;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export const sortTasksSpec: RuleSpec = {
  name: "sortTasks",
  sources: [{ type: "glob", pattern: "**/*.md" }],
  query: { type: "tasks" },
  actions: [],
};
