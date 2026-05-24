import type { Config } from "../config.js";

export const EMPTY_CONFIG: Config = {
  sources: [{ type: "glob", pattern: "**/*.md" }],
  rules: {},
};
