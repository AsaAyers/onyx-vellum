import type { LinkQuery } from "../rules/types.js";

/** A single link or embed found in the document body. */
export type MarkdownLink = {
  type?: "deprecatedMarkdownLink";
  /** Raw source string as it appears in the document, e.g. `![[foo.m4a]]`. */
  raw: string;
  /** The link target / path, e.g. `foo.m4a` or `audio/rec.m4a`. */
  target: string;
  /** True when the link uses the embed syntax (`![[...]]` or `![...](...)`). */
  embed: boolean;
  /** True when the link uses Obsidian wikilink syntax (`[[...]]`). */
  wikilink: boolean;
  /** Zero-based index of the line where this link starts. */
  lineIndex: number;
};

/** Describes the planned insertion of a transcript embed below an audio embed. */
export type TranscriptLinkPlan = {
  audioLink: MarkdownLink;
  transcriptTarget: string;
  transcriptEmbed: string;
};

// Matches ![[target]] (embed wikilink) — target must not contain | # ^
const WIKILINK_EMBED_RE = /!\[\[([^\]|#^]+?)\]\]/g;

// Matches ![alt](target) (standard markdown image/audio embed)
const MD_EMBED_RE = /!\[([^\]]*?)\]\(([^)]+?)\)/g;

function parseFenceMarker(
  line: string,
): { char: "`" | "~"; length: number } | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return undefined;
  const marker = match[1]!;
  const firstChar = marker[0];
  if (firstChar !== "`" && firstChar !== "~") return undefined;
  return { char: firstChar, length: marker.length };
}

function closesFence(
  line: string,
  fence: { char: "`" | "~"; length: number },
): boolean {
  const trimmed = line.trimStart();
  let markerLength = 0;
  while (trimmed[markerLength] === fence.char) {
    markerLength++;
  }
  return markerLength >= fence.length;
}

/**
 * Scans `body` line-by-line and returns every wikilink embed and standard
 * markdown embed found, in document order.
 */
export function extractMarkdownLinks(body: string): MarkdownLink[] {
  const lines = body.split("\n");
  const results: MarkdownLink[] = [];
  let activeFence: { char: "`" | "~"; length: number } | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (activeFence) {
      if (closesFence(line, activeFence)) {
        activeFence = undefined;
      }
      continue;
    }

    const fence = parseFenceMarker(line);
    if (fence) {
      activeFence = fence;
      continue;
    }

    // Reset lastIndex before each use since we reuse the regex instances.
    WIKILINK_EMBED_RE.lastIndex = 0;
    MD_EMBED_RE.lastIndex = 0;

    // Collect matches with their column position so we can merge in order.
    const lineMatches: Array<{ colIndex: number; link: MarkdownLink }> = [];

    let match: RegExpExecArray | null;

    while ((match = WIKILINK_EMBED_RE.exec(line)) !== null) {
      lineMatches.push({
        colIndex: match.index,
        link: {
          raw: match[0],
          target: match[1]!.trim(),
          embed: true,
          wikilink: true,
          lineIndex,
        },
      });
    }

    while ((match = MD_EMBED_RE.exec(line)) !== null) {
      lineMatches.push({
        colIndex: match.index,
        link: {
          raw: match[0],
          target: match[2]!,
          embed: true,
          wikilink: false,
          lineIndex,
        },
      });
    }

    lineMatches.sort((a, b) => a.colIndex - b.colIndex);
    for (const { link } of lineMatches) {
      results.push(link);
    }
  }

  return results;
}

/**
 * Returns `true` when the given `MarkdownLink` satisfies all non-undefined
 * fields of `query`.
 */
export function matchesLinkQuery(
  link: MarkdownLink,
  query: LinkQuery,
): boolean {
  if (query.embed !== undefined && link.embed !== query.embed) return false;
  if (query.extension !== undefined && !link.target.endsWith(query.extension))
    return false;
  return true;
}

/**
 * Strips the audio file extension and appends `.transcript.md`.
 *
 * @example
 * deriveTranscriptTarget("recordings/2024-01-15.m4a")
 * // → "recordings/2024-01-15.transcript.md"
 */
export function deriveTranscriptTarget(audioTarget: string): string {
  const dotIndex = audioTarget.lastIndexOf(".");
  const base = dotIndex >= 0 ? audioTarget.slice(0, dotIndex) : audioTarget;
  return `${base}.transcript.md`;
}

/**
 * Returns `true` if `rawEmbed` appears verbatim anywhere in `body`.
 * Used to avoid inserting a duplicate embed.
 */
export function hasEmbedAnywhere(body: string, rawEmbed: string): boolean {
  return body.includes(rawEmbed);
}

/**
 * Inserts `rawEmbed` as a new line immediately after line `lineIndex`
 * (zero-based). Uses line-oriented string manipulation — no AST involved.
 */
export function insertEmbedBelowLine(
  body: string,
  lineIndex: number,
  rawEmbed: string,
): string {
  const lines = body.split("\n");
  lines.splice(lineIndex + 1, 0, rawEmbed);
  return lines.join("\n");
}
