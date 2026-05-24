import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  hasEmbedAnywhere,
  insertEmbedBelowLine,
  type MarkdownLink,
} from "../../markdown/links.js";
import type { LinkActionContext } from "./types.js";
import type { ObsidianEmbedNode } from "../../markdown/types.js";

export type ResolvedTranscriptContext = {
  audioPath: string;
  transcriptPath: string;
  transcriptEmbed: string;
  transcriptExists: boolean;
};

function isWithinVault(vaultPath: string, filePath: string): boolean {
  try {
    const vaultRealPath = realpathSync(vaultPath);
    const fileRealPath = realpathSync(filePath);
    const rel = relative(vaultRealPath, fileRealPath);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  } catch {
    return false;
  }
}

export function resolveTranscriptContext(
  link: ObsidianEmbedNode | undefined,
  ctx: LinkActionContext | undefined,
): ResolvedTranscriptContext | undefined {
  if (!link || !ctx) return undefined;

  const transcriptPath = link.target.replace(/\.m4a$/, ".transcript.md");
  const audioPath = resolve(dirname(ctx.sourceNotePath), link.target);
  const exists = existsSync(audioPath);
  if (!exists) return undefined;
  if (!isWithinVault(ctx.vaultPath, audioPath)) return undefined;

  const transcriptEmbed = `![[${transcriptPath}]]`;

  return {
    audioPath,
    transcriptPath,
    transcriptEmbed,
    transcriptExists: existsSync(
      resolve(dirname(ctx.sourceNotePath), transcriptPath),
    ),
  };
}

export function maybeInsertTranscriptEmbed(
  body: string,
  link: MarkdownLink | undefined,
  transcriptEmbed: string,
): string | undefined {
  if (!link || hasEmbedAnywhere(body, transcriptEmbed)) return undefined;
  return insertEmbedBelowLine(body, link.lineIndex, transcriptEmbed);
}
