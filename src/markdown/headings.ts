import { parseMarkdown } from "./parse.js";
import { EMPTY_CONFIG } from "./defaultConfig.js";

import type { Config } from "../config.js";
type Root = ReturnType<typeof parseMarkdown>;
type RootContent = Root["children"][number];
type Heading = Extract<RootContent, { type: "heading" }>;
type Paragraph = Extract<RootContent, { type: "paragraph" }>;
type Text = Extract<Heading["children"][number], { type: "text" }>;

export function getHeadingText(node: Heading): string {
  return node.children
    .map((child) => (child.type === "text" ? (child as Text).value : ""))
    .join("");
}

export function appendUnderHeading(
  tree: Root,
  headingText: string,
  linesToAppend: string[],
): void {
  // Find the target heading index
  let headingIdx = -1;
  let headingLevel = 2;
  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i];
    if (node.type === "heading") {
      const h = node as Heading;
      if (getHeadingText(h) === headingText) {
        headingIdx = i;
        headingLevel = h.depth;
        break;
      }
    }
  }

  // If heading not found, create it at end
  if (headingIdx === -1) {
    const headingNode: Heading = {
      type: "heading",
      depth: 2,
      children: [{ type: "text", value: headingText } as Text],
    };
    tree.children.push(headingNode);
    headingIdx = tree.children.length - 1;
    headingLevel = 2;
  }

  // Find the end of the heading's block (nodes until next heading of same/higher level or end)
  let blockEnd = tree.children.length;
  for (let i = headingIdx + 1; i < tree.children.length; i++) {
    const node = tree.children[i];
    if (node.type === "heading" && (node as Heading).depth <= headingLevel) {
      blockEnd = i;
      break;
    }
  }

  // Trim trailing blank/empty paragraphs from the block
  while (blockEnd > headingIdx + 1) {
    const candidate = tree.children[blockEnd - 1];
    if (isEmptyNode(candidate)) {
      blockEnd--;
    } else {
      break;
    }
  }

  // Parse and collect nodes to append - parse together so consecutive list items merge into one list
  const combined = linesToAppend.join("\n");
  // For utility usage, default to cwd and empty config
  const vaultPath = process.cwd();
  const config: Config = EMPTY_CONFIG;
  const parsed = parseMarkdown(combined, vaultPath, config);
  const newNodes: RootContent[] = [...parsed.children];

  // Insert new nodes at blockEnd position
  tree.children.splice(blockEnd, 0, ...newNodes);
}

function isEmptyNode(node: RootContent): boolean {
  if (node.type === "paragraph") {
    const para = node as Paragraph;
    if (para.children.length === 0) return true;
    if (
      para.children.length === 1 &&
      para.children[0].type === "text" &&
      (para.children[0] as Text).value.trim() === ""
    ) {
      return true;
    }
  }
  return false;
}
