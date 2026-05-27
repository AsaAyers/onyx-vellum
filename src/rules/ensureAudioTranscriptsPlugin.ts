import { visit } from "unist-util-visit";
import invariant from "tiny-invariant";
import { makePlugin } from "./makePlugin.js";
import path, { relative, dirname, isAbsolute, resolve } from "node:path";
import type { EmbedNode } from "../markdown/types.js";
import { VaultFile } from "../engine/VaultFile.js";
import { type FileOperation } from "../transcription/types.js";
import { existsSync, realpathSync } from "node:fs";

type LinkActionContext = {
  vaultPath: string;
  sourceNotePath: string;
  today: Date;
  jobIdFactory: (createdAt: Date) => string;
};

type ResolvedTranscriptContext = {
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
  link: EmbedNode | undefined,
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

/**
 * remark plugin to move checked tasks with a done field to the context for writing to another file.
 * - Removes matching ListItems from the current file and adds them to ctx.addTasks[destinationPath].
 * - On subsequent runs, if ctx.addTasks has tasks for the current file, appends them to the end of the file and removes them from context.
 */
export const ensureAudioTranscriptsPlugin = makePlugin(
  "ensureAudioTranscripts",
  function ({ tree, file, ctx }) {
    visit(tree, "obsidianEmbed", (node, _index, parent) => {
      if (!node.target.endsWith(".m4a")) {
        return;
      }
      invariant(parent, "obsidianEmbed node must have a parent");

      const { dates, vaultPath } = ctx;
      const todayDate = dates.date;
      const tmp = resolveTranscriptContext(node, {
        sourceNotePath: file.absolutePath,
        vaultPath,
        today: todayDate,
        jobIdFactory: ctx.jobIdFactory,
      });
      if (!tmp) {
        // Return early when there is no audio file
        return;
      }

      const { audioPath, transcriptExists, transcriptPath } = tmp;

      const hasTranscriptLink = parent?.children.some((sibling) => {
        return (
          sibling.type === "obsidianEmbed" && sibling.target === transcriptPath
        );
      });

      if (!hasTranscriptLink) {
        const newLink: EmbedNode = {
          type: "obsidianEmbed",
          target: transcriptPath,
          value: `[[${transcriptPath}]]`,
        };
        parent.children.splice(
          parent.children.indexOf(node) + 1,
          0,
          {
            type: "text",
            value: "\n",
          },
          newLink,
        );
      }

      if (!transcriptExists) {
        const createdAt = todayDate.toISOString();
        const transcriptRelativePath = path.join(
          path.dirname(file.relativePath),
          transcriptPath,
        );
        const absoluteTranscriptPath = path.join(
          ctx.vaultPath,
          transcriptRelativePath,
        );

        const vaultFile = new VaultFile({
          absolutePath: absoluteTranscriptPath,
          relativePath: transcriptRelativePath,
          vaultPath: ctx.vaultPath,
        });

        const id = ctx.jobIdFactory(todayDate);
        const fileOperation: FileOperation = {
          location: {
            file: vaultFile,
            position: "end",
            header: "Transcript",
          },
          frontmatter: {
            status: "pending",
            jobId: id,
          },
          content: `
> [!onyx]+ OnyxVellum: job status
> Transcription is pending.
`,
        };
        ctx.updateFile({
          location: {
            file: vaultFile,
            position: "start",
            header: null,
          },
          content: `Source audio: [[${path.relative(
            path.dirname(absoluteTranscriptPath),
            audioPath,
          )}]]`,
        });
        ctx.updateFile(fileOperation);

        ctx.queueJob({
          type: "transcribe",
          vaultPath,
          id,
          audioPath,
          createdAt,
          target: fileOperation,
        });
      }
    });
  },
);
