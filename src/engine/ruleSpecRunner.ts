import { join, relative } from "node:path";
import { parseMarkdown, stringifyMarkdown } from "../markdown/parse.js";
import { joinFrontmatter, splitFrontmatter } from "../markdown/frontmatter.js";
import type { SplitFrontmatterResult } from "../markdown/frontmatter.js";
import type { List, ListItem } from "mdast";
import {
  extractTasks,
  insertTaskAfter,
  removeTask,
  setTaskChecked,
  updateTaskText,
  getListItemText,
} from "../markdown/tasks.js";
import { visit } from "unist-util-visit";
import type { Task } from "../markdown/tasks.js";
import { getInlineField } from "../markdown/inlineFields.js";
import { extractMarkdownLinks, matchesLinkQuery } from "../markdown/links.js";
import type { MarkdownLink } from "../markdown/links.js";
import { parseDateStr } from "../rules/scheduleUtils.js";
import { walkMarkdownFiles } from "./io.js";
import { resolveToValue } from "./actions/dateHelpers.js";
import { applyAdvanceRepeat } from "./actions/advanceRepeat.js";
import { applyCustom } from "./actions/custom.js";
import { applyEnsureSiblingTranscript } from "./actions/ensureSiblingTranscript.js";
import { applyRemoveTask } from "./actions/removeTask.js";
import { applyReplaceFieldDateValue } from "./actions/replaceFieldDateValue.js";
import { applyRequestTranscription } from "./actions/requestTranscription.js";
import { applyRollover } from "./actions/rollover.js";
import { applySetFieldDateIfMissing } from "./actions/setFieldDateIfMissing.js";
import type { ActionOutcome, LinkActionContext } from "./actions/types.js";
import { unreachable } from "../unreachable.js";
import type {
  Action,
  FileChange,
  GlobSource,
  PathSource,
  Query,
  RuleContext,
  RuleSpec,
  Source,
  TaskPredicate,
} from "../rules/types.js";
import type { TranscriptionJob } from "../transcription/types.js";

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

/**
 * Minimal glob matcher that supports the patterns the engine needs:
 *   **\/*.ext  — any file with the given extension, anywhere in the tree
 *   *.ext      — files with the given extension in the root dir only
 *   dir/**    — all files under dir/, at any depth
 *
 * Processes the pattern character-by-character to avoid ordering issues that
 * arise when chained string replacements modify tokens injected by earlier
 * replacement passes.
 */
