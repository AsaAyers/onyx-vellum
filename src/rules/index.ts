import { stampDoneSpec } from "./stampDone.js";
import { incompleteTaskAlertSpec } from "./incompleteTaskAlert.js";
import { normalizeTodayLiteralSpec } from "./normalizeTodayLiteral.js";
import { removeEphemeralOverdueTasksSpec } from "./removeEphemeralOverdueTasks.js";
import { ensureAudioTranscriptsSpec } from "./ensureAudioTranscripts.js";
import { moveDoneTasksSpec } from "./moveDoneTasks.js";
import { sortTasksSpec } from "./sortTasks.js";
import type { RuleSpec } from "./types.js";

/**
 * Declarative rule specs — interpreted by runRuleSpec in the engine.
 * Listed in execution order: normalization runs first so subsequent rules
 * always see resolved date values rather than the "today" keyword.
 * Specs with CustomAction actions run in a post-flush phase automatically.
 */
export const ruleSpecs: RuleSpec[] = [
  normalizeTodayLiteralSpec,
  stampDoneSpec,
  removeEphemeralOverdueTasksSpec,
  moveDoneTasksSpec,
  sortTasksSpec,
  ensureAudioTranscriptsSpec,
  incompleteTaskAlertSpec,
];
