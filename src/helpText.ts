export const helpText = `\
Usage:
  VAULT_PATH=<path> onyx-vellum [--dry-run] [--verbose] [--only <glob>] (all | alert)
  VAULT_PATH=<path> onyx-vellum --watch [--dry-run] [--verbose]
  VAULT_PATH=<path> onyx-vellum --init [--dry-run]
  VAULT_PATH=<path> onyx-vellum --worker
  VAULT_PATH=<path> onyx-vellum --view-ast <file>

Commands:
  (default)                Run the pipeline.  Specify "all" (full pipeline)
                             or "alert" (incomplete-task report only).

Available rules:
  normalizeTodayLiteral    Replace relative date literals (today/yesterday/tomorrow)
                           and repeat-pattern shorthands with resolved ISO
                           dates in inline date fields.
  stampDone                Stamp done:<date> on checked tasks that lack one.
                           Depends on: normalizeTodayLiteral.
  repeatTasks    Advance due/start/sleep on repeating completed tasks and
                           uncheck them for the next cycle.
  moveDoneTasks
                            Move checked transcript tasks with done:<date> into
                            existing daily notes (configurable folder).
  sortTasks                Sort same-level task lists so incomplete tasks stay
                           on top and completed tasks are ordered newest-first.
  ensureAudioTranscripts   For embedded .m4a links, ensure sibling transcript
                           embeds/files and enqueue transcription jobs.
  incompleteTaskAlert      Write overdue/incomplete tasks and optionally POST
                            using rules.incompleteTaskAlert.alertUrl in config.
                            Current-file frontmatter can further filter and
                            gate alerts with alertIf and alertThreshold.
                            alertIf uses the shared date resolver, so the
                            right-hand side can be today/yesterday/tomorrow or
                            a repeat-pattern shorthand.

Note:
  Task management works without Docker or GPU. The GPU worker is only
  needed for audio transcription. Docker Compose starts both the watcher
  and the worker together.

Options:
  --dry-run                Print unified diffs to stdout; do not write any files.
  --verbose                Show rule-progress logs and the run summary (normally
                           suppressed in --dry-run mode).
  --only <glob>            Replace the default "**/*.md" source list with a
                             single glob or file path (relative to VAULT_PATH).
                             Per-rule "sources" in .onyx-vellum.json still
                             apply independently: a file must pass both the
                             --only filter AND the rule's own sources to be
                             processed. In watch mode the changed-file path
                             is always used as the implicit --only filter.
  --watch                  Watch vault markdown files for changes and automatically
                           run selected rules after the vault has been idle for
                           the debounce period (default 60 s).  Only changed files
                           are processed. Uses a native filesystem watcher (no polling).
                            Not compatible with --init.
                            The debounce duration is configurable via
                            .onyx-vellum.json:
                              {
                                "watch": {
                                  "debounce": 5000
                                }
                              }
  --init                   Run the full pipeline against every file in the
                             vault to produce a stable baseline.  After init,
                             subsequent pipeline runs only show changes from
                             intentional user edits rather than formatting
                             adjustments on old files.
                             Mutually exclusive with rule selection and --watch.
  --help, -h               Show this help message and exit.

Environment variables:
  VAULT_PATH               (required) Absolute path to the vault root.
                           Can be any directory containing .md files —
                           Obsidian is not required.
  OLLAMA_HOST              Ollama API host for LLM-powered operations
                           (clean transcript, task extraction).
                           Default: http://ollama-api:11434

Config:
  .onyx-vellum.json        Configure rule sources and optional timezone in JSON.
                            Example timezone:
                            {
                              "timezone": "America/New_York"
                            }
                             For alerts, set:
                             {
                               "rules": {
                                "incompleteTaskAlert": {
                                  "alertUrl": "http://localhost:8080/alert",
                                  "alertToken": "<optional bearer token>"
                                }
                              }
                            }
                           File-level frontmatter can then refine alerts, for
                           example:
                             ---
                             alertIf: due<=today
                             alertThreshold: 2
                             ---

Examples:
  # Run every rule against the vault
  VAULT_PATH=/my/vault onyx-vellum all

  # Dry-run every rule (shows diffs, writes nothing)
  VAULT_PATH=/my/vault onyx-vellum --dry-run all

  # Run only stampDone (normalizeTodayLiteral runs first automatically
  # because it is a declared dependency of stampDone)
  VAULT_PATH=/my/vault onyx-vellum --dry-run stampDone

  # Run all rules but only process files under notes/
  VAULT_PATH=/my/vault onyx-vellum --dry-run --only "notes/**" all

  # Watch vault for changes and run all rules on each changed file
  VAULT_PATH=/my/vault onyx-vellum --watch all

  # Watch with dry-run (show diffs on each change, write nothing)
  VAULT_PATH=/my/vault onyx-vellum --watch --dry-run all

  # Baseline the vault — normalise formatting, stamp done dates, etc.
  VAULT_PATH=/my/vault onyx-vellum --init --dry-run
`;
