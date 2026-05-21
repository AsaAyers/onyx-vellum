import { visit } from "unist-util-visit";
import type { Plugin, Processor } from "unified";
import type { Root } from "mdast";
import "../markdown/ast-augmentations.js";
import type { Config } from "../config.js";
import { fileMatchesSources } from "../engine/runner.js";
import invariant from "tiny-invariant";
import type { Node } from "mdast";
import type { PluginContext } from "../markdown/parse.js";
import { resolveTranscriptContext } from "../engine/actions/linkTranscriptionContext.js";
import { toZonedTime } from "date-fns-tz";
import { enqueue } from "../transcription/queue.js";
import type { TranscriptionPipelineJob } from "../transcription/types.js";

/**
 * remark plugin to move checked tasks with a done field to the context for writing to another file.
 * - Removes matching ListItems from the current file and adds them to ctx.addTasks[destinationPath].
 * - On subsequent runs, if ctx.addTasks has tasks for the current file, appends them to the end of the file and removes them from context.
 */
export const ensureAudioTranscriptsPlugin: Plugin<
  [Config["rules"]["ensureAudioTranscripts"], PluginContext],
  Root
> = function (this: Processor<Node | undefined>, config, ctx) {
  const processor = this;
  const settings = processor.data("settings");
  invariant(
    settings?.onyxVellum,
    "onyxVellum settings must be provided for moveDoneTasksPlugin",
  );
  const vaultPath = settings.onyxVellum.vaultPath;
  const todayStr = settings?.onyxVellum?.today;
  const timezone = settings?.onyxVellum?.timezone || "UTC";
  if (!todayStr) return;
  // Use toZonedTime to get local midnight in the user's timezone
  // todayStr is always in yyyy-MM-dd format
  // This creates a Date at midnight in the target timezone
  const baseDate = new Date(todayStr + "T00:00:00");
  const todayDate = toZonedTime(baseDate, timezone);

  return function (tree, file): Root | undefined {
    if (
      file.path &&
      config?.sources &&
      !fileMatchesSources(file.path, config.sources, vaultPath)
    ) {
      return tree;
    }

    visit(tree, "obsidianEmbed", (node, _index, parent) => {
      if (
        file.path &&
        config?.sources &&
        !fileMatchesSources(file.path, config.sources, vaultPath)
      ) {
        return;
      }

      if (!node.target.endsWith(".m4a")) {
        return;
      }
      invariant(parent, "obsidianEmbed node must have a parent");

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
        const newLink = JSON.parse(JSON.stringify(node)) as typeof node;
        newLink.target = transcriptPath;
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
        const job: TranscriptionPipelineJob = {
          type: "transcription-pipeline",
          id: ctx.jobIdFactory(todayDate),
          audioPath,
          transcriptPath,
          sourceNotePath: file.path,
          createdAt,
        };

        enqueue(ctx.stateDir, job);
      }
    });
  };
};
