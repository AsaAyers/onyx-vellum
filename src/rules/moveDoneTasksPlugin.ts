import fs from "node:fs";
import { visit } from "unist-util-visit";
import type { Root, List } from "mdast";
import "../markdown/ast-augmentations.js";
import invariant from "tiny-invariant";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import type { RuleConfig } from "../config.js";
export type MoveDoneTasksConfig = RuleConfig & {
  dailyNotesFolder?: string;
};

export const writeTasksPlugin = makePlugin(
  "writeTasks",
  function ({ tree, file, ctx }) {
    const filePath = file.path;
    invariant(filePath, "file.path must be defined for moveDoneTasksPlugin");
    if (ctx?.addTasks?.[filePath]?.length) {
      // Find or create a root-level list at the end
      let lastList: List | undefined = undefined;
      for (let i = tree.children.length - 1; i >= 0; i--) {
        const node = tree.children[i];
        if (node.type === "list") {
          lastList = node as List;
          break;
        }
      }
      if (!lastList) {
        lastList = {
          type: "list",
          ordered: false,
          spread: false,
          children: [],
        };
        tree.children.push(lastList);
      }
      lastList.children.push(...ctx.addTasks[filePath]);
      delete ctx.addTasks[filePath];
    }
  },
);
/**
 * remark plugin to move checked tasks with a done field to the context for writing to another file.
 * - Removes matching ListItems from the current file and adds them to ctx.addTasks[destinationPath].
 * - On subsequent runs, if ctx.addTasks has tasks for the current file, appends them to the end of the file and removes them from context.
 */
export const moveDoneTasksPlugin = makePlugin(
  "moveDoneTasks",
  function ({ tree, ctx, ruleConfig }) {
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
            if (checked && fields.done) {
              const done = fields.done;
              const destPath = `${vaultPath}/${dailyNotesFolder}/${done}.md`;
              const destExists = fs.existsSync(destPath);

              if (destExists) {
                ctx.updateFile(destPath, {
                  header: null,
                  position: "end",
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
