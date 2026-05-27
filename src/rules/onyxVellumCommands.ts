import { EXIT, SKIP, visitParents } from "unist-util-visit-parents";
import { makePlugin } from "./makePlugin.js";
import { dirname, join } from "path";
import type { ContentLocation, FileOperation } from "../transcription/types.js";

export const onyxVellumCommands = makePlugin(
  "commands",
  function ({ tree, ctx, file }) {
    if (file.relativePath?.endsWith(ONYX_COMMANDS_FILE)) {
      return;
    }

    visitParents(tree, "obsidianTag", (node, ancestors) => {
      const root = ancestors[0];
      const currentRootIndex = root.children.findIndex(
        (child) => child === ancestors[1],
      );

      const headingContainer = root.children
        .slice(0, currentRootIndex)
        .reverse()
        .find((child) => child.type === "heading");

      let headerText: string | null = null;
      if (headingContainer) {
        const textNode = headingContainer.children.find(
          (child) => child.type === "text",
        );
        if (textNode) {
          headerText = textNode.value;
        }
      }

      const now = new Date();
      const id = ctx.jobIdFactory(now);
      const createdAt = now.toISOString();
      const source: ContentLocation = {
        header: headerText,
        file: file,
        position: "end",
      };

      switch (node.value) {
        case "#onyx/tasks": {
          const target: FileOperation = {
            frontmatter: {
              tasks: id,
            },
            location: {
              header: "Tasks",
              position: "end",
              file: file,
            },
          };
          ctx.updateFile(target);
          ctx.queueJob({
            type: "find-tasks",
            id,
            vaultPath: ctx.vaultPath,
            source,
            target,
            createdAt,
          });
          break;
        }
        case "#onyx/transcribe": {
          let audioPath: string | null = null;

          visitParents(ancestors[0], "wikiLink", (node) => {
            if (node.value.toLowerCase().endsWith(".m4a")) {
              audioPath = join(dirname(file.absolutePath), node.value);
              return EXIT;
            }
          });

          if (!audioPath) {
            console.warn(
              `No audio file found for transcription command in ${file.relativePath}`,
            );
            break;
          }

          const target: FileOperation = {
            frontmatter: {
              transcribe: id,
            },
            location: {
              header: "Transcript",
              position: "end",
              file: file,
            },
          };

          const vaultPath = ctx.vaultPath;
          ctx.queueJob({
            type: "transcribe",
            vaultPath,
            id,
            audioPath,
            createdAt,
            target,
          });

          break;
        }
        case "#onyx/summarize": {
          const target: FileOperation = {
            frontmatter: {
              summarizeText: id,
            },
            location: {
              header: "Summary",
              position: "start",
              file: file,
            },
          };
          ctx.updateFile(target);
          ctx.queueJob({
            type: "summarize-text",
            id,
            vaultPath: ctx.vaultPath,
            source,
            target,
          });

          break;
        }
        default:
          return;
      }

      const parent = ancestors[ancestors.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self = parent.children.indexOf(node as any);
      parent.children.splice(self, 1);
      return SKIP;
    });
  },
);
export const commandsMarkdown = `Commands:

* #onyx/transcribe
  * Re-run transcription against the source audio file
* #onyx/tasks
  * Extract tasks from the current section and add a new "Tasks" section at the bottom of the file
`;
export const ONYX_COMMANDS_FILE = "onyx-commands.md";
