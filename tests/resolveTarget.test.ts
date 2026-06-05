import { describe, it, expect } from "vitest";
import { resolveTarget } from "../src/engine/resolveTarget.js";
import type { Root, RootContent, Heading, Paragraph, Yaml } from "mdast";

const h = (depth: 1 | 2 | 3 | 4 | 5 | 6, text: string): Heading => ({
  type: "heading",
  depth,
  children: [{ type: "text", value: text }],
});

const p = (text: string): Paragraph => ({
  type: "paragraph",
  children: [{ type: "text", value: text }],
});

const y = (value: string): Yaml => ({
  type: "yaml",
  value,
});

function root(children: RootContent[]): Root {
  return { type: "root", children };
}

/**
 * Helper: build a stub location (only the fields resolveTarget reads).
 */
const loc = (header: string | null, position: "start" | "end") =>
  ({
    file: undefined as never,
    header,
    position,
  }) as const;

describe("resolveTarget", () => {
  describe("header: null, position: start", () => {
    it("targets body up to first heading, skipping yaml", () => {
      const tree = root([y("key: val"), p("body"), h(1, "Tasks")]);
      const result = resolveTarget(tree, loc(null, "start"));
      expect(result).not.toBeNull();
      expect(result!.startNode).toBe(tree.children[1]);
      expect(result!.deleteCount).toBe(1);
      expect(result!.headerNodes).toEqual([]);
    });

    it("no yaml — targets from first child", () => {
      const tree = root([p("body"), h(1, "Tasks")]);
      const result = resolveTarget(tree, loc(null, "start"));
      expect(result!.startNode).toBe(tree.children[0]);
      expect(result!.deleteCount).toBe(1);
    });

    it("no headings — targets entire body", () => {
      const tree = root([p("a"), p("b")]);
      const result = resolveTarget(tree, loc(null, "start"));
      expect(result!.startNode).toBe(tree.children[0]);
      expect(result!.deleteCount).toBe(2);
    });

    it("only yaml nodes — startNode null, deleteCount 0", () => {
      const tree = root([y("key: val")]);
      const result = resolveTarget(tree, loc(null, "start"));
      expect(result!.startNode).toBeNull();
      expect(result!.deleteCount).toBe(0);
    });

    it("empty tree", () => {
      const tree = root([]);
      const result = resolveTarget(tree, loc(null, "start"));
      expect(result!.startNode).toBeNull();
      expect(result!.deleteCount).toBe(0);
    });
  });

  describe("header: null, position: end", () => {
    it("returns null startNode and 0 deleteCount", () => {
      const tree = root([h(1, "Tasks"), p("body")]);
      const result = resolveTarget(tree, loc(null, "end"));
      expect(result!.startNode).toBeNull();
      expect(result!.deleteCount).toBe(0);
      expect(result!.headerNodes).toEqual([]);
    });
  });

  describe("header not found, position: start", () => {
    it("no existing headings — targets body, provides headerNodes", () => {
      const tree = root([p("body")]);
      const result = resolveTarget(tree, loc("Tasks", "start"));
      expect(result!.startNode).toBe(tree.children[0]);
      expect(result!.deleteCount).toBe(1);
      expect(result!.headerNodes).toHaveLength(1);
      expect((result!.headerNodes[0] as Heading).children[0]).toEqual({
        type: "text",
        value: "Tasks",
      });
    });

    it("with existing headings — insert before first heading", () => {
      const tree = root([h(1, "Existing"), p("body")]);
      const result = resolveTarget(tree, loc("Tasks", "start"));
      expect(result!.startNode).toBe(tree.children[0]);
      expect(result!.deleteCount).toBe(0);
      expect(result!.headerNodes).toHaveLength(1);
    });
  });

  describe("header not found, position: end", () => {
    it("appends at end with headerNodes", () => {
      const tree = root([p("body")]);
      const result = resolveTarget(tree, loc("Tasks", "end"));
      expect(result!.startNode).toBeNull();
      expect(result!.deleteCount).toBe(0);
      expect(result!.headerNodes).toHaveLength(1);
    });
  });

  describe("header found, position: start", () => {
    it("replaces section content after header", () => {
      const tree = root([
        h(1, "Tasks"),
        p("old task 1"),
        p("old task 2"),
        h(1, "Notes"),
      ]);
      const result = resolveTarget(tree, loc("Tasks", "start"));
      expect(result!.startNode).toBe(tree.children[1]);
      expect(result!.deleteCount).toBe(2);
      expect(result!.headerNodes).toEqual([]);
    });

    it("empty section between headings", () => {
      const tree = root([h(1, "Tasks"), h(1, "Notes")]);
      const result = resolveTarget(tree, loc("Tasks", "start"));
      expect(result!.startNode).toBe(tree.children[1]);
      expect(result!.deleteCount).toBe(0);
    });

    it("section at end of file with no following heading", () => {
      const tree = root([h(1, "Tasks"), p("task")]);
      const result = resolveTarget(tree, loc("Tasks", "start"));
      expect(result!.startNode).toBe(tree.children[1]);
      expect(result!.deleteCount).toBe(1);
    });

    it("respects heading depth — includes sub-headings", () => {
      const tree = root([
        h(1, "Tasks"),
        p("task"),
        h(2, "Subtask"),
        p("detail"),
        h(1, "Notes"),
      ]);
      const result = resolveTarget(tree, loc("Tasks", "start"));
      expect(result!.startNode).toBe(tree.children[1]);
      expect(result!.deleteCount).toBe(3);
    });
  });
});
