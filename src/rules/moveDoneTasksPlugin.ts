import fs from "node:fs";
import { visit } from "unist-util-visit";
import type { Root, List } from "mdast";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import { join } from "node:path";
import { VaultFile } from "../engine/FileWriteManager.js";

/**
 * remark plugin to move checked tasks with a done field to the context for writing to another file.
 * - Removes matching ListItems from the current file and adds them to ctx.addTasks[destinationPath].
 * - On subsequent runs, if ctx.addTasks has tasks for the current file, appends them to the end of the file and removes them from context.
 */
export const moveDoneTasksPlugin = makePlugin(
  "moveDoneTasks",
  function ({ tree, ctx, ruleConfig, debug }) {
    const { vaultPath } = ctx;
    const dailyNotesFolder = ruleConfig?.dailyNotesFolder;
    if (dailyNotesFolder) {
      visit(tree as Root, "list", (listNode: List) => {
        if (!Array.isArray(listNode.children)) return;
        // Remove and collect tasks
        listNode.children = listNode.children.filter((item) => {
          if (item.type === "listItem") {
            const checked = item.checked;
            const fields = getInlineFields(item);
            debug({ checked, done: fields.done });
            if (checked && fields.done) {
              const done = fields.done;
              const relativePath = join(dailyNotesFolder, `${done}.md`);
              const dailyFile = new VaultFile({
                absolutePath: join(vaultPath, relativePath),
                relativePath: relativePath,
                vaultPath,
              });
              const destExists = fs.existsSync(dailyFile.absolutePath);
              debug(dailyFile.relativePath, {
                destExists,
                today: ctx.dates.today,
              });

              if (destExists) {
                ctx.updateFile({
                  location: {
                    file: dailyFile,
                    header: null,
                    position: "end",
                  },
                  content: item,
                });
                return false; // Remove from current file
              }
            }
          }
          return true;
        });
      });
    }
    return tree;
  },
);
