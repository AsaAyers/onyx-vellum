import { toZonedTime } from "date-fns-tz";
import type { Config } from "../config.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import { visit } from "unist-util-visit";
import { zVaultFile } from "../engine/io.js";
import { join } from "node:path";

export const ALERT_FILE = "onyx_alert.md";

export const incompleteTaskAlertPlugin = makePlugin(
  "incompleteTaskAlert",
  function ({ tree, ruleConfig, ctx, file }) {
    if (ctx.mode !== "alert") return;
    if (!ruleConfig?.alertUrl) {
      console.log(
        "[incompleteTaskAlert] No alertUrl configured, skipping plugin",
      );
      return;
    }
    if (file.path === ALERT_FILE) return;
    const timezone = ctx.timezone || "UTC";
    const vaultFile = zVaultFile.parse({
      absolutePath: join(ctx.vaultPath, ALERT_FILE),
      relativePath: ALERT_FILE,
    });

    visit(tree, "listItem", (node) => {
      if (node.checked === false) {
        const fields = getInlineFields(node);
        const now = toZonedTime(new Date(), timezone);

        if (fields.start) {
          const startDate = toZonedTime(fields.start, timezone);
          if (startDate > now) {
            return; // Not started yet, skip alert
          }
        }

        if (fields.snooze) {
          const snoozeDate = toZonedTime(fields.snooze, timezone);
          if (snoozeDate > now) {
            return; // Snoozed, skip alert
          }
        }

        ctx.updateFile(vaultFile, {
          header: file.path,
          content: node,
          position: "end",
        });
      }
    });
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
