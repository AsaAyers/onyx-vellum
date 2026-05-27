import type { Root, Text } from "mdast";
import { visitParents, SKIP } from "unist-util-visit-parents";
import { makePlugin } from "../rules/makePlugin.js";
import type {
  EmbedNode,
  CalloutNode,
  TagNode,
  RawAsteriskNode,
} from "./types.js";

export const remarkObsidianPlugin = makePlugin(
  "obsidianProtections",
  ({ tree }) => {
    protectEmbeds(tree);
    protectObsidianCallouts(tree);
    protectTags(tree);
    protectInertAsterisks(tree);
  },
); /**
 * Walk the AST and replace text nodes containing embed wikilinks with a mix of
 * `text` and `obsidianEmbed` nodes so the stringify step emits them verbatim.
 *
 * Mutates `tree` in place — call just before stringification.
 */

function protectEmbeds(tree: Root): void {
  visitParents(tree, "text", (node: Text, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    if (!parent) return;
    if (!node.value.includes("![")) return;
    const parts = splitEmbedText(node.value);
    if (parts.length === 1 && parts[0].type === "text") return;
    const index = [...parent.children].indexOf(node);
    parent.children.splice(index, 1, ...parts);
    return [SKIP, index + parts.length];
  });
}

const EMBED_RE = /(!\[\[(?:[^\][]|\][^\]])*\]\])/g;

function splitEmbedText(value: string): Array<Text | EmbedNode> {
  const parts: Array<Text | EmbedNode> = [];
  let lastIndex = 0;
  EMBED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMBED_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        value: value.slice(lastIndex, match.index),
      } as Text);
    }
    const [target, alias] = match[1].slice(3, -2).trim().split("|");
    parts.push({
      type: "obsidianEmbed",
      value: match[1],
      target,
      alias,
    } satisfies EmbedNode);
    lastIndex = match.index + match[1].length;
  }
  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) } as Text);
  }
  return parts;
}

const CALLOUT_REGEX = /^\[\!(\w+)\]\+?/g;
function protectObsidianCallouts(tree: Root): void {
  visitParents(tree, "text", (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    const grandparent = ancestors[ancestors.length - 2];
    if (parent.type === "paragraph" && grandparent.type === "blockquote") {
      const match = node.value.match(CALLOUT_REGEX);
      if (match) {
        const index = [...parent.children].indexOf(node);
        const calloutType = match[1];
        const calloutNode: CalloutNode = {
          type: "callout",
          value: node.value,
          data: { calloutType },
        };
        parent.children[index] = calloutNode;
      }
    }
  });
}

/**
 * Matches a hashtag: `#` immediately followed by a letter or
 * underscore (preventing pure-number tags which are disallowed), then
 * any run of word characters, hyphens, or forward slashes.
 * Supports Unicode letters via the `u` flag and `\p{L}` property.
 */
const TAG_RE = /#[\p{L}_][\p{L}\p{N}_\-/]*/gu;

function splitTagText(value: string): Array<Text | TagNode> {
  const parts: Array<Text | TagNode> = [];
  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        value: value.slice(lastIndex, match.index),
      } as Text);
    }
    parts.push({ type: "obsidianTag", value: match[0] } as TagNode);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) } as Text);
  }
  return parts;
}

/**
 * Walk the AST and replace text nodes containing hashtags with a mix
 * of `text` and `obsidianTag` nodes so the stringify step emits them verbatim.
 *
 * Mutates `tree` in place — call just before stringification.
 */
function protectTags(tree: Root): void {
  visitParents(tree, "text", (node: Text, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    if (!parent) return;
    if (!node.value.includes("#")) return;
    const parts = splitTagText(node.value);
    if (parts.length === 0 || (parts.length === 1 && parts[0].type === "text"))
      return;

    const index = [...parent.children].indexOf(node);
    parent.children.splice(index, 1, ...parts);
    return [SKIP, index + parts.length];
  });
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
  visitParents(tree, "text", (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    if (!parent) return;
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
        parts.push({ type: "rawAsterisk", value: "*" } as RawAsteriskNode);
        lastIdx = i + 1;
      }
    }
    if (lastIdx < node.value.length) {
      parts.push({ type: "text", value: node.value.slice(lastIdx) } as Text);
    }
    if (parts.length <= 1) return;

    const index = [...parent.children].indexOf(node);
    parent.children.splice(index, 1, ...parts);
    return [SKIP, index + parts.length];
  });
}
