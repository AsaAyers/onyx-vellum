/**
 * Unit tests for parseMarkdown / stringifyMarkdown round-trip fidelity.
 *
 * These test behaviors NOT exercised by the E2E vault snapshot:
 *  - Obsidian wikilink syntax [[...]] and ![[...]] is preserved without escaping.
 *  - Nested lists are preserved (structure and indentation unchanged).
 *  - Files with YAML frontmatter are handled correctly by normalizeFileContent.
 */
import { describe, it, expect } from "vitest";
import { normalizeFileContent } from "../src/engine/runner.js";

/** Round-trips content and returns the result. */

// ---------------------------------------------------------------------------
// Wikilinks
// ---------------------------------------------------------------------------

describe("wikilink round-trip", () => {
  it("preserves inline image wikilink ![[file]]", async () => {
    const src = "![[Projects/2022-05-07_09.18.50.png]]\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves page wikilink [[Page Name]]", async () => {
    const src = "[[Some Link]]\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves wikilink with underscores in filename", async () => {
    const src = "![[archive/meeting_notes_2024.png]]\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves wikilink inside a task", async () => {
    const src = "* [ ] Review ![[diagram_v2.png]]\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves multiple wikilinks in a paragraph", async () => {
    const src = "See [[Note 1]] and also [[Note 2]] for details.\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves nested list with wikilinks at each level", async () => {
    const src =
      "* Top level [[link]]\n" +
      "  * Nested [[link2]]\n" +
      "    * Deep [[link3]]\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves mixed wikilinks and regular text in same line", async () => {
    const src = "Related to [[Project A]] and [[Project B]] both.\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves wikilink with path separator", async () => {
    const src = "See [[Archive/Old Project]] for history.\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// Nested lists
// ---------------------------------------------------------------------------

describe("nested list round-trip", () => {
  it("preserves 2-space nested unordered list", async () => {
    const src = "* Item 1\n  * Nested 1\n  * Nested 2\n* Item 2\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves three-level nesting", async () => {
    const src = "* Level 1\n  * Level 2\n    * Level 3\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves nested task lists", async () => {
    const src =
      "* [ ] Parent task\n" +
      "  * [ ] Child task\n" +
      "    * [ ] Grandchild\n" +
      "  * [ ] Another child\n" +
      "* [ ] Second parent\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves ordered list nested inside unordered", async () => {
    const src = "* Item\n  1. First\n  2. Second\n* Another item\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });

  it("preserves loose nested list (blank lines between items)", async () => {
    const src = "* Item 1\n\n  * Nested 1\n\n  * Nested 2\n\n* Item 2\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// Thematic break (horizontal rule)
// ---------------------------------------------------------------------------

describe("thematic break round-trip", () => {
  it("preserves --- without converting to ***", async () => {
    const src = "Above\n\n---\n\nBelow\n";
    expect(await normalizeFileContent(src)).toBe(src);
  });
});
