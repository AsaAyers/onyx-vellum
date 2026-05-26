import { visit } from "unist-util-visit";
import invariant from "tiny-invariant";
import { resolveTranscriptContext } from "../engine/actions/linkTranscriptionContext.js";
import { makePlugin } from "./makePlugin.js";
import path, { relative } from "node:path";
import type { ObsidianEmbedNode } from "../markdown/types.js";
import { zVaultFile } from "../engine/io.js";
import type { FileOperation } from "../transcription/types.js";

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
        sourceNotePath: file.path,
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
        const newLink: ObsidianEmbedNode = {
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
        const absoluteTranscriptPath = path.join(
          path.dirname(file.path),
          transcriptPath,
        );

        const vaultFile = zVaultFile.parse({
          absolutePath: absoluteTranscriptPath,
          relativePath: relative(ctx.vaultPath, absoluteTranscriptPath),
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
