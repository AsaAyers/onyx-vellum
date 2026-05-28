import type { Processor } from "unified";
import type { Root, RootContent } from "mdast";
import { VaultFile } from "./VaultFile.js";
import type { Target } from "./resolveTarget.js";

/**
 * Parse and splice content into the AST at the location described by `target`.
 * Handles both string content (parsed through the processor) and raw
 * RootContent nodes. Prepends `target.headerNodes` if any.
 */
export async function spliceContent(
  target: Target,
  file: VaultFile,
  processor: Processor<Root, Root, Root>,
  content: string | RootContent,
): Promise<void> {
  const startIdx = target.startNode
    ? target.parent.children.indexOf(target.startNode)
    : target.parent.children.length;

  if (startIdx === -1) {
    throw new Error(
      "startNode not found in parent children — tree may have been modified",
    );
  }

  let contentNodes: RootContent[] = [];
  if (typeof content === "string") {
    const f = VaultFile.fromVFile(file);
    f.value = content;
    let parsed = processor.parse(f);
    parsed = (await processor.run(parsed, f)) as Root;
    contentNodes = parsed.children;
  } else {
    contentNodes = [content];
  }

  if (target.headerNodes.length > 0) {
    contentNodes.unshift(...target.headerNodes);
  }

  target.parent.children.splice(startIdx, target.deleteCount, ...contentNodes);
}
