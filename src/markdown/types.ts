import type { Literal } from "mdast";
import type { Options as RemarkStringifyOptions } from "remark-stringify";

export type Handlers = NonNullable<RemarkStringifyOptions["handlers"]>;
// ---------------------------------------------------------------------------
// Obsidian embed wikilink support
// ---------------------------------------------------------------------------
/**
 * `remark-wiki-link` handles standard Obsidian page links (`[[Page Name]]`)
 * but not embed wikilinks (`![[image.png]]`). We preserve embeds verbatim by
 * splitting text nodes containing embeds into `text` / `obsidianEmbed` nodes
 * just before stringification.
 */
export interface ObsidianEmbedNode extends Literal {
  type: "obsidianEmbed";
  value: string;
}

export interface WikiLinkNode extends Literal {
  type: "wikiLink";
  value: string;
  data?: {
    alias?: string;
  };
}

export interface InlineFieldsNode extends Literal {
  type: "inlineFields";
  data: { inlineFields?: Record<string, string> };
}

declare module "mdast" {
  interface PhrasingContentMap {
    obsidianEmbed: ObsidianEmbedNode;
    obsidianTag: ObsidianTagNode;
    rawAsterisk: RawAsteriskNode;
    wikiLink: WikiLinkNode;
    inlineFields: InlineFieldsNode;
  }

  interface RootContentMap {
    obsidianEmbed: ObsidianEmbedNode;
    obsidianTag: ObsidianTagNode;
    rawAsterisk: RawAsteriskNode;
    wikiLink: WikiLinkNode;
    inlineFields: InlineFieldsNode;
  }
}
// ---------------------------------------------------------------------------
// Obsidian hashtag protection
// ---------------------------------------------------------------------------
/**
 * Obsidian tag syntax: `#tagname` or `#parent/child`.
 * remark-stringify escapes `#` at the start of a line (the CommonMark
 * "atBreak" unsafe rule) because `# text` opens a heading.  However,
 * `#feeling/good` is not a heading — Obsidian tags follow `#` immediately
 * with a non-space character.  We protect them by splitting text nodes that
 * contain `#tags` into alternating `text` / `obsidianTag` nodes before
 * stringification so the raw value is emitted verbatim.
 */

export interface ObsidianTagNode extends Literal {
  type: "obsidianTag";
  value: string;
} // ---------------------------------------------------------------------------
// Inert-asterisk protection
// ---------------------------------------------------------------------------
/**
 * remark-stringify escapes every `*` in phrasing context, even ones that can
 * never form emphasis.  We protect "inert" asterisks — those that cannot be
 * part of a valid emphasis pair — by splitting their text nodes into
 * `text` / `rawAsterisk` nodes before stringification.  The `rawAsterisk`
 * handler emits `*` verbatim, preserving constructs such as Templater's
 * `<%* … %>` and angle-bracket tags like `<* … *>`.
 */

export interface RawAsteriskNode extends Literal {
  type: "rawAsterisk";
  value: "*";
}
