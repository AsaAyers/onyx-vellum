import fs from "node:fs";
import { visit } from "unist-util-visit";
import type { Root, List } from "mdast";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import { join } from "node:path";
import { VaultFile } from "../engine/VaultFile.js";
import { readFrontmatter } from "../engine/mergeFrontmatter.js";
import type { UserLocalTime } from "../engine/userLocalTime.js";

/**
 * remark plugin to move checked tasks with a done field to the context for writing to another file.
 * - Removes matching ListItems from the current file and adds them to ctx.addTasks[destinationPath].
 * - On subsequent runs, if ctx.addTasks has tasks for the current file, appends them to the end of the file and removes them from context.
 */
export const moveDoneTasksPlugin = makePlugin(
  "moveDoneTasks",
  function ({ tree, ctx, debug }) {
    const { vaultPath } = ctx;
    const frontmatter = readFrontmatter(tree as Root);
    const destinationTemplate =
      typeof frontmatter.moveDoneTasks === "string"
        ? frontmatter.moveDoneTasks.trim()
        : "";

    if (!destinationTemplate) {
      return tree;
    }

    visit(tree as Root, "list", (listNode: List) => {
      if (!Array.isArray(listNode.children)) return;
      // Remove and collect tasks
      listNode.children = listNode.children.filter((item) => {
        if (item.type === "listItem") {
          const checked = item.checked;
          const fields = getInlineFields(item);
          debug({ checked, done: fields.done });
          if (checked && fields.done) {
            const relativePath = resolveMoveDoneDestination(
              destinationTemplate,
              fields.done,
              ctx.dates,
            );

            if (!relativePath) {
              return true;
            }

            const dailyFile = new VaultFile({
              absolutePath: join(vaultPath, relativePath),
              relativePath,
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

    return tree;
  },
);

function resolveMoveDoneDestination(
  template: string,
  done: string,
  dates: UserLocalTime,
): string | null {
  let unresolved = false;
  const resolved = template.replaceAll(/\{([^{}]+)\}/g, (_full, rawToken) => {
    const token = String(rawToken).trim();
    if (token === "done") {
      return done;
    }
    const value = dates.resolve(token);
    if (!value) {
      unresolved = true;
      return "";
    }
    return value;
  });

  if (unresolved) {
    return null;
  }

  return resolved;
}
