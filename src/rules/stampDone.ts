import type { RuleSpec } from "./types.js";

/**
 * Normal-run stamp: every checked task that lacks a `done:` field gets
 * stamped with today's actual ISO date (YYYY-MM-DD).  Because this rule
 * depends on `normalizeTodayLiteral`, any pre-existing `done:today` literal
 * has already been resolved before this stamp runs, so only tasks that were
 * freshly completed in the current pipeline invocation receive the new stamp.
 *
 * The resulting `done:YYYY-MM-DD` value (matching today's date) is then used
 * by `completedTaskRollover` to identify tasks that need a clone.
 */
export const stampDoneSpec: RuleSpec = {
  name: "stampDone",
  dependencies: ["normalizeTodayLiteral"],
  sources: [{ type: "glob", pattern: "**/*.md" }],
  query: { type: "tasks", predicate: { type: "checked" } },
  actions: [],
};

/**
 * Init-pass stamp: sets `done:unknown` on checked tasks that lack a `done:`
 * field.  Used exclusively by `--init` to back-fill a placeholder for tasks
 * that were completed before the pipeline was first run.  The `unknown` value
 * is intentionally not a valid date, so it is never matched by the date-based
 * predicates in the normal rule pipeline.
 */
export const stampDoneUnknownSpec: RuleSpec = {
  name: "stampDoneUnknown",
  sources: [{ type: "glob", pattern: "**/*.md" }],
  query: { type: "tasks", predicate: { type: "checked" } },
  actions: [
    { type: "task.setFieldDateIfMissing", key: "done", value: "unknown" },
  ],
};
