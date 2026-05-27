/**
 * Vault-level configuration for onyx-vellum.
 *
 * The config file `.onyx-vellum.json` lives at the vault root and lets users
 * customise which files each rule operates on by overriding its `sources`.
 *
 * Shape:
 *   {
 *     "timezone": "America/New_York",          // optional IANA timezone
 *     "sources": [ ...Source objects... ],  // optional top-level sources (default for all rules)
 *     "watch": { "debounce": 60000 },        // optional watch-mode settings
 *     "rules": {
 *       "<ruleName>": { "sources": [ ...Source objects... ] }  // optional per-rule override
 *     }
 *   }
 *
 * When the file does not exist it is created automatically with the default
 * sources for every registered rule.  When a rule is present in the registry
 * but missing from the on-disk file (e.g. after upgrading to a version that
 * ships a new rule) its defaults are merged in and the file is persisted.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const zGlobSource = z.object({
  type: z.literal("glob"),
  pattern: z.string(),
  exclude: z.array(z.string()).optional(),
});

const zPathSource = z.object({
  type: z.literal("path"),
  value: z.string(),
});

export const zSource = z.discriminatedUnion("type", [zGlobSource, zPathSource]);

const zBaseRuleConfig = z.object({
  sources: z.array(zSource).optional(),
});

export type BaseRuleConfig = z.infer<typeof zBaseRuleConfig>;

const zMoveDoneTasks = zBaseRuleConfig.extend({
  dailyNotesFolder: z.string().optional(),
});

export const zAlertConfig = zBaseRuleConfig.extend({
  alertUrl: z.string().optional(),
  alertToken: z.string().optional(),
  schedule: z.array(z.string()).optional(),
});

const zWatchConfig = z.object({
  /** Debounce duration in milliseconds. Defaults to 60000 (60 s). */
  debounce: z.number().int().positive().optional(),
  /**
   * Times at which the incompleteTaskAlert rule fires in watch mode.
   * Each entry must be a local-time "HH:MM" string (24-hour clock).
   * When omitted or empty, the alert never fires automatically in watch mode.
   */
  alertSchedule: z.array(z.string()).optional(),
});
const zKnownRuleConfig = z.strictObject({
  incompleteTaskAlert: zAlertConfig.optional(),
  moveDoneTasks: zMoveDoneTasks.optional(),
  repeatTasks: zBaseRuleConfig.optional(),
  stampDone: zBaseRuleConfig.optional(),
  ensureAudioTranscripts: zBaseRuleConfig.optional(),
  normalizeTodayLiteral: zBaseRuleConfig.optional(),
  sortTasks: zBaseRuleConfig.optional(),
  commands: zBaseRuleConfig.optional(),
  obsidianProtections: zBaseRuleConfig.optional(),
  removeEphemeralOverdueTasks: zBaseRuleConfig.optional(),
});

export type KnownRuleConfig = z.infer<typeof zKnownRuleConfig>;
/**
 * Full config schema:
 *   - optional top-level timezone (IANA timezone, used for date processing)
 *   - optional top-level sources (default for all rules that don't specify their own)
 *   - optional watch config
 *   - required "rules" object keyed by rule name
 */
export const zConfig = z
  .object({
    timezone: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => {
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: value });
            return true;
          } catch {
            return false;
          }
        },
        {
          message: "Invalid IANA timezone",
        },
      )
      .optional(),
    sources: z.array(zSource).optional(),
    watch: zWatchConfig.optional(),
    rules: zKnownRuleConfig,
  })
  .strict();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-rule configuration stored in `.onyx-vellum.json`. */
export type RuleConfig = z.infer<typeof zBaseRuleConfig>;

/** Watch-mode configuration stored under the `"watch"` key in JSON. */
export type WatchConfig = z.infer<typeof zWatchConfig>;

/** Full vault-level config parsed from JSON. */
export type Config = z.infer<typeof zConfig>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The file name of the vault-level config, relative to the vault root. */
export const CONFIG_FILENAME = ".onyx-vellum.json";

/** The default top-level sources used when creating a new config file. */
export const DEFAULT_SOURCES: Array<z.infer<typeof zSource>> = [
  { type: "glob", pattern: "**/*.md" },
];

/**
 * Load (and if necessary create or augment) the vault-level config file.
 *
 * Behaviour:
 *   - If the file does not exist: write the full default config and return it.
 *   - If the file exists but is valid: merge in defaults for any rule that is
 *     absent from the stored config, persist the merged result, and return it.
 *   - If the file exists but is invalid JSON (or fails zod validation):
 *     throw a descriptive error so the user knows they must fix the file.
 *
 * The `watch` key is validated as a WatchConfig by `zConfig` and is preserved
 * in the returned value so callers can read `config.watch` directly.
 *
 * @param vaultPath  Absolute path to the vault root.
 * @param specs      All registered RuleSpecs (used to derive defaults).
 * @returns          The validated (and possibly augmented) config.
 */
export async function loadConfig(vaultPath: string): Promise<Config> {
  const configPath = join(vaultPath, CONFIG_FILENAME);

  const defaultConfig: Config = { sources: [...DEFAULT_SOURCES], rules: {} };

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // File does not exist — create it with all defaults.
    await fs.writeFile(configPath, serializeConfig(defaultConfig), "utf-8");
    return defaultConfig;
  }

  // Parse JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON in ${CONFIG_FILENAME}: ${(err as Error).message}. ` +
        `Please fix or delete the file and re-run.`,
    );
  }

  const result = zConfig.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid ${CONFIG_FILENAME}:\n${issues}\nPlease fix or delete the file and re-run.`,
    );
  }

  const stored = result.data;
  const merged: Config = { ...stored, rules: { ...stored.rules } };

  return merged;
}

function serializeConfig(config: Config): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
