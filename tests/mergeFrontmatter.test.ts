import { describe, it, expect } from "vitest";
import { mergeFrontmatter, readFrontmatter } from "../src/engine/mergeFrontmatter.js";
import type { Root, RootContent, Yaml } from "mdast";

function root(children: RootContent[]): Root {
  return { type: "root", children };
}

const y = (value: string): Yaml => ({ type: "yaml", value });

describe("readFrontmatter", () => {
  it("returns empty object when no yaml node", () => {
    const tree = root([]);
    expect(readFrontmatter(tree)).toEqual({});
  });

  it("parses yaml frontmatter", () => {
    const tree = root([y("key: val\nnum: 42")]);
    expect(readFrontmatter(tree)).toEqual({ key: "val", num: 42 });
  });

  it("returns empty object on invalid yaml", () => {
    const tree = root([y(": : invalid yaml :")]);
    expect(readFrontmatter(tree)).toEqual({});
  });
});

describe("mergeFrontmatter", () => {
  it("creates yaml node when none exists", () => {
    const tree = root([{ type: "paragraph", children: [{ type: "text", value: "body" }] } as RootContent]);
    mergeFrontmatter(tree, { tags: ["daily"] });
    expect(tree.children[0].type).toBe("yaml");
    expect((tree.children[0] as Yaml).value).toBe("tags:\n  - daily");
  });

  it("merges data into existing yaml", () => {
    const tree = root([y("type: task")]);
    mergeFrontmatter(tree, { tags: ["daily"] });
    expect(tree.children[0].type).toBe("yaml");
    expect((tree.children[0] as Yaml).value).toContain("type: task");
    expect((tree.children[0] as Yaml).value).toContain("daily");
  });

  it("overwrites existing keys", () => {
    const tree = root([y("type: old")]);
    mergeFrontmatter(tree, { type: "new" });
    const parsed = readFrontmatter(tree);
    expect(parsed.type).toBe("new");
  });

  it("does not create a yaml node when merged result is empty (blank frontmatter, no data)", () => {
    const tree = root([y("")]);
    mergeFrontmatter(tree, {});
    // js-yaml dump({}) => "{}" — not empty, so the node stays with "{}"
    const yamlNode = tree.children.find((n) => n.type === "yaml") as Yaml | undefined;
    expect(yamlNode).toBeDefined();
    expect(yamlNode!.value).toBe("{}");
  });

  it("yaml node stays at position 0 after merge", () => {
    const tree = root([p("body")]);
    mergeFrontmatter(tree, { priority: "high" });
    expect(tree.children[0].type).toBe("yaml");
  });

  it("existing yaml node is replaced at position 0", () => {
    const tree = root([y("old: data"), p("body")]);
    mergeFrontmatter(tree, { new: "data" });
    expect(tree.children[0].type).toBe("yaml");
    expect(tree.children[1].type).toBe("paragraph");
    const parsed = readFrontmatter(tree);
    expect(parsed.new).toBe("data");
  });
});

const p = (text: string) => ({
  type: "paragraph" as const,
  children: [{ type: "text" as const, value: text }],
});
