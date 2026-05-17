import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkWikiLink from "remark-wiki-link";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify, {
  type Options as RemarkStringifyOptions,
} from "remark-stringify";
import matter from "gray-matter";
import { visit, SKIP } from "unist-util-visit";
import { type Root } from "mdast";

type Text = { type: "text"; value: string };
type Parent = { children: unknown[] };
const createParseProcessor = () =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter)
    .use(remarkWikiLink)
    .use(remarkStringify, {
      bullet: "*",
      listItemIndent: "one",
      rule: "-",
      handlers: customHandlers,
    });
type Handlers = NonNullable<RemarkStringifyOptions["handlers"]>;
// ---------------------------------------------------------------------------
// Obsidian embed wikilink support
// ---------------------------------------------------------------------------

/**
 * `remark-wiki-link` handles standard Obsidian page links (`[[Page Name]]`)
 * but not embed wikilinks (`![[image.png]]`). We preserve embeds verbatim by
 * splitting text nodes containing embeds into `text` / `obsidianEmbed` nodes
 * just before stringification.
 */
interface ObsidianEmbedNode {
  type: "obsidianEmbed";
  value: string;
}

export interface WikiLinkNode {
  type: "wikiLink";
  value: string;
  data?: {
    alias?: string;
  };
}

const OBSIDIAN_EMBED_RE = /(!\[\[(?:[^\][]|\][^\]])*\]\])/g;

function splitObsidianEmbedText(
  value: string,
): Array<Text | ObsidianEmbedNode> {
  const parts: Array<Text | ObsidianEmbedNode> = [];
  let lastIndex = 0;
  OBSIDIAN_EMBED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OBSIDIAN_EMBED_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        value: value.slice(lastIndex, match.index),
      } as Text);
    }
    parts.push({ type: "obsidianEmbed", value: match[1] } as ObsidianEmbedNode);
    lastIndex = match.index + match[1].length;
  }
  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) } as Text);
  }
  return parts;
}

/**
 * Walk the AST and replace text nodes containing Obsidian embeds with a mix of
 * `text` and `obsidianEmbed` nodes so the stringify step emits them verbatim.
 *
 * Mutates `tree` in place — call just before stringification.
 */
function protectObsidianEmbeds(tree: Root): void {
  visit(
    tree,
    "text",
    (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      if (!node.value.includes("![[")) return;
      const parts = splitObsidianEmbedText(node.value);
      if (parts.length === 1 && parts[0].type === "text") return;
      (parent.children as Array<Text | ObsidianEmbedNode>).splice(
        index,
        1,
        ...parts,
      );
      return [SKIP, index + parts.length];
    },
  );
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
interface ObsidianTagNode {
  type: "obsidianTag";
  value: string;
}

/**
 * Matches an Obsidian hashtag: `#` immediately followed by a letter or
 * underscore (preventing pure-number tags which Obsidian disallows), then
 * any run of word characters, hyphens, or forward slashes.
 * Supports Unicode letters via the `u` flag and `\p{L}` property.
 */
const OBSIDIAN_TAG_RE = /#[\p{L}_][\p{L}\p{N}_\-/]*/gu;

function splitObsidianTagText(value: string): Array<Text | ObsidianTagNode> {
  const parts: Array<Text | ObsidianTagNode> = [];
  let lastIndex = 0;
  OBSIDIAN_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OBSIDIAN_TAG_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        value: value.slice(lastIndex, match.index),
      } as Text);
    }
    parts.push({ type: "obsidianTag", value: match[0] } as ObsidianTagNode);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) } as Text);
  }
  return parts;
}

/**
 * Walk the AST and replace text nodes containing Obsidian hashtags with a mix
 * of `text` and `obsidianTag` nodes so the stringify step emits them verbatim.
 *
 * Mutates `tree` in place — call just before stringification.
 */
function protectObsidianTags(tree: Root): void {
  visit(
    tree,
    "text",
    (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      if (!node.value.includes("#")) return;
      const parts = splitObsidianTagText(node.value);
      if (
        parts.length === 0 ||
        (parts.length === 1 && parts[0].type === "text")
      )
        return;
      (parent.children as Array<Text | ObsidianTagNode>).splice(
        index,
        1,
        ...parts,
      );
      return [SKIP, index + parts.length];
    },
  );
}

// ---------------------------------------------------------------------------
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
interface RawAsteriskNode {
  type: "rawAsterisk";
}

// ASCII punctuation characters used by the CommonMark flanking-delimiter rules.
const ASCII_PUNCT_RE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

/**
 * Compute the left- and right-flanking status of a single `*` delimiter
 * given the characters immediately before and after it.
 * Pass an empty string for `prev`/`next` to represent start/end of value.
 */
