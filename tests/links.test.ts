/**
 * Unit tests for src/markdown/links.ts
 *
 * These tests cover behaviour not exercised by the E2E vault:
 *   - extractMarkdownLinks (no link-extraction rule exists in the vault)
 *   - matchesLinkQuery
 *   - deriveTranscriptTarget
 *   - buildMirroredTranscriptEmbed
 *   - hasEmbedAnywhere
 *   - insertEmbedBelowLine
 */
import { describe, it, expect } from "vitest";
import {
  extractMarkdownLinks,
  matchesLinkQuery,
  deriveTranscriptTarget,
  hasEmbedAnywhere,
  insertEmbedBelowLine,
} from "../src/markdown/links.js";
import type { LinkQuery } from "../src/rules/types.js";

// ---------------------------------------------------------------------------
// extractMarkdownLinks
// ---------------------------------------------------------------------------

describe("extractMarkdownLinks", () => {
  it("returns empty array for body with no links", () => {
    expect(extractMarkdownLinks("# Heading\n\nSome text.")).toEqual([]);
  });

  it("extracts a wikilink embed", () => {
    const links = extractMarkdownLinks("![[audio/rec.m4a]]");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      raw: "![[audio/rec.m4a]]",
      target: "audio/rec.m4a",
      embed: true,
      wikilink: true,
      lineIndex: 0,
    });
  });

  it("extracts a standard markdown embed with no alt", () => {
    const links = extractMarkdownLinks("![](rec.m4a)");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      raw: "![](rec.m4a)",
      target: "rec.m4a",
      embed: true,
      wikilink: false,
      lineIndex: 0,
    });
  });

  it("extracts a standard markdown embed with alt text", () => {
    const links = extractMarkdownLinks("![My recording](rec.m4a)");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      raw: "![My recording](rec.m4a)",
      target: "rec.m4a",
      embed: true,
      wikilink: false,
      lineIndex: 0,
    });
  });

  it("extracts multiple embeds across lines with correct lineIndex", () => {
    const body = [
      "# Notes",
      "",
      "![[audio/a.m4a]]",
      "Some text",
      "![](audio/b.m4a)",
    ].join("\n");
    const links = extractMarkdownLinks(body);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ target: "audio/a.m4a", lineIndex: 2 });
    expect(links[1]).toMatchObject({ target: "audio/b.m4a", lineIndex: 4 });
  });

  it("extracts multiple embeds on the same line in document order", () => {
    const body = "![[a.m4a]] ![](b.m4a)";
    const links = extractMarkdownLinks(body);
    expect(links).toHaveLength(2);
    expect(links[0]?.target).toBe("a.m4a");
    expect(links[1]?.target).toBe("b.m4a");
  });

  it("ignores embeds inside fenced code blocks", () => {
    const body = [
      "```md",
      "![[audio/inside.m4a]]",
      "![](audio/inside-too.m4a)",
      "```",
      "",
      "![[audio/outside.m4a]]",
    ].join("\n");
    const links = extractMarkdownLinks(body);
    expect(links).toHaveLength(1);
    expect(links[0]?.target).toBe("audio/outside.m4a");
  });

  it("extracts mixed wikilink and markdown embeds from the same file", () => {
    const body = ["![[audio/a.m4a]]", "![clip](audio/b.m4a)"].join("\n");
    const links = extractMarkdownLinks(body);
    expect(links.map((link) => link.target)).toEqual([
      "audio/a.m4a",
      "audio/b.m4a",
    ]);
  });

  it("does not match wikilinks with aliases (|) or heading refs (#)", () => {
    const links = extractMarkdownLinks("![[foo|alias]] ![[foo#section]]");
    expect(links).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// matchesLinkQuery
// ---------------------------------------------------------------------------

describe("matchesLinkQuery", () => {
  const audioEmbed: ReturnType<typeof extractMarkdownLinks>[number] = {
    raw: "![[rec.m4a]]",
    target: "rec.m4a",
    embed: true,
    wikilink: true,
    lineIndex: 0,
  };

  it("matches when query has no filters", () => {
    const q: LinkQuery = { type: "link" };
    expect(matchesLinkQuery(audioEmbed, q)).toBe(true);
  });

  it("matches when embed filter matches", () => {
    const q: LinkQuery = { type: "link", embed: true };
    expect(matchesLinkQuery(audioEmbed, q)).toBe(true);
  });

  it("does not match when embed filter is false but link is an embed", () => {
    const q: LinkQuery = { type: "link", embed: false };
    expect(matchesLinkQuery(audioEmbed, q)).toBe(false);
  });

  it("matches when extension filter matches", () => {
    const q: LinkQuery = { type: "link", extension: ".m4a" };
    expect(matchesLinkQuery(audioEmbed, q)).toBe(true);
  });

  it("does not match when extension filter does not match", () => {
    const q: LinkQuery = { type: "link", extension: ".mp3" };
    expect(matchesLinkQuery(audioEmbed, q)).toBe(false);
  });

  it("treats extension matching as exact and case-sensitive", () => {
    const q: LinkQuery = { type: "link", extension: ".m4a" };
    expect(matchesLinkQuery({ ...audioEmbed, target: "REC.M4A" }, q)).toBe(
      false,
    );
  });

  it("matches when both embed and extension filters match", () => {
    const q: LinkQuery = { type: "link", embed: true, extension: ".m4a" };
    expect(matchesLinkQuery(audioEmbed, q)).toBe(true);
  });

  it("does not match when extension matches but embed filter does not", () => {
    const q: LinkQuery = { type: "link", embed: false, extension: ".m4a" };
    expect(matchesLinkQuery(audioEmbed, q)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveTranscriptTarget
// ---------------------------------------------------------------------------

describe("deriveTranscriptTarget", () => {
  it("converts a simple filename", () => {
    expect(deriveTranscriptTarget("note.m4a")).toBe("note.transcript.md");
  });

  it("preserves directory path", () => {
    expect(deriveTranscriptTarget("recordings/2024-01-15.m4a")).toBe(
      "recordings/2024-01-15.transcript.md",
    );
  });

  it("preserves spaces in the source path", () => {
    expect(deriveTranscriptTarget("recordings/2024-01-15 12.34.56.m4a")).toBe(
      "recordings/2024-01-15 12.34.56.transcript.md",
    );
  });

  it("handles filename with no extension", () => {
    expect(deriveTranscriptTarget("noext")).toBe("noext.transcript.md");
  });

  it("handles filename with multiple dots (replaces last extension only)", () => {
    expect(deriveTranscriptTarget("a.b.m4a")).toBe("a.b.transcript.md");
  });
});

// ---------------------------------------------------------------------------
// hasEmbedAnywhere
// ---------------------------------------------------------------------------

describe("hasEmbedAnywhere", () => {
  it("returns true when embed is present in body", () => {
    expect(hasEmbedAnywhere("some text\n![[t.md]]\nmore", "![[t.md]]")).toBe(
      true,
    );
  });

  it("returns false when embed is not present in body", () => {
    expect(hasEmbedAnywhere("some text", "![[t.md]]")).toBe(false);
  });

  it("does not treat a longer embed target as a match", () => {
    expect(hasEmbedAnywhere("![[t.mdx]]", "![[t.md]]")).toBe(false);
  });

  it("finds an embed in the middle of a line", () => {
    expect(hasEmbedAnywhere("before ![[t.md]] after", "![[t.md]]")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// insertEmbedBelowLine
// ---------------------------------------------------------------------------

describe("insertEmbedBelowLine", () => {
  it("inserts a new line after the given lineIndex", () => {
    const body = "line0\nline1\nline2";
    const result = insertEmbedBelowLine(body, 1, "![[new.md]]");
    expect(result).toBe("line0\nline1\n![[new.md]]\nline2");
  });

  it("inserts after the last line", () => {
    const body = "line0\nline1";
    const result = insertEmbedBelowLine(body, 1, "![[new.md]]");
    expect(result).toBe("line0\nline1\n![[new.md]]");
  });

  it("inserts after line 0", () => {
    const body = "line0\nline1";
    const result = insertEmbedBelowLine(body, 0, "![[new.md]]");
    expect(result).toBe("line0\n![[new.md]]\nline1");
  });
});
