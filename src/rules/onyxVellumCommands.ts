import { SKIP, visitParents } from "unist-util-visit-parents";
import { makePlugin } from "./makePlugin.js";
import { zVaultFile } from "../engine/io.js";
import { relative } from "path";
import type { ContentLocation, FileOperation } from "../transcription/types.js";
import { ONYX_COMMANDS_FILE } from "../onyx_vellum_commands.js";

export const onyxVellumCommands = makePlugin(
  "commands",
  function ({ tree, ctx, file }) {
    if (file.path.endsWith(ONYX_COMMANDS_FILE)) {
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

      const vaultFile = zVaultFile.parse({
        absolutePath: file.path,
        relativePath: relative(ctx.vaultPath, file.path),
      });

      const id = ctx.jobIdFactory(new Date());
      const source: ContentLocation = {
        header: headerText,
        file: vaultFile,
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
              file: vaultFile,
            },
          };
          ctx.updateFile(target);
          ctx.queueJob({
            type: "find-tasks",
            id,
            vaultPath: ctx.vaultPath,
            source,
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
              position: "end",
              file: vaultFile,
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
