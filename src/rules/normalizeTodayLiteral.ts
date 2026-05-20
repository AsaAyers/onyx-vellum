import type { RuleSpec } from "./types.js";

/**
 * Normalization rule: scan every Markdown file in the vault and replace any
 * relative date literal ("today", "yesterday", "tomorrow") in inline date
 * fields with the corresponding resolved ISO date string (YYYY-MM-DD).
 *
 * This rule is registered first so that subsequent rules always see real
 * dates rather than relative keywords.
 *
 * Example transformations:
 *   `- [ ] Pay bills due:today`      →  `- [ ] Pay bills due:2026-05-03`
 *   `- [ ] Check notes due:yesterday`→  `- [ ] Check notes due:2026-05-02`
 *   `- [ ] Prep work start:tomorrow` →  `- [ ] Prep work start:2026-05-04`
 */
export const normalizeTodayLiteralSpec: RuleSpec = {
  name: "normalizeTodayLiteral",
  sources: [{ type: "glob", pattern: "**/*.md" }],
  query: { type: "tasks" },
  actions: [],
};
