import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { inlineFieldsPlugin } from "../src/markdown/inlineFieldsPlugin.js";
import type { Root } from "mdast";
import type { InlineFieldsNode } from "../src/markdown/types.js";
import { visit } from "unist-util-visit";

describe("inlineFieldsPlugin", () => {
  function extractInlineFields(markdown: string) {
    const processor = unified().use(remarkParse).use(inlineFieldsPlugin);
    const tree = processor.parse(markdown) as Root;
    processor.runSync(tree);

    // Collect all listItems and their inlineFields
    const items: Array<InlineFieldsNode> = [];

    visit(tree, "inlineFields", (node) => {
      items.push(node);
    });

    return items;
  }

  it("extracts inline fields from all text nodes in list items", () => {
    const md = `
- [ ] Task one due:2026-05-03 repeat:mwf
- [x] Task two snooze:2026-02-01
- [ ] Multi para:\n  More text due:today\n  Even more snooze:tomorrow
`;
    const result = extractInlineFields(md);
    expect(result).toEqual([
      {
        type: "inlineFields",
        value: "",
        data: {
          inlineFields: { due: "2026-05-03", repeat: "mwf" },
        },
      },
      {
        type: "inlineFields",
        value: "",
        data: {
          inlineFields: { snooze: "2026-02-01" },
        },
      },
      {
        type: "inlineFields",
        value: "",
        data: {
          inlineFields: { due: "today", snooze: "tomorrow" },
        },
      },
    ]);
  });

  it("handles list items with no inline fields", () => {
    const md = `- [ ] No fields here`;
    const result = extractInlineFields(md);
    expect(result).toEqual([
      {
        type: "inlineFields",
        value: "",
        data: {
          inlineFields: {},
        },
      },
    ]);
  });
});
