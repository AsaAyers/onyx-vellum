import type { Literal } from "mdast";
import type { Options as RemarkStringifyOptions } from "remark-stringify";
import type { Config } from "../loadConfig.js";
import type { FileOperationExecutor } from "../engine/FileOperationExecutor.js";
import type { UserLocalTime } from "../engine/userLocalTime.js";
import type { Job } from "../transcription/types.js";

// import type { ListItem } from "mdast";

// Augment mdast ListItem data to include inlineFields
// (This is required for type-safe access in plugins)
declare module "mdast" {}

// Augment unified Settings to include onyxVellum config
// (This is required for type-safe config access in plugins)
declare module "unified" {
  interface Processor {
    plugins?: Set<string>;
  }

  interface Settings {
    onyxVellum?: {
      ctx: PluginContext;
      config: Config;
    };
  }
}

export type Handlers = NonNullable<RemarkStringifyOptions["handlers"]>;
export type Handle = Handlers[keyof Handlers];
// ---------------------------------------------------------------------------
// Embed wikilink support
// ---------------------------------------------------------------------------
/**
 * `remark-wiki-link` handles standard page links (`[[Page Name]]`)
 * but not embed wikilinks (`![[image.png]]`). We preserve embeds verbatim by
 * splitting text nodes containing embeds into `text` / `obsidianEmbed` nodes
 * just before stringification.
 */
export interface EmbedNode extends Literal {
  type: "obsidianEmbed";
  value: string;
  target: string;
  alias?: string;
}

export interface WikiLinkNode extends Literal {
  type: "wikiLink";
  value: string;
  data?: {
    alias?: string;
  };
}

export interface CalloutNode extends Literal {
  type: "callout";
  value: string;
  data?: {
    calloutType: string;
    calloutTitle?: string;
  };
}

export interface InlineFieldsNode extends Literal {
  type: "inlineFields";
  data: { inlineFields?: Record<string, string> };
}

declare module "mdast" {
  interface PhrasingContentMap {
    obsidianEmbed: EmbedNode;
    obsidianTag: TagNode;
    rawAsterisk: RawAsteriskNode;
    wikiLink: WikiLinkNode;
    inlineFields: InlineFieldsNode;
    callout: CalloutNode;
  }

  interface DefinitionContentMap {
    callout: CalloutNode;
  }

  interface RootContentMap {
    obsidianEmbed: EmbedNode;
    obsidianTag: TagNode;
    rawAsterisk: RawAsteriskNode;
    wikiLink: WikiLinkNode;
    inlineFields: InlineFieldsNode;
  }
}
// ---------------------------------------------------------------------------
// Hashtag protection
// ---------------------------------------------------------------------------
/**
 * Tag syntax: `#tagname` or `#parent/child`.
 * remark-stringify escapes `#` at the start of a line (the CommonMark
 * "atBreak" unsafe rule) because `# text` opens a heading.  However,
 * `#feeling/good` is not a heading — tags follow `#` immediately
 * with a non-space character.  We protect them by splitting text nodes that
 * contain `#tags` into alternating `text` / `obsidianTag` nodes before
 * stringification so the raw value is emitted verbatim.
 */

export interface TagNode extends Literal {
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
export type PluginContext = {
  updateFile: FileOperationExecutor["updateFile"];
  queueJob: (job: Job) => void;
  jobIdFactory: (createdAt: Date) => string;
  env: NodeJS.ProcessEnv;
  mode: "normalize" | "all" | "fast" | "alert";
  onlyGlob?: string[];
  dates: UserLocalTime;
  dryRun: boolean;
  vaultPath: string;
  verbose?: boolean;
  report?: (msg: string) => void;
  fileAlerts: Map<string, null | string[]>;
  alertRunContext?: {
    scheduledMinute?: string;
    baseAlertSchedule?: string[];
  };
};
