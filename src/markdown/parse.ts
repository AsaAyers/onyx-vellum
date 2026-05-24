import { type Processor, unified } from "unified";
import remarkParse from "remark-parse";
import createDebug from "debug";
import remarkGfm from "remark-gfm";
import remarkWikiLink from "remark-wiki-link";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";
import { visitParents, SKIP } from "unist-util-visit-parents";

import {
  inlineFieldsPlugin,
  inlineFieldsNodeHandler,
} from "./inlineFieldsPlugin.js";
import { normalizeTodayPlugin } from "../rules/normalizeTodayPlugin.js";
import { rolloverPlugin } from "../rules/rolloverPlugin.js";
import type { Root, Text, RootContent, Node } from "mdast";
import type {
  ObsidianEmbedNode,
  WikiLinkNode,
  Handlers,
  ObsidianTagNode,
  RawAsteriskNode,
  CalloutNode,
} from "./types.js";
import type { Config } from "../config.js";
import { stampDonePlugin } from "../rules/stampDonePlugin.js";
import { removeEphemeralOverdueTasksPlugin } from "../rules/removeEphemeralOverdueTasksPlugin.js";
import { sortTasksSpecPlugin } from "../rules/sortTasksSpecPlugin.js";
import { moveDoneTasksPlugin } from "../rules/moveDoneTasksPlugin.js";
import { ensureAudioTranscriptsPlugin } from "../rules/ensureAudioTranscriptsPlugin.js";
import type { Job } from "../transcription/types.js";
import { makePlugin } from "../rules/makePlugin.js";
import { incompleteTaskAlertPlugin } from "../rules/incompleteTaskAlertPlugin.js";
import type { VaultFile } from "../engine/io.js";
import type { UserNoon } from "../engine/timezone.js";

const debug = createDebug("onyx:markdown:parse");

const remarkObsidianProtections = makePlugin(
  "obsidianProtections",
  ({ tree }) => {
    protectObsidianEmbeds(tree);
    protectObsidianCallouts(tree);
    protectObsidianTags(tree);
    protectInertAsterisks(tree);
  },
);

export type FileOperation = {
  position: "start" | "end";
  header: null | string;
  frontmatter?: {
    jobId: string;
    status: string;
  };
  content?: string | RootContent;
};

export type PluginContext = {
  updateFile(file: VaultFile, arg1: FileOperation): unknown;
  queueJob: (job: Job) => Promise<void>;
  jobIdFactory: (createdAt: Date) => string;
  env: NodeJS.ProcessEnv;
  mode: "normalize" | "all" | "fast" | "alert";
  onlyGlob?: string[];
  dates: UserNoon;
  dryRun: boolean;
  vaultPath: string;
};

type MarkdownProcessor<
  CompileTree extends Node | undefined = undefined,
  Result extends string | undefined = undefined,
> = Processor<Root, Root, Root, CompileTree, Result>;
export const createParseProcessor = (
  config: Config,
  ctx: PluginContext,
): MarkdownProcessor<Root, string> => {
  debug("Creating markdown processor with ruleContext:", ctx);
  let processor: MarkdownProcessor = unified()
    .data({
      settings: {
        onyxVellum: {
          config,
          ctx,
        },
      },
    })
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter)
    .use(remarkWikiLink)
    .use(remarkObsidianProtections);

  if (ctx.mode === "normalize") {
    debug("Creating processor in normalize mode");
    processor = processor.use(sortTasksSpecPlugin);
  } else {
    processor = processor
      .use(inlineFieldsPlugin)
      .use(normalizeTodayPlugin)
      .use(ensureAudioTranscriptsPlugin);
  }

  if (ctx.mode === "all") {
    debug("Creating processor");
    processor = processor
      .use(stampDonePlugin)
      .use(rolloverPlugin)
      .use(removeEphemeralOverdueTasksPlugin)
      .use(moveDoneTasksPlugin)
      .use(sortTasksSpecPlugin);
  } else if (ctx.mode === "alert") {
    debug("Creating processor in alert mode");
    processor = processor
      .use(incompleteTaskAlertPlugin)
      .use(sortTasksSpecPlugin);
  }

  return processor.use(remarkStringify, {
    bullet: "*",
    listItemIndent: "one",
    rule: "-",
    handlers: customHandlers,
  });
};
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
    const [target, alias] = match[1].slice(3, -2).trim().split("|");
    parts.push({
      type: "obsidianEmbed",
      value: match[1],
      target,
      alias,
    } satisfies ObsidianEmbedNode);
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
  visitParents(tree, "text", (node: Text, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    if (!parent) return;
    if (!node.value.includes("![[")) return;
    const parts = splitObsidianEmbedText(node.value);
    if (parts.length === 1 && parts[0].type === "text") return;
    const index = [...parent.children].indexOf(node);
    parent.children.splice(index, 1, ...parts);
    return [SKIP, index + parts.length];
  });
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
  visitParents(tree, "text", (node: Text, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    if (!parent) return;
    if (!node.value.includes("#")) return;
    const parts = splitObsidianTagText(node.value);
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

function rawHandler<T extends { value: string }>(node: T): string {
  return node.value;
}

/** Emit custom nodes verbatim, without any escaping. */
const customHandlers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wikiLink: (node: any) => {
    const wiki = node as WikiLinkNode;
    const alias = wiki.data?.alias;
    if (alias && alias !== wiki.value) return `[[${wiki.value}|${alias}]]`;
    return `[[${wiki.value}]]`;
  },

  callout: rawHandler,
  obsidianEmbed: (node) =>
    `![[${(node as ObsidianEmbedNode).target}${
      (node as ObsidianEmbedNode).alias
        ? `|${(node as ObsidianEmbedNode).alias}`
        : ""
    }]]`,
  rawAsterisk: () => "*",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obsidianTag: (node: any) => (node as ObsidianTagNode).value,
  link: linkHandler,
  image: imageHandler,
  inlineFields: inlineFieldsNodeHandler,
} as Partial<Handlers>;
