import fs from "node:fs";
import { visit } from "unist-util-visit";
import type { Plugin, Processor } from "unified";
import type { Root, List } from "mdast";
import "../markdown/ast-augmentations.js";
import type { Config } from "../config.js";
import { fileMatchesSources } from "../engine/runner.js";
import invariant from "tiny-invariant";
import type { Node } from "mdast";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import type { PluginContext } from "../markdown/parse.js";

/**
 * remark plugin to move checked tasks with a done field to the context for writing to another file.
 * - Removes matching ListItems from the current file and adds them to ctx.addTasks[destinationPath].
 * - On subsequent runs, if ctx.addTasks has tasks for the current file, appends them to the end of the file and removes them from context.
 */
export const moveDoneTasksPlugin: Plugin<
  [Config["rules"]["moveDoneTasks"], PluginContext],
  Root
> = function (this: Processor<Node | undefined>, config, ctx) {
  const processor = this;
  const settings = processor.data("settings");
  invariant(
    settings?.onyxVellum,
    "onyxVellum settings must be provided for moveDoneTasksPlugin",
  );
  const vaultPath = settings.onyxVellum.vaultPath;
  const dailyNotesFolder = config?.dailyNotesFolder;

  return function (tree, file) {
    const filePath = file.path;
    invariant(filePath, "file.path must be defined for moveDoneTasksPlugin");
    if (!filePath) return;
    // 1. If there are tasks to add to this file, append them and clear from context
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
    // 2. Remove checked+done tasks and add to context for their destination
    if (
      config?.sources &&
      filePath &&
      !fileMatchesSources(filePath, config.sources, vaultPath)
    ) {
      return tree;
    }
    if (dailyNotesFolder) {
      visit(tree as Root, "list", (listNode: List) => {
        if (!Array.isArray(listNode.children)) return;
        // Remove and collect tasks
        listNode.children = listNode.children.filter((item) => {
          if (item.type === "listItem") {
            const checked = item.checked;
            const fields = getInlineFields(item);
            console.log("moveDoneTasksPlugin debug:", {
              checked,
              fields,
              item,
            });
            if (checked && fields.done) {
              const done = fields.done;
              const destPath = `${vaultPath}/${dailyNotesFolder}/${done}.md`;
              const destExists = fs.existsSync(destPath);

              if (destExists) {
                ctx.addTasks[destPath] = ctx.addTasks[destPath] || [];
                ctx.addTasks[destPath].push(item);
                return false; // Remove from current file
              }
            }
          }
          return true;
        });
      });
    }
    return tree;
  };
};
