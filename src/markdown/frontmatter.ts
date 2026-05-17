import matter from "gray-matter";
import { parseMarkdown, stringifyMarkdown } from "./parse.js";
import { type Root } from "mdast";

export type SplitFrontmatterResult = {
  data: Record<string, unknown>;
  bodyPrefix: string;
  body: string;
};

interface YamlNode {
  type: "yaml";
  value: string;
}

function extractFrontmatterNode(tree: Root): YamlNode | null {
  const first = tree.children[0] as YamlNode | undefined;
  if (!first || first.type !== "yaml") return null;
  return first;
}

function parseYamlData(value: string): Record<string, unknown> {
  const parsed = matter(`---\n${value}\n---\n`);
  return parsed.data as Record<string, unknown>;
}

function stringifyYamlData(data: Record<string, unknown>): string {
  const serialized = matter.stringify("", data);
  const lines = serialized.replace(/\r\n/g, "\n").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 0) return "";
  return lines.slice(1, end).join("\n");
}

export function splitFrontmatter(raw: string): SplitFrontmatterResult {
  const tree = parseMarkdown(raw);
  const yaml = extractFrontmatterNode(tree);
  if (!yaml) {
    return { data: {}, bodyPrefix: "", body: raw };
  }

  const data = parseYamlData(yaml.value);
  tree.children.shift();
  const body = stringifyMarkdown(tree);

  return { data, bodyPrefix: "", body };
}

export function joinFrontmatter(
  parts: SplitFrontmatterResult,
  body: string,
): string {
  if (Object.keys(parts.data).length === 0) return body;

  const tree = parseMarkdown(body);
  const value = stringifyYamlData(parts.data);
  tree.children.unshift({ type: "yaml", value } as YamlNode);
  return stringifyMarkdown(tree);
}
