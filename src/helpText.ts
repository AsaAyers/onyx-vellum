export const helpText = `\
Usage:
  VAULT_PATH=<path> onyx-vellum [--dry-run] [--verbose] [--only <glob>] (all | <rule> [<rule>...])
  VAULT_PATH=<path> onyx-vellum --watch [--dry-run] [--verbose] (all | <rule> [<rule>...])
  VAULT_PATH=<path> onyx-vellum --init [--dry-run]

Rules:
  all                      Run all registered rules in dependency order.
  <rule> [<rule>...]       Run only the named rule(s) and their transitive dependencies.

Available rules:
  normalizeTodayLiteral    Replace relative date literals (today/yesterday/tomorrow)
                           with resolved ISO dates in inline date fields.
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
  --init                   Convert any UTF-16-encoded .md files to UTF-8
                            and stamp done:unknown on checked tasks that
                            lack one.
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

  # Normalize formatting and stamp done on checked tasks
  VAULT_PATH=/my/vault onyx-vellum --init --dry-run
`;