function asteriskFlanking(
  prev: string,
  next: string,
): { left: boolean; right: boolean } {
  const prevIsWs = prev === "" || /\s/.test(prev);
  const nextIsWs = next === "" || /\s/.test(next);
  const prevIsPunct = prev !== "" && ASCII_PUNCT_RE.test(prev);
  const nextIsPunct = next !== "" && ASCII_PUNCT_RE.test(next);

  // CommonMark spec §6.2 (emphasis):
  //   Left-flanking:  not followed by whitespace  AND
  //                   (not followed by punctuation  OR  preceded by ws/punct)
  //   Right-flanking: not preceded by whitespace  AND
  //                   (not preceded by punctuation OR  followed by ws/punct)
  const left = !nextIsWs && (!nextIsPunct || prevIsWs || prevIsPunct);
  const right = !prevIsWs && (!prevIsPunct || nextIsWs || nextIsPunct);
  return { left, right };
}

/**
 * Returns the set of positions within `value` where `*` is "inert" — i.e. it
 * cannot be part of an emphasis pair and may be emitted verbatim.
 *
 * Start and end of the string are treated as whitespace for boundary analysis.
 * Asterisks at potential line-break positions (position 0 or after `\n`) that
 * are followed by a space/tab/newline/`*` are excluded: the `atBreak` unsafe
 * rule in remark-stringify must keep those escaped to prevent accidental list
 * items from being created.
 */
function inertAsteriskPositions(value: string): Set<number> {
  interface AsteriskInfo {
    pos: number;
    left: boolean;
    right: boolean;
  }
  const asts: AsteriskInfo[] = [];

  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "*") continue;

    const prev = i > 0 ? value[i - 1] : "";
    const next = i < value.length - 1 ? value[i + 1] : "";

    // Exclude * at line-break boundaries that match the atBreak unsafe rule.
    if (
      (i === 0 || prev === "\n") &&
      /[ \t\r\n*]/.test(next === "" ? " " : next)
    ) {
      continue;
    }

    const { left, right } = asteriskFlanking(prev, next);
    asts.push({ pos: i, left, right });
  }

  // Greedily pair the first left-flanking opener with the nearest subsequent
  // right-flanking closer.  Unpaired * are inert.
  const paired = new Set<number>();
  for (let i = 0; i < asts.length; i++) {
    if (!asts[i].left || paired.has(asts[i].pos)) continue;
    for (let j = i + 1; j < asts.length; j++) {
      if (!asts[j].right || paired.has(asts[j].pos)) continue;
      paired.add(asts[i].pos);
      paired.add(asts[j].pos);
      break;
    }
  }

  const inert = new Set<number>();
  for (const a of asts) {
    if (!paired.has(a.pos)) inert.add(a.pos);
  }
  return inert;
}

/**
 * Walk the AST and split text nodes that contain inert `*` characters into
 * alternating `text` / `rawAsterisk` nodes so the stringify step emits the
 * asterisks verbatim without backslash-escaping.
 *
 * Mutates `tree` in place — call just before stringification.
 */
function protectInertAsterisks(tree: Root): void {
  visit(
    tree,
    "text",
    (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      if (!node.value.includes("*")) return;

      const inert = inertAsteriskPositions(node.value);
      if (inert.size === 0) return;

      const parts: Array<Text | RawAsteriskNode> = [];
      let lastIdx = 0;
      for (let i = 0; i < node.value.length; i++) {
        if (inert.has(i)) {
          if (i > lastIdx) {
            parts.push({
              type: "text",
              value: node.value.slice(lastIdx, i),
            } as Text);
          }
          parts.push({ type: "rawAsterisk" } as RawAsteriskNode);
          lastIdx = i + 1;
        }
      }
      if (lastIdx < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(lastIdx) } as Text);
      }
      if (parts.length <= 1) return;

      (parent.children as Array<Text | RawAsteriskNode>).splice(
        index,
        1,
        ...parts,
      );
      return [SKIP, index + parts.length];
    },
  );
}

// ---------------------------------------------------------------------------
// Link / image URL protection
// ---------------------------------------------------------------------------

