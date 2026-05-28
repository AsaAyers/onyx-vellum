import yaml from "js-yaml";
import type { Root, RootContent } from "mdast";

/**
 * Read the parsed frontmatter object from the tree, without mutating it.
 */
export function readFrontmatter(tree: Root): Record<string, unknown> {
  const yamlNode = tree.children.find((n) => n.type === "yaml");
  if (!yamlNode || yamlNode.type !== "yaml") return {};
  try {
    return (yaml.load(yamlNode.value) || {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Merge `data` into the tree's YAML frontmatter and splice the result into
 * position 0 of `tree.children`. If the merged result is empty, removes the
 * yaml node entirely.
 */
export function mergeFrontmatter(
  tree: Root,
  data: Record<string, unknown>,
): void {
  const existingIdx = tree.children.findIndex((n) => n.type === "yaml");
  let frontmatter: Record<string, unknown> = {};

  if (existingIdx !== -1) {
    const existing = tree.children[existingIdx];
    if (existing.type === "yaml") {
      try {
        frontmatter = (yaml.load(existing.value) || {}) as Record<
          string,
          unknown
        >;
      } catch {
        // skip invalid frontmatter
      }
    }
  }

  const merged = { ...frontmatter, ...data };
  const dumped = yaml.dump(merged).trimEnd();

  if (existingIdx !== -1) {
    tree.children.splice(existingIdx, 1);
  }

  if (dumped) {
    const newNode: RootContent = {
      type: "yaml",
      value: dumped,
    };
    tree.children.unshift(newNode);
  }
}
