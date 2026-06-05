import type { RuleConfig } from "./loadConfig.js";

export interface ConfiguredRules {
  moveDoneTasks: MoveDoneTasksConfig;
}
export type MoveDoneTasksConfig = RuleConfig;