/**
 * The default markdown stringifier unsafe rule
 *   `{ character: '&', after: '[#A-Za-z]', inConstruct: 'phrasing' }`
 * fires even inside `destinationRaw` because the enclosing `phrasing`
 * construct stays on the stack.  Since `&` needs no escaping inside the
 * `(url)` delimiters of a resource link, we override the `link` and `image`
 * handlers to emit `node.url` verbatim instead of going through `state.safe`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function imageHandler(node: any, _: any, state: any, info: any): string {
  const quote: string = state.options.quote || '"';
  const suffix = quote === '"' ? "Quote" : "Apostrophe";
  const exit = state.enter("image");
  let subexit = state.enter("label");
  const tracker = state.createTracker(info);
  let value = tracker.move("![");
  value += tracker.move(
    state.safe(node.alt || "", {
      before: value,
      after: "]",
      ...tracker.current(),
    }),
  );
  value += tracker.move("](");
  subexit();
  if ((!node.url && node.title) || /[\0- \u007F]/.test(node.url || "")) {
    subexit = state.enter("destinationLiteral");
    value += tracker.move("<");
    value += tracker.move(node.url || "");
    value += tracker.move(">");
  } else {
    subexit = state.enter("destinationRaw");
    value += tracker.move(node.url || "");
  }
  subexit();
  if (node.title) {
    subexit = state.enter(`title${suffix}`);
    value += tracker.move(" " + quote);
    value += tracker.move(
      state.safe(node.title, {
        before: value,
        after: quote,
        ...tracker.current(),
      }),
    );
    value += tracker.move(quote);
    subexit();
  }
  value += tracker.move(")");
  exit();
  return value;
}
imageHandler.peek = (): string => "!";

/** Returns true if the link should be serialised as `<url>` (autolink form). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAutolink(node: any, state: any): boolean {
  const child = node.children?.length === 1 ? node.children[0] : null;
  const raw: string = child?.type === "text" ? child.value : "";
  return Boolean(
    !state.options.resourceLink &&
    node.url &&
    !node.title &&
    raw &&
    (raw === node.url || "mailto:" + raw === node.url) &&
    /^[a-z][a-z+.-]+:/i.test(node.url) &&
    !/[\0- <>\u007F]/.test(node.url),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function linkHandler(node: any, _: any, state: any, info: any): string {
  const quote: string = state.options.quote || '"';
  const suffix = quote === '"' ? "Quote" : "Apostrophe";
  const tracker = state.createTracker(info);
  let exit: () => void;
  let subexit: () => void;

  if (isAutolink(node, state)) {
    // Hide the phrasing context so escapes don't apply inside `<url>`.
    const stack = state.stack;
    state.stack = [];
    exit = state.enter("autolink");
    let value = tracker.move("<");
    value += tracker.move(
      state.containerPhrasing(node, {
        before: value,
        after: ">",
        ...tracker.current(),
      }),
    );
    value += tracker.move(">");
    exit();
    state.stack = stack;
    return value;
  }

  exit = state.enter("link");
  subexit = state.enter("label");
  let value = tracker.move("[");
  value += tracker.move(
    state.containerPhrasing(node, {
      before: value,
      after: "](",
      ...tracker.current(),
    }),
  );
  value += tracker.move("](");
  subexit();
  if ((!node.url && node.title) || /[\0- \u007F]/.test(node.url || "")) {
    subexit = state.enter("destinationLiteral");
    value += tracker.move("<");
    value += tracker.move(node.url || "");
    value += tracker.move(">");
  } else {
    subexit = state.enter("destinationRaw");
    value += tracker.move(node.url || "");
  }
  subexit();
  if (node.title) {
    subexit = state.enter(`title${suffix}`);
    value += tracker.move(" " + quote);
    value += tracker.move(
      state.safe(node.title, {
        before: value,
        after: quote,
        ...tracker.current(),
      }),
    );
    value += tracker.move(quote);
    subexit();
  }
  value += tracker.move(")");
  exit();
  return value;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
linkHandler.peek = (node: any, _: any, state: any): string =>
  isAutolink(node, state) ? "<" : "[";

// ---------------------------------------------------------------------------
// Markdown stringifier handlers
// ---------------------------------------------------------------------------

/** Emit custom nodes verbatim, without any escaping. */
const customHandlers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wikiLink: (node: any) => {
    const wiki = node as WikiLinkNode;
    const alias = wiki.data?.alias;
    if (alias && alias !== wiki.value) return `[[${wiki.value}|${alias}]]`;
    return `[[${wiki.value}]]`;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obsidianEmbed: (node: any) => (node as ObsidianEmbedNode).value,
  rawAsterisk: () => "*",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obsidianTag: (node: any) => (node as ObsidianTagNode).value,
  link: linkHandler,
  image: imageHandler,
} as Partial<Handlers>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseMarkdown(content: string): Root {
  const processor = createParseProcessor();
  return processor.parse(content);
}

export function stringifyMarkdown(tree: Root): string {
  const processor = createParseProcessor();
  protectObsidianEmbeds(tree);
  protectObsidianTags(tree);
  protectInertAsterisks(tree);
  return processor.stringify(tree);
}

export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const parsed = matter(raw);
  return {
    data: parsed.data as Record<string, unknown>,
    content: parsed.content,
  };
}

export function stringifyFrontmatter(
  data: Record<string, unknown>,
  content: string,
): string {
  return matter.stringify(content, data);
}
