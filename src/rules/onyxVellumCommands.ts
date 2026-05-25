import { visitParents } from "unist-util-visit-parents";
import { makePlugin } from "./makePlugin.js";
import { zVaultFile } from "../engine/io.js";
import { join } from "path";
import type { FileOperation } from "../transcription/types.js";

export const onyxVellumCommands = makePlugin(
  "commands",
  function ({ tree, ctx, file }) {
    visitParents(tree, "obsidianTag", (node, ancestors) => {
      switch (node.value) {
        case "#onyx/summarize": {
          const root = ancestors[0];
          const currentRootIndex = root.children.findIndex(
            (child) => child === ancestors[1],
          );

          const heading = root.children
            .slice(0, currentRootIndex)
            .reverse()
            .find((child) => child.type === "heading");

          let header: string | null = null;
          if (heading) {
            const textNode = heading.children.find(
              (child) => child.type === "text",
            );
            if (textNode) {
              header = textNode.value;
            }
          }

          const vaultFile = zVaultFile.parse({
            relativePath: file.path,
            absolutePath: join(ctx.vaultPath, file.path),
          });
          const id = ctx.jobIdFactory(new Date());
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
            source: {
              header,
              file: vaultFile,
              position: "end",
            },
            target,
          });

          break;
        }
      }
    });
  },
);
