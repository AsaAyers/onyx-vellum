import type { Config } from "../loadConfig.js";
import { getInlineFields } from "../markdown/inlineFieldsPlugin.js";
import { makePlugin } from "./makePlugin.js";
import { visit } from "unist-util-visit";
import { VaultFile } from "../engine/VaultFile.js";
import { join } from "node:path";
import {
  mergeFrontmatter,
  readFrontmatter,
} from "../engine/mergeFrontmatter.js";
import type { List, ListItem } from "mdast";
import type { UserLocalTime } from "../engine/userLocalTime.js";
import { normalizeAlertSchedule } from "../engine/createAlertScheduler.js";

export const ALERT_FILE = "onyx_alert.md";

export const incompleteTaskAlertPlugin = makePlugin(
  "incompleteTaskAlert",
  function ({ tree, ruleConfig, ctx, file, debug }) {
    if (!ruleConfig) return;

    const frontmatter = readFrontmatter(tree);
    const fileSchedule = parseFileAlertSchedule(frontmatter?.alertSchedule);

    if (ctx.mode === "all") {
      const fileAlertTimes =
        fileSchedule.valid.length > 0 ? fileSchedule.valid : null;
      ctx.fileAlerts.set(file.relativePath, fileAlertTimes);
      if (fileSchedule.hasSchedule && fileSchedule.valid.length === 0) {
        ctx.report?.(
          `[incompleteTaskAlert] ${file.relativePath} has alertSchedule but no valid times`,
        );
      }
      if (fileSchedule.wasString) {
        mergeFrontmatter(tree, {
          alertSchedule: fileSchedule.normalizedEntries,
        });
      }
      return;
    }

    if (ctx.mode !== "alert") return;
    if (!ruleConfig.alertUrl) {
      debug("[incompleteTaskAlert] No alertUrl configured, skipping plugin");
      return;
    }
    if (file.relativePath === ALERT_FILE) return;

    if (!isFileEligibleForCurrentAlertRun(fileSchedule, ctx)) {
      return;
    }

    const vaultFile = new VaultFile({
      absolutePath: join(ctx.vaultPath, ALERT_FILE),
      relativePath: ALERT_FILE,
      vaultPath: ctx.vaultPath,
    });

    const priority = frontmatter?.priority ?? "medium";
    const alertIf = parseAlertIf(frontmatter?.alertIf);
    const alertThreshold = parseAlertThreshold(frontmatter?.alertThreshold);

    let qualifyingTasks = 0;
    const alertItems: ListItem[] = [];
    visit(tree, "listItem", (node) => {
      if (node.checked === false) {
        const fields = getInlineFields(node);
        if (fields.snooze && fields.snooze > ctx.dates.today) {
          return; // Snoozed, skip alert
        }

        if (!matchesAlertIf(fields, alertIf, ctx.dates)) {
          return;
        }

        qualifyingTasks++;
        if (priority !== "low") {
          alertItems.push(node);
        }
      }
    });

    if (qualifyingTasks < alertThreshold) {
      return;
    }

    if (priority === "low") {
      ctx.updateFile({
        location: {
          file: vaultFile,
          header: "Low Priority Tasks",
          position: "end",
        },
        content: `* ${qualifyingTasks} tasks in ${file.relativePath.replace(ctx.vaultPath, "")}
            `,
      });
    } else if (alertItems.length > 0) {
      ctx.updateFile({
        location: {
          file: vaultFile,
          header: file.relativePath,
          position: "end",
        },
        content: {
          type: "list",
          ordered: false,
          spread: false,
          children: alertItems,
        } satisfies List,
      });
    }
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

type ParsedFileSchedule = {
  hasSchedule: boolean;
  wasString: boolean;
  normalizedEntries: string[];
  valid: string[];
};

function parseFileAlertSchedule(value: unknown): ParsedFileSchedule {
  if (value === undefined) {
    return {
      hasSchedule: false,
      wasString: false,
      normalizedEntries: [],
      valid: [],
    };
  }

  let normalizedEntries: string[] = [];
  let wasString = false;

  if (typeof value === "string") {
    wasString = true;
    normalizedEntries = value
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  } else if (Array.isArray(value)) {
    normalizedEntries = value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  const { valid } = normalizeAlertSchedule(normalizedEntries);
  return {
    hasSchedule: true,
    wasString,
    normalizedEntries,
    valid,
  };
}

function isFileEligibleForCurrentAlertRun(
  fileSchedule: ParsedFileSchedule,
  ctx: {
    alertRunContext?: {
      scheduledMinute?: string;
      baseAlertSchedule?: string[];
    };
  },
): boolean {
  const scheduledMinute = ctx.alertRunContext?.scheduledMinute;
  if (!scheduledMinute) {
    return true;
  }

  if (fileSchedule.valid.length > 0) {
    return fileSchedule.valid.includes(scheduledMinute);
  }

  const baseSchedule = normalizeAlertSchedule(
    ctx.alertRunContext?.baseAlertSchedule ?? [],
  ).valid;
  return baseSchedule.includes(scheduledMinute);
}

type AlertIfCondition = {
  field: string;
  operator: "<=" | ">=" | "==";
  value: string;
};

function parseAlertIf(value: unknown): AlertIfCondition | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return undefined;
  const match = raw.match(
    /^([A-Za-z][A-Za-z0-9_-]*)(<=|>=|==)([A-Za-z][A-Za-z0-9_-]*)$/,
  );
  if (!match) return undefined;
  return {
    field: match[1],
    operator: match[2] as AlertIfCondition["operator"],
    value: match[3],
  };
}

function parseAlertThreshold(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1 ? Math.floor(value) : 1;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
  }
  return 1;
}

function matchesAlertIf(
  fields: Record<string, string>,
  alertIf: AlertIfCondition | undefined,
  dates: UserLocalTime,
): boolean {
  if (!alertIf) return true;
  const left = fields[alertIf.field];
  if (typeof left !== "string") return false;
  const right = dates.resolve(alertIf.value);
  if (!right) return false;
  switch (alertIf.operator) {
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
    case "==":
      return left === right;
  }
}
