import type { Task } from "../markdown/tasks.js";
import type { Config } from "../config.js";

export type RuleContext = {
  vaultPath: string;
  today: Date;
  dryRun: boolean;
  jobIdFactory: (createdAt: Date) => string;
  /**
   * When true, emit rule-progress logs and the run summary to the console
   * even during dry-run mode.  Defaults to false.
   */
  verbose?: boolean;
  env: NodeJS.ProcessEnv;
  config?: Config;
  /**
   * Read a file through the shared transform queue.
   * Always use this instead of importing io.readFile directly so that staged
   * changes from earlier rules in the same run are visible to later ones.
   */
  readFile: (path: string) => Promise<string>;
  /**
   * Emit a line of output that is captured in the run report.
   * Rules should use this (via CustomAction's `log` arg) instead of
   * console.log so that dry-run previews appear in the returned report.
   * Defaults to console.log when not provided.
   */
  log?: (msg: string) => void;
  /**
   * Which rule specs to run.  `'all'` (default when omitted) runs every
   * registered spec in dependency order.  An array of rule names runs only
   * those rules plus their transitive dependencies.
   */
  selectedRuleNames?: string[] | "all";
  /**
   * An array of glob patterns / relative file paths (relative to vaultPath)
   * that restricts which files each rule processes. When provided, every
   * rule's resolved source list is filtered to contain only files that match
   * at least one of the patterns. All rules (including transitive
   * dependencies) are still executed; only the set of files they operate on
   * is narrowed.
   */
  onlyGlob?: string[];
};

export type FileChange = {
  path: string;
  content: string;
};

// ---------------------------------------------------------------------------
// Declarative RuleSpec model
// ---------------------------------------------------------------------------

/** A glob-pattern source (relative to vaultPath). */
export type GlobSource = {
  type: "glob";
  pattern: string;
  /**
   * Glob patterns (relative to vaultPath) for files to exclude from the
   * source.  A file is excluded if it matches any pattern in this list.
   * Supports the same syntax as `pattern`.
   */
  exclude?: string[];
};
/** A concrete relative-path source. */
export type PathSource = { type: "path"; value: string };
export type Source = GlobSource | PathSource;

// --- Predicates -------------------------------------------------------------

export type CheckedPredicate = { type: "checked" };
export type UncheckedPredicate = { type: "unchecked" };
export type FieldExistsPredicate = { type: "fieldExists"; key: string };
export type FieldEqualsPredicate = {
  type: "fieldEquals";
  key: string;
  value: string;
};
/** date: ISO "YYYY-MM-DD" or the literal "today" (resolved at run time). */
export type FieldDateBeforePredicate = {
  type: "fieldDateBefore";
  key: string;
  date: string;
};
export type FieldDateAfterPredicate = {
  type: "fieldDateAfter";
  key: string;
  date: string;
};
export type AndPredicate = { type: "and"; predicates: TaskPredicate[] };
export type OrPredicate = { type: "or"; predicates: TaskPredicate[] };
export type NotPredicate = { type: "not"; predicate: TaskPredicate };

export type TaskPredicate =
  | CheckedPredicate
  | UncheckedPredicate
  | FieldExistsPredicate
  | FieldEqualsPredicate
  | FieldDateBeforePredicate
  | FieldDateAfterPredicate
  | AndPredicate
  | OrPredicate
  | NotPredicate;

// --- Queries ----------------------------------------------------------------

/** Select Markdown links (including wikilinks) from the resolved sources. */
export type LinkQuery = {
  type: "link";
  /** When true, only match embeds (![[...]] or ![](...)). Default: false (match all links). */
  embed?: boolean;
  /** When set, only match links whose target ends with this extension (e.g. ".m4a"). */
  extension?: string;
};

// --- Actions ----------------------------------------------------------------

/**
 * Set a date field on the task only when the field is absent.
 * value: ISO date string or "today" (resolved to ctx.today at run time).
 */
export type SetFieldDateIfMissingAction = {
  type: "task.setFieldDateIfMissing";
  key: string;
  value: string;
};

/**
 * Replace a date field value when it matches `from`.
 * from: raw literal to match in the file (e.g. "today").
 * to:   replacement — ISO date string or "today" (resolved at run time).
 */
export type ReplaceFieldDateValueAction = {
  type: "task.replaceFieldDateValue";
  key: string;
  from: string;
  to: string;
};

/**
 * Escape hatch for side effects that need the full set of matched tasks.
 * Called once per RuleSpec run, with all tasks selected across all source
 * files. No-op (and not called) when no tasks were matched.
 * `readFile` reads from the in-memory transform queue so staged-but-not-yet-
 * flushed content is visible. `dryRun` lets implementations skip side effects.
 * `log` routes output through the runner's report mechanism; prefer it over
 * console.log so previews appear in the returned report string.
 */
export type CustomAction = {
  type: "custom";
  run: (args: {
    tasks: Task[];
    /**
     * Files that participated in this query. `frontmatter` is mutable and
     * shared across custom actions in this run; edits are persisted to output.
     */
    files: Array<{
      path: string;
      frontmatter: Record<string, unknown>;
    }>;
    dryRun: boolean;
    vaultPath: string;
    config?: Config;
    readFile: (path: string) => Promise<string>;
    stageChange: (change: FileChange) => void;
    log: (msg: string) => void;
  }) => Promise<void>;
};

/**
 * Remove the task from the document entirely.
 * Used by removeEphemeralOverdueTasks to delete ephemeral tasks that have
 * passed their due date without being completed.
 */
export type RemoveTaskAction = { type: "task.remove" };

/**
 * For each audio embed matched by a LinkQuery: derive the sibling transcript
 * path, insert a transcript embed into the source note if absent, create a
 * placeholder transcript file if it does not exist, and enqueue a
 * transcription job when the placeholder is newly created.
 */
export type EnsureSiblingTranscriptAction = {
  type: "link.ensureSiblingTranscript";
};

/**
 * Enqueue a transcription job for each audio embed matched by a LinkQuery.
 * Used in conjunction with `link.ensureSiblingTranscript`.
 */
export type RequestTranscriptionAction = {
  type: "link.requestTranscription";
};
