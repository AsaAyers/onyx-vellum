import {
  getInlineFields,
  setInlineField,
} from "../markdown/inlineFieldsPlugin.js";
import { visit } from "unist-util-visit";
import type { Plugin, Processor } from "unified";
import type { Root, Node, ListItem } from "mdast";
import "../markdown/ast-augmentations.js";
import invariant from "tiny-invariant";
import type { Config } from "../config.js";
import { fileMatchesSources } from "../engine/runner.js";

/** Inline date fields that may contain relative date literals. */
const DATE_KEYS = ["due", "start", "snooze", "done"] as const;

/**
 * remark plugin to normalize 'today' literals in date fields to the current date.
 * - Finds any inline field with value 'today' and replaces it with the ISO date for today.
 */
export const normalizeTodayPlugin: Plugin<
  [Config["rules"]["normalizeTodayLiteral"]],
  Root
> = function (this: Processor<Node | undefined>, config) {
  const processor = this;
  processor.plugins ??= new Set();
  invariant(
    processor.plugins.has("inlineFields"),
    "inlineFields plugin must be included before normalizeTodayPlugin",
  );
  processor.plugins.add("normalizeTodayPlugin");
  const settings = processor.data("settings");
  invariant(
    settings?.onyxVellum,
    "onyxVellum settings must be provided for normalizeTodayPlugin",
  );
  const vaultPath = settings.onyxVellum.vaultPath;

  /**
   * _file is necessary to make it a remark plugin and not a rehype plugin.
   */
  return function (tree, file) {
    if (
      file.path &&
      config?.sources &&
      !fileMatchesSources(file.path, config.sources, vaultPath)
    ) {
      return tree;
    }

    const todayStr = settings?.onyxVellum?.today;
    if (!todayStr) return;
    // Compute yesterday and tomorrow from todayStr
    const todayDate = new Date(todayStr);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const toISO = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(todayDate.getDate() - 1);
    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setDate(todayDate.getDate() + 1);
    const yesterdayStr = toISO(yesterdayDate);
    const tomorrowStr = toISO(tomorrowDate);
    // Normalize all recognized date literals in DATE_KEYS only, on the inlineFields node
    // ...existing code...
    visit(tree, "listItem", (node: ListItem) => {
      const fields = getInlineFields(node);
      for (const key of DATE_KEYS) {
        const value = fields[key];
        if (typeof value === "string") {
          const v = value.trim().toLowerCase();
          if (v === "today") {
            setInlineField(node, key, todayStr);
            console.log("normalizeTodayPlugin updated field:", key, todayStr);
          } else if (v === "yesterday") {
            setInlineField(node, key, yesterdayStr);
            console.log(
              "normalizeTodayPlugin updated field:",
              key,
              yesterdayStr,
            );
          } else if (v === "tomorrow") {
            setInlineField(node, key, tomorrowStr);
            console.log(
              "normalizeTodayPlugin updated field:",
              key,
              tomorrowStr,
            );
          }
        }
      }
    });
    return tree;
  };
};