function matchesGlob(relPath: string, pattern: string): boolean {
  // Normalize path separators so the function works on Windows too.
  const p = relPath.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");

  let regexStr = "";
  let i = 0;
  while (i < pat.length) {
    const ch = pat[i];
    if (ch === "*" && pat[i + 1] === "*" && pat[i + 2] === "/") {
      // **/ → any directory prefix (zero or more path segments)
      regexStr += "(?:.+/)?";
      i += 3;
    } else if (ch === "*" && pat[i + 1] === "*") {
      // ** at end of pattern or followed by a non-/ character → match any
      // sequence of characters, including path separators.
      regexStr += ".*";
      i += 2;
    } else if (ch === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      // Escape regex metacharacters that are literal in globs.
      regexStr += `\\${ch}`;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`).test(p);
}

async function resolveSource(
  vaultPath: string,
  source: GlobSource | PathSource,
): Promise<string[]> {
  if (source.type === "path") {
    return [join(vaultPath, source.value)];
  }
  // glob
  const allFiles = await walkMarkdownFiles(vaultPath);
  const excluded = source.exclude ?? [];
  return allFiles.filter(
    (f) =>
      matchesGlob(relative(vaultPath, f), source.pattern) &&
      !excluded.some((ex) => matchesGlob(relative(vaultPath, f), ex)),
  );
}

async function resolveSources(
  vaultPath: string,
  sources: Source[],
): Promise<string[]> {
  const pathSets = await Promise.all(
    sources.map((s) => resolveSource(vaultPath, s)),
  );
  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of pathSets.flat()) {
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Shared file-processing helpers
// ---------------------------------------------------------------------------

/**
 * Apply glob source rules and the `onlyGlob` filter; return absolute file
 * paths that are safe to process (.md only).
 */
async function resolveEffectiveSourcePaths(
  sources: RuleSpec["sources"],
  vaultPath: string,
  onlyGlob?: string[],
): Promise<string[]> {
  const filePaths = await resolveSources(vaultPath, sources);

  const effectivePaths =
    onlyGlob === undefined
      ? filePaths
      : filePaths.filter((p) =>
          onlyGlob.some((g) => matchesGlob(relative(vaultPath, p), g)),
        );
  for (const p of effectivePaths) {
    if (!p.endsWith(".md")) {
      throw new Error(
        `Engine only processes .md files; refusing to process: ${p}`,
      );
    }
  }

  return effectivePaths;
}

/**
 * Read a file from the staged queue (or disk) and split it into frontmatter
 * and body. Returns `null` if the file cannot be read or is empty.
 */
async function loadMarkdownSourceFile(
  filePath: string,
  readFile: (path: string) => Promise<string>,
): Promise<{ raw: string; parts: SplitFrontmatterResult } | null> {
  let raw: string;
  try {
    raw = await readFile(filePath);
  } catch {
    return null;
  }
  if (!raw) return null;
  const parts = splitFrontmatter(raw);
  return { raw, parts };
}

/**
 * Produce a `FileChange` when `newContent` differs from `originalContent`;
 * return `null` when there is no change.
 */
function buildMarkdownFileChange(
  filePath: string,
  originalContent: string,
  newContent: string,
): FileChange | null {
  if (newContent === originalContent) return null;
  return { path: filePath, content: newContent };
}

/**
 * Maintain a single staged change per path.
 * Some paths are emitted earlier from task/link actions and then updated again
 * after custom actions mutate frontmatter objects.
 * The staged change set is typically small (rule-local markdown files), so a
 * linear lookup keeps this simple without measurable overhead.
 */
function upsertFileChange(changes: FileChange[], change: FileChange): void {
  const existingIndex = changes.findIndex((c) => c.path === change.path);
  if (existingIndex >= 0) {
    changes[existingIndex] = change;
    return;
  }
  changes.push(change);
}

function countLines(text: string): number {
  return (text.match(/\n/g)?.length ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Predicate evaluation
// ---------------------------------------------------------------------------

function evaluatePredicate(
  task: Task,
  predicate: TaskPredicate,
  today: Date,
): boolean {
  switch (predicate.type) {
    case "checked":
      return task.checked;
    case "unchecked":
      return !task.checked;
    case "fieldExists":
      return getInlineField(task.text, predicate.key) !== undefined;
    case "fieldEquals":
      return getInlineField(task.text, predicate.key) === predicate.value;
    case "fieldDateBefore": {
      const raw = getInlineField(task.text, predicate.key);
      if (!raw) return false;
      const fieldDate = parseDateStr(raw);
      const targetDate = parseDateStr(resolveToValue(predicate.date, today));
      if (!fieldDate || !targetDate) return false;
      return fieldDate < targetDate;
    }
    case "fieldDateAfter": {
      const raw = getInlineField(task.text, predicate.key);
      if (!raw) return false;
      const fieldDate = parseDateStr(raw);
      const targetDate = parseDateStr(resolveToValue(predicate.date, today));
      if (!fieldDate || !targetDate) return false;
      return fieldDate > targetDate;
    }
    case "and":
      return predicate.predicates.every((p) =>
        evaluatePredicate(task, p, today),
      );
    case "or":
      return predicate.predicates.some((p) =>
        evaluatePredicate(task, p, today),
      );
    case "not":
      return !evaluatePredicate(task, predicate.predicate, today);
  }
}

// ---------------------------------------------------------------------------
// Action application
// ---------------------------------------------------------------------------

function applyAction(
  item: ListItem | undefined,
  parentList: List | undefined,
  taskText: string,
  action: Action,
  today: Date,
  link?: MarkdownLink,
  linkCtx?: LinkActionContext,
): ActionOutcome {
  switch (action.type) {
    case "task.setFieldDateIfMissing":
      return applySetFieldDateIfMissing(taskText, action, today);
    case "task.replaceFieldDateValue":
      return applyReplaceFieldDateValue(taskText, action, today);
    case "task.advanceRepeat":
      return applyAdvanceRepeat(taskText, action, today);
    case "task.rollover":
      if (item && parentList) {
        return applyRollover(item, parentList, action, today);
      } else {
        throw new Error("applyRollover requires ListItem and parent List");
      }
    case "task.remove":
      return applyRemoveTask(taskText, action);
    case "custom":
      return applyCustom(taskText, action);
    case "link.ensureSiblingTranscript":
      return applyEnsureSiblingTranscript(taskText, action, link, linkCtx);
    case "link.requestTranscription":
      return applyRequestTranscription(taskText, action, link, linkCtx);
    default:
      return unreachable(action);
  }
}

// ---------------------------------------------------------------------------
// Internal query result types
// ---------------------------------------------------------------------------

type TaskQueryResult = {
  type: "tasks";
  filePath: string;
  raw: string;
  parts: SplitFrontmatterResult;
  tree: ReturnType<typeof parseMarkdown>;
  selectedTasks: Task[];
  currentBody: string;
};

type LinkQueryResult = {
  type: "links";
  filePath: string;
  raw: string;
  parts: SplitFrontmatterResult;
  matchedLinks: MarkdownLink[];
  currentBody: string;
};

type QueryResult = TaskQueryResult | LinkQueryResult;

// ---------------------------------------------------------------------------
// Query phase
// ---------------------------------------------------------------------------

/**
 * For each source file, run the query and return a `QueryResult` describing
 * which tasks or links were selected.  The caller then hands these results to
 * `runActions` which applies the configured actions uniformly.
 */
async function runQuery(
  query: Query,
  filePaths: string[],
  ctx: RuleContext,
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];

  for (const filePath of filePaths) {
    const loaded = await loadMarkdownSourceFile(filePath, ctx.readFile);
    if (!loaded) continue;
    const { raw, parts } = loaded;

    if (query.type === "tasks") {
      const tree = parseMarkdown(parts.body);
      const allTasks = extractTasks(tree, relative(ctx.vaultPath, filePath));
      const selectedTasks = query.predicate
        ? allTasks.filter((t) =>
            evaluatePredicate(t, query.predicate!, ctx.today),
          )
        : allTasks;
      results.push({
        type: "tasks",
        filePath,
        raw,
        parts,
        tree,
        selectedTasks,
        currentBody: parts.body,
      });
    } else {
      // link query
      const links = extractMarkdownLinks(parts.body);
      const matchedLinks = links.filter((l) => matchesLinkQuery(l, query));
      if (matchedLinks.length > 0) {
        results.push({
          type: "links",
          filePath,
          raw,
          parts,
          matchedLinks,
          currentBody: parts.body,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Actions phase
// ---------------------------------------------------------------------------

/**
 * Apply the rule's configured actions to every item in `queryResults` and
 * return the resulting file changes.
 *
 * For task results: each matched task is mutated in the AST, then the file is
 * serialised if anything changed.  CustomAction side effects are fired once
 * with the complete set of matched tasks across all files.
 *
 * For link results: link actions are called for each matched link; any body
 * mutations and new files produced are collected and staged.
 */
async function runActions(
  actions: Action[],
  queryResults: QueryResult[],
  ctx: RuleContext,
): Promise<{
  changes: FileChange[];
  summary: string;
  transcriptionJobs: TranscriptionJob[];
}> {
  const changes: FileChange[] = [];
  const transcriptionJobs: TranscriptionJob[] = [];
  let totalTasksModified = 0;
  let totalLinksMatched = 0;
  let totalTranscriptionJobs = 0;
  const allSelectedTasks: Task[] = [];

  for (const result of queryResults) {
    if (result.type === "tasks") {
      const { filePath, raw, parts, tree, selectedTasks } = result;
      const { today } = ctx;
      let modified = 0;

      for (const task of selectedTasks) {
        let newText = task.text;
        let shouldUncheck = false;
        let insertDuplicateText: string | undefined;
        let shouldRemove = false;
        let foundItem: ListItem | undefined = undefined;
        let foundParent: List | undefined = undefined;
        visit(tree, "list", (listNode: List) => {
          const idx = listNode.children.findIndex((item: ListItem) => {
            return getListItemText(item) === task.text;
          });
          if (idx !== -1) {
            foundItem = listNode.children[idx];
            foundParent = listNode;
          }
        });
        for (const action of actions) {
          const outcome = applyAction(
            foundItem,
            foundParent,
            newText,
            action,
            today,
          );
          newText = outcome.text;
          if (outcome.uncheck) shouldUncheck = true;
          if (outcome.insertDuplicateAfter !== undefined)
            insertDuplicateText = outcome.insertDuplicateAfter;
          if (outcome.remove) shouldRemove = true;
        }
        if (shouldRemove) {
          removeTask(tree, task.text);
          modified++;
          continue;
        }
        const textChanged = newText !== task.text;
        if (textChanged) {
          updateTaskText(tree, task.text, newText);
        }
        if (shouldUncheck) {
          setTaskChecked(tree, newText, false);
        }
        // Insert the clone immediately after the (possibly updated) original task.
        if (insertDuplicateText !== undefined) {
          insertTaskAfter(tree, newText, insertDuplicateText, false);
        }
        if (textChanged || shouldUncheck || insertDuplicateText !== undefined) {
          modified++;
        }
      }

      if (modified > 0) {
        result.currentBody = stringifyMarkdown(tree);
        const newContent = joinFrontmatter(parts, result.currentBody);
        const change = buildMarkdownFileChange(filePath, raw, newContent);
        if (change) {
          upsertFileChange(changes, change);
          totalTasksModified += modified;
        }
      }

      allSelectedTasks.push(...selectedTasks);
    } else {
      // link result
      const { filePath, raw, parts, matchedLinks } = result;
      totalLinksMatched += matchedLinks.length;
      let currentBody = result.currentBody;
      let lineOffset = 0;

      for (const link of matchedLinks) {
        for (const action of actions) {
          const currentLink: MarkdownLink = {
            ...link,
            lineIndex: link.lineIndex + lineOffset,
          };
          const linkCtx: LinkActionContext = {
            vaultPath: ctx.vaultPath,
            sourceNotePath: filePath,
            today: ctx.today,
            jobIdFactory: ctx.jobIdFactory,
          };
          const beforeBody = currentBody;
          const outcome = applyAction(
            undefined, // ListItem
            undefined, // List
            currentBody,
            action,
            ctx.today,
            currentLink,
            linkCtx,
          );
          if (outcome.updatedBody !== undefined) {
            currentBody = outcome.updatedBody;
            lineOffset += countLines(currentBody) - countLines(beforeBody);
          }
          if (outcome.newFiles) {
            for (const [path, content] of Object.entries(outcome.newFiles)) {
              changes.push({ path, content });
            }
          }
          if (outcome.transcriptionJobs) {
            totalTranscriptionJobs += outcome.transcriptionJobs.length;
            transcriptionJobs.push(...outcome.transcriptionJobs);
          }
        }
      }

      result.currentBody = currentBody;
      const newContent = joinFrontmatter(parts, currentBody);
      const change = buildMarkdownFileChange(filePath, raw, newContent);
      if (change) {
        upsertFileChange(changes, change);
      }
    }
  }

  // Fire CustomAction side effects once with ALL matched tasks across all files.
  if (allSelectedTasks.length > 0) {
    const logFn = ctx.log ?? console.log;
    for (const action of actions) {
      if (action.type === "custom") {
        await action.run({
          tasks: allSelectedTasks,
          files: queryResults.map((result) => ({
            path: result.filePath,
            frontmatter: result.parts.data,
          })),
          dryRun: ctx.dryRun,
          vaultPath: ctx.vaultPath,
          config: ctx.config,
          readFile: ctx.readFile,
          stageChange: (change) => upsertFileChange(changes, change),
          log: logFn,
        });
      }
    }
    for (const result of queryResults) {
      const newContent = joinFrontmatter(result.parts, result.currentBody);
      const change = buildMarkdownFileChange(
        result.filePath,
        result.raw,
        newContent,
      );
      if (change) {
        upsertFileChange(changes, change);
      }
    }
  }

  const summary =
    totalLinksMatched > 0
      ? totalTranscriptionJobs > 0
        ? `Processed ${totalLinksMatched} link(s) and enqueued ${totalTranscriptionJobs} transcription job(s) across ${changes.length} file(s).`
        : `Processed ${totalLinksMatched} link(s) across ${changes.length} file(s).`
      : `Modified ${totalTasksModified} task(s) across ${changes.length} file(s).`;

  return { changes, summary, transcriptionJobs };
}

// ---------------------------------------------------------------------------
// Public runner
// ---------------------------------------------------------------------------

export async function runRuleSpec(
  spec: RuleSpec,
  ctx: RuleContext,
): Promise<{
  changes: FileChange[];
  summary: string;
  transcriptionJobs: TranscriptionJob[];
}> {
  const filePaths = await resolveEffectiveSourcePaths(
    spec.sources,
    ctx.vaultPath,
    ctx.onlyGlob,
  );
  const queryResults = await runQuery(spec.query, filePaths, ctx);
  return runActions(spec.actions, queryResults, ctx);
}
