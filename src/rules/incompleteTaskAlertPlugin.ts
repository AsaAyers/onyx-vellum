import type { Config } from "../loadConfig.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import { visit } from "unist-util-visit";
import { zVaultFile } from "../engine/FileWriteManager.js";
import { join } from "node:path";
import { extractYamlFrontmatter } from "../engine/FileOperationExecutor.js";

export const ALERT_FILE = "onyx_alert.md";

export const incompleteTaskAlertPlugin = makePlugin(
  "incompleteTaskAlert",
  function ({ tree, ruleConfig, ctx, file, debug }) {
    if (ctx.mode !== "alert") return;
    if (!ruleConfig?.alertUrl) {
      debug("[incompleteTaskAlert] No alertUrl configured, skipping plugin");
      return;
    }
    if (file.path === ALERT_FILE) return;
    const vaultFile = zVaultFile.parse({
      absolutePath: join(ctx.vaultPath, ALERT_FILE),
      relativePath: ALERT_FILE,
    });

    const { frontmatter } = extractYamlFrontmatter(tree);
    const priority = frontmatter?.priority ?? "medium";
    let numTasks = 0;
    visit(tree, "listItem", (node) => {
      if (node.checked === false) {
        const fields = getInlineFields(node);
        if (fields.start && fields.start > ctx.dates.today) {
          return; // Not started yet, skip alert
        }
        if (fields.snooze && fields.snooze > ctx.dates.today) {
          return; // Snoozed, skip alert
        }

        if (priority === "low") {
          numTasks++;
          return;
        }

        ctx.updateFile({
          location: {
            file: vaultFile,
            header: file.path.replace(ctx.vaultPath, ""),
            position: "end",
          },
          content: node,
        });
      }
    });

    ctx.updateFile({
      location: {
        file: vaultFile,
        header: "",
        position: "end",
      },
      content: `* ${numTasks} tasks in ${file.path.replace(ctx.vaultPath, "")}
          `,
    });
    return;
  },
);

export async function sendNotification(
  config: Config["rules"]["incompleteTaskAlert"],
  content: string,
) {
  const { alertUrl, alertToken } = config || {};
  if (!alertUrl) return;
  // ntfy.sh requires Content-Type: text/plain for inline message bodies.
  // Markdown rendering is enabled via the Markdown header, and the Title
  // header sets the notification title shown in the app.
  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
    Markdown: "yes",
    Title: "Incomplete Tasks",
  };
  if (alertToken) headers["Authorization"] = `Bearer ${alertToken}`;
  const response = await fetch(alertUrl, {
    method: "POST",
    headers,
    body: content,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const bodySummary = body.trim();
    const bodySuffix =
      bodySummary.length > 0 ? ` — ${bodySummary.slice(0, 200)}` : "";
    throw new Error(
      `incompleteTaskAlert HTTP ${response.status} ${response.statusText}${bodySuffix}`,
    );
  }
}
