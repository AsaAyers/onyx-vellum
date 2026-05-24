import { type Processor, unified } from "unified";
import remarkParse from "remark-parse";
import createDebug from "debug";
import remarkGfm from "remark-gfm";
import remarkWikiLink from "remark-wiki-link";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";

import {
  inlineFieldsPlugin,
  inlineFieldsNodeHandler,
} from "./inlineFieldsPlugin.js";
import { normalizeTodayPlugin } from "../rules/normalizeTodayPlugin.js";
import { rolloverPlugin } from "../rules/rolloverPlugin.js";
import type { Root, Node, Link } from "mdast";
import type {
  ObsidianEmbedNode,
  WikiLinkNode,
  Handle,
  ObsidianTagNode,
} from "./types.js";
import type { Config } from "../config.js";
import { stampDonePlugin } from "../rules/stampDonePlugin.js";
import { removeEphemeralOverdueTasksPlugin } from "../rules/removeEphemeralOverdueTasksPlugin.js";
import { sortTasksSpecPlugin } from "../rules/sortTasksSpecPlugin.js";
import { moveDoneTasksPlugin } from "../rules/moveDoneTasksPlugin.js";
import { ensureAudioTranscriptsPlugin } from "../rules/ensureAudioTranscriptsPlugin.js";
import { incompleteTaskAlertPlugin } from "../rules/incompleteTaskAlertPlugin.js";
import { remarkObsidianPlugin } from "./remarkObsidianPlugin.js";
import type { PluginContext } from "./PluginContext.js";

const debug = createDebug("onyx:markdown:parse");

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
    .use(remarkObsidianPlugin);

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
  const r = Boolean(
    !state.options.resourceLink &&
    node.url &&
    !node.title &&
    Boolean(raw === "" || raw === node.url || "mailto:" + raw === node.url) &&
    Boolean(/^[a-z][a-z+.-]+:/i.test(node.url)) &&
    Boolean(!/[\0- <>\u007F]/.test(node.url)),
  );
  return r;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linkHandler: Handle = function (node: Link, _, state, info): string {
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
};
// @ts-expect-error: `peek` is not declared on `Handle` type, but is used by
// remark-stringify to determine whether to apply unsafe rules.
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
const customHandlers: Record<string, Handle> = {
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
};
