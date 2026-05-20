import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { inlineFields } from "../src/markdown/inlineFieldsPlugin.js";
import type { Root, ListItem } from "mdast";

describe("inlineFieldsPlugin", () => {
  function extractInlineFields(markdown: string) {
    const processor = unified().use(remarkParse).use(inlineFields);
    const tree = processor.parse(markdown) as Root;
    processor.runSync(tree);
    // Collect all listItems and their inlineFields
    const items: Array<{ text: string; fields: Record<string, string> }> = [];
    function visitListItems(node: any) {
      if (node.type === "listItem") {
        const text = node.children
          .flatMap((c: any) =>
            c.type === "paragraph"
              ? c.children
                  .filter((n: any) => n.type === "text")
                  .map((n: any) => n.value)
              : [],
          )
          .join(" ");
        items.push({
          text,
          fields: node.data?.inlineFields || {},
        });
      }
      if (node.children) node.children.forEach(visitListItems);
    }
    visitListItems(tree);
    return items;
  }

  it("extracts inline fields from all text nodes in list items", () => {
    const md = `
- [ ] Task one due:2026-05-03 repeat:mwf
- [x] Task two start:2026-01-01 snooze:2026-02-01
- [ ] Multi para:\n  More text due:today\n  Even more snooze:tomorrow
`;
    const result = extractInlineFields(md);
    expect(result).toEqual([
      {
        text: "[ ] Task one",
        fields: { due: "2026-05-03", repeat: "mwf" },
      },
      {
        text: "[x] Task two",
        fields: { start: "2026-01-01", snooze: "2026-02-01" },
      },
      {
        text: "[ ] Multi para:\nMore text\nEven more",
        fields: { due: "today", snooze: "tomorrow" },
      },
    ]);
  });

  it("handles list items with no inline fields", () => {
    const md = `- [ ] No fields here`;
    const result = extractInlineFields(md);
    expect(result).toEqual([
      {
        text: "[ ] No fields here",
        fields: {},
      },
    ]);
  });
});
