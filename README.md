# onyx-vellum

**CLI tool** — not an Obsidian plugin. It watches a folder of Markdown files
(an Obsidian vault or any other directory) and applies AST-based transformations
using the [unified/remark](https://github.com/remarkjs/remark) ecosystem.

## About

This is a personal project exploring the use of remark/unified to manage tasks
in an [Obsidian](https://obsidian.md/) vault. It is not intended as a replacement
for Obsidian community plugins (Tasks, Dataview, etc.) — those are better
integrated solutions. The motivation was:

- **Learn by building** — understanding AST-based Markdown processing, task
  scheduling, and how to wire remark plugins together.
- **Transcription pipeline** — GPU-accelerated voice note transcription that
  runs on a home server, with task extraction from transcripts.
- **AI tooling experiments** — using LLMs to help develop and improve the project.

The tool operates on the filesystem directly. It does not know about Obsidian's
internal APIs or plugin system. You can use it with any Markdown editor.

## Inline Fields

Tasks in any `.md` file in the vault may carry **inline fields** — `key:value` tokens embedded in the task text. All date-valued fields use the `YYYY-MM-DD` format.

| Field       | Example            | Description                                                      |
| ----------- | ------------------ | ---------------------------------------------------------------- |
| `done`      | `done:2026-05-03`  | Date the task was checked off. Stamped automatically by Rule 2.  |
| `due`       | `due:2026-05-10`   | Target/deadline date. Set automatically on repeat.               |
| `start`     | `start:2026-05-04` | Task should not be surfaced before this date.                    |
| `sleep`     | `sleep:2026-05-06` | Suppress surfacing until this date (stronger than `start`).      |
| `repeat`    | `repeat:1s`        | Recurrence schedule (see grammar below).                         |
| `copied`    | `copied:1`         | Marker set by `repeatTasks` to prevent duplicate cloning.        |
| `ephemeral` | `ephemeral:1`      | Marks a task as ephemeral — auto-removed if missed (see Rule 5). |

### `repeat` grammar

```
repeat := <skipWeeks>? <days>
skipWeeks := one or more decimal digits   (number of weeks to skip; default 0)
days      := "d" | [smtwhfa]+
             ("d" is a daily shorthand for all seven days)
```

Weekday alphabet: `s`=Sunday · `m`=Monday · `t`=Tuesday · `w`=Wednesday · `h`=Thursday · `f`=Friday · `a`=Saturday

**Daily shorthand `d`** is an alias for `smtwhfa` (all seven days). The two
forms are completely interchangeable; prefer `d` for brevity.

**Examples:**

| Value            | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `repeat:d`       | Daily (every day, skipWeeks=0) — shorthand for `smtwhfa`           |
| `repeat:smtwhfa` | Daily (every day, skipWeeks=0) — explicit form                     |
| `repeat:1d`      | Daily with 1-week skip — completing on Tue schedules Wed next week |
| `repeat:s`       | Weekly on Sunday (skipWeeks=0)                                     |
| `repeat:1s`      | Every other Sunday — skip 1 week, then next Sunday                 |
| `repeat:2mwf`    | Skip 2 weeks then schedule on the next Mon, Wed, or Fri            |

**Next-due algorithm:**

```
offset  = skipWeeks === 0 ? 1 : skipWeeks × 7 − 1
minDate = done + offset
newDue  = first date ≥ minDate whose weekday is in <days>
```

The `(n × 7 − 1)` offset for n > 0 keeps the task anchored to roughly the same weekday each cycle — completing a `repeat:1mwf` task on Monday produces a next due of Monday (~1 week later), not Tuesday.

When a repeating task is completed, `due:` is always set to `newDue`. If `start:` or `sleep:` are present they are shifted forward by the same number of days as `due` moved (`delta = newDue − oldDue`; if no `due:` existed, `oldDue = done`).

**Migration from `repeat:smtwhfa`:** replace with `repeat:d`. No other changes required.

## Vault Configuration (`.onyx-vellum.json`)

On first run, `onyx-vellum` creates a `.onyx-vellum.json` file in your vault root populated with the default `sources` for every built-in rule. You can edit this JSON to customise which files each rule processes, alert delivery settings, and watch-mode options.

### Config shape

```json
{
  "timezone": "America/New_York",
  "watch": {
    "debounce": 60000,
    "alertSchedule": ["09:00"]
  },
  "rules": {
    "normalizeTodayLiteral": {
      "sources": [{ "type": "glob", "pattern": "**/*.md" }]
    },
    "stampDone": {
      "sources": [{ "type": "glob", "pattern": "**/*.md" }]
    },
    "repeatTasks": {
      "sources": [{ "type": "glob", "pattern": "**/*.md" }]
    },
    "removeEphemeralOverdueTasks": {
      "sources": [{ "type": "glob", "pattern": "**/*.md" }]
    },
    "moveDoneTasks": {
      "sources": [{ "type": "glob", "pattern": "**/*.transcript.md" }],
      "dailyNotesFolder": "daily"
    },
    "sortTasks": {
      "sources": [{ "type": "glob", "pattern": "**/*.md" }]
    },
    "ensureAudioTranscripts": {
      "sources": [{ "type": "glob", "pattern": "**/*.md" }]
    },
    "incompleteTaskAlert": {
      "sources": [
        {
          "type": "glob",
          "pattern": "**/*.md",
          "exclude": ["archive/**", "templates/**"]
        }
      ],
      "alertUrl": "http://localhost:8080/alert",
      "alertToken": "optional-token"
    }
  }
}
```

`timezone` is optional and must be a valid IANA timezone (for example
`"America/New_York"` or `"UTC"`). When set, all date-sensitive processing
(`today`/`yesterday`/`tomorrow`, repeatTasks comparisons, and watch alert schedule
times) is evaluated in that timezone instead of the server's local timezone.

### Source types

| Type     | Fields                                           | Description                                                                                                        |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `"glob"` | `pattern` (required), `exclude` (optional array) | Matches files using a glob pattern relative to the vault root. `exclude` patterns are also relative to vault root. |
| `"path"` | `value` (required)                               | A single concrete file path relative to the vault root.                                                            |

Per-rule sources interact with the `--only` CLI flag: `--only` replaces the
default top-level source list (`**/*.md`), but each rule's own `sources` still
gate independently. A file is only processed if it passes both filters.

### Disabling a rule

Set a rule's `sources` to an empty array `[]` to disable it entirely. The rule
will be skipped during pipeline runs.

### Auto-migration

When a new rule is added in a future release, its default entry is merged into `rules` in your existing `.onyx-vellum.json` automatically on the next run. You do not need to edit the file by hand unless you want a non-default value.

### Validation

The file is validated with [zod](https://zod.dev/) on every run. If the file is malformed or contains an invalid source type the run aborts with a clear error message. Fix or delete the file and re-run.

## Watch Mode (`--watch`)

The `--watch` flag keeps the process running and automatically applies the selected rules whenever a vault markdown file changes.

```bash
# Watch the vault and run all rules on each changed file
VAULT_PATH=/my/vault onyx-vellum --watch all

# Watch with dry-run (show diffs, write nothing)
VAULT_PATH=/my/vault onyx-vellum --watch --dry-run all

# Watch and apply only specific rules on changes
VAULT_PATH=/my/vault onyx-vellum --watch stampDone
```

### How it works

1. **Native watcher** — Uses Node.js's built-in `fs.watch()` with `recursive: true`. No polling is ever used.
2. **Per-file debouncing** — When a `.md` file changes, a debounce timer starts for that file. If the file changes again before the timer expires the timer resets. Rules are only run after the file has been idle for the full debounce period.
3. **Targeted processing** — Only the changed file is processed (the watcher passes the changed path as the `--only` filter). The rest of the vault is not touched.

### Log output

| Log line                                      | Meaning                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `[watch] change: notes/foo.md`                | A change event was received for `notes/foo.md`; debounce timer started/reset. |
| `[watch] Processing after idle: notes/foo.md` | Debounce timer expired; rules are about to run for `notes/foo.md`.            |
| `[watch] Error processing notes/foo.md: …`    | An error occurred while running rules for the file.                           |

### Two-pass processing (fast vs. full)

In watch mode, changed files go through two debounced passes:

1. **Fast pass** (~5–10 s debounce) — runs a subset of lightweight rules that
   make small, intentional changes: `inlineFields`, `normalizeTodayLiteral`,
   `commands`, and `ensureAudioTranscripts`. These fire quickly so you get
   immediate feedback (e.g. a `#onyx/transcribe` tag is removed seconds after
   you type it). Exponential backoff means rapid typing delays this pass further.

2. **Full pass** (~30–60 s debounce, configurable) — runs the complete rule
   set including `stampDone`, `repeatTasks`, `removeEphemeralOverdueTasks`,
   `moveDoneTasks`, and `sortTasks`. These are more invasive (reformatting,
   moving tasks between files) and intentionally delayed to avoid conflicts
   with active editing.

Only rules in the fast pass run on individual file edits. If you add a new rule
and want it to respond quickly in watch mode, register it in the `fast` block
in `createParseProcessor.ts`. Otherwise it runs only on the full debounce batch.

### Debounce configuration

The debounce duration defaults to **60 seconds** and can be changed via the `watch.debounce` key in `.onyx-vellum.json`:

```json
{
  "watch": {
    "debounce": 5000
  }
}
```

Set `debounce` to the number of milliseconds the file must be idle before rules are triggered. Shorter values give faster feedback; the default 60 s is suitable for vaults edited by Obsidian, which can produce many rapid save events for a single logical edit.

### Compatibility

- `--watch` is **not** compatible with `--init`. Use them in separate invocations.
- `--watch` can be combined with `--dry-run` and `--verbose`.
- `--watch` ignores `--only`; the changed-file path is always used as the implicit filter instead.

## Environment Variables

| Variable      | Required | Default                      | Description                                       |
| ------------- | -------- | ---------------------------- | ------------------------------------------------- |
| `VAULT_PATH`  | **Yes**  | —                            | Absolute path to the Obsidian vault root          |
| `STATE_DIR`   | No       | sibling `.onyx-vellum-state` | Filesystem queue root for transcription job state |
| `OLLAMA_HOST` | No       | `http://ollama-api:11434`    | Ollama API host for LLM-powered operations        |

## Docker / Docker Compose

`docker-compose.yml` starts:

- `onyx-vellum` — the main watch-mode pipeline
- `transcriber-worker` — a long-running GPU transcription worker

An [Ollama](https://ollama.ai/) host is required for transcript cleaning and
task extraction. It is **not** included in the Compose file — see the Ollama
section below for configuration.

Both services mount the vault at `/vault` and share a named `state` volume at
`/state`. The queue lives in `/state` instead of inside the vault, so pending /
processing / done / failed job files do not pollute your notes.

### Prerequisites

- Docker with Compose support
- An NVIDIA GPU on the host
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)

### Start the full stack

Set `VAULT_PATH` to your vault directory and start both services:

```bash
VAULT_PATH=/path/to/your/vault docker compose up --build
```

This mounts your vault at `/vault`, mounts the shared queue state at `/state`,
starts `onyx-vellum --watch all`, and starts the GPU worker in the same
compose project. If `VAULT_PATH` is not set it defaults to `./vault` (a
`vault/` directory next to `docker-compose.yml`).

The worker image includes Python, `faster-whisper`, and FFmpeg, and is
preconfigured to use the `large-v3` model with CUDA (`float16`). Model downloads
are cached under `/state/faster-whisper-cache`, so they stay outside the vault
and survive container restarts.

### One-off commands with arbitrary arguments

Use `docker compose run --rm` to pass any CLI arguments instead of the default
watch invocation:

```bash
# Dry-run all rules once
VAULT_PATH=/path/to/your/vault docker compose run --rm onyx-vellum --dry-run all

# Run the pipeline once and exit
VAULT_PATH=/path/to/your/vault docker compose run --rm onyx-vellum all

# Watch with dry-run
VAULT_PATH=/path/to/your/vault docker compose run --rm onyx-vellum --watch --dry-run all
```

### Build the image

```bash
docker compose build
```

### Ollama dependency

The worker's transcript cleaning and task extraction operations use an
[Ollama](https://ollama.ai/) LLM backend. The Docker Compose file assumes
Ollama is available at `http://host.docker.internal:11434` (the Docker host).
If your Ollama runs in a separate container on the same Docker network, set
`OLLAMA_HOST` to its address:

```yaml
environment:
  - OLLAMA_HOST=http://ollama-api:11434
```

When running the worker outside Docker, the default is `http://ollama-api:11434`.
Override it with the `OLLAMA_HOST` environment variable if your Ollama instance
is elsewhere.

The task management rules (stampDone, repeatTasks, sortTasks, etc.) do not
require Ollama — they work on plain Markdown without any LLM dependency.

### Worker service details

The worker runs the built Node entrypoint directly:

```bash
npm start -- --worker
```

Inside that container, the Node worker keeps a long-lived `faster-whisper`
backend process running in the same image. Compose requests one NVIDIA GPU with
the standard device reservation pattern:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

`transcriber-worker` uses `restart: unless-stopped`, so restarting the service
will automatically pick up any stale jobs left in `/state/processing`.

## Global Installation

Install the `onyx-vellum` command globally so you can run it from anywhere:

```bash
npm install -g .
```

> **Note:** The `prepare` script runs `npm run build` automatically, so no
> separate build step is needed before installing.

Then use the installed command:

```bash
# Show help
onyx-vellum --help

# Dry-run all rules against your vault
VAULT_PATH=/path/to/your/vault onyx-vellum --dry-run all

# Run the full pipeline
VAULT_PATH=/path/to/your/vault onyx-vellum all

# Normalize the vault with --init
VAULT_PATH=/path/to/your/vault onyx-vellum --init

# Preview --init changes without writing (dry-run)
VAULT_PATH=/path/to/your/vault onyx-vellum --init --dry-run
```

To uninstall:

```bash
npm uninstall -g onyx-vellum
```

## How to Run

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Show help

```bash
VAULT_PATH=/path/to/your/vault onyx-vellum --help
```

### Run all rules (real mode)

```bash
VAULT_PATH=/path/to/your/vault onyx-vellum all
```

### Run the pipeline

The only positional modes are `all` (run the full pipeline) and `alert` (run
only the `incompleteTaskAlert` plugin).

```bash
VAULT_PATH=/path/to/your/vault onyx-vellum all
```

To restrict which files are processed, use `--only <glob>`:

```bash
VAULT_PATH=/path/to/your/vault onyx-vellum --dry-run --only "daily/**" all
```

`--only` replaces the default `**/*.md` source list with the supplied glob or
file path. Per-rule `sources` in `.onyx-vellum.json` are **still checked**
independently — a file must pass both the `--only` filter AND the rule's own
`sources` to be processed.

### Run with dry-run (prints a unified diff, no files written)

```bash
VAULT_PATH=/path/to/your/vault onyx-vellum --dry-run all
```

```bash
# Dry-run with a file filter
VAULT_PATH=/path/to/your/vault onyx-vellum --dry-run --only "daily/**" all
```

`--dry-run` outputs a unified diff (one patch per changed file, sorted by path) to
stdout without writing anything to disk.

Add `--verbose` to also print rule-progress logs and the run summary:

```bash
VAULT_PATH=/path/to/your/vault onyx-vellum --dry-run --verbose all
```

### Normalize the vault with `--init`

```bash
VAULT_PATH=/path/to/your/vault onyx-vellum --init
```

`--init` scans every `.md` file in the vault and performs two actions:

1. **UTF-16 detection** — files encoded as UTF-16 (with or without BOM) are
   converted to UTF-8. This is a rare edge case (some third-party tools produce
   UTF-16 files), but the conversion is lossless and makes all files compatible
   with the remark pipeline.

2. **Done stamping** — every checked (`[x]`) task that does **not**
   already have a `done:` inline field is stamped with
   `done:unknown`.
   This back-fills a placeholder date for tasks that were
   completed before `--init` was run. The `unknown` value is
   intentionally not a real date, so it is never matched by the
   date-based predicates in the normal rule pipeline (in particular,
   `repeatTasks` will not clone tasks stamped by `--init`).

This is intended to be run once before making rule-driven changes so that
subsequent diffs reflect only intentional semantic edits rather than incidental
encoding noise or missing done fields.

- Only `.md` files are processed; other file types are ignored.
- Hidden directories (e.g. `.git`, `.obsidian`) are skipped automatically.
- A summary line is printed: `Init: scanned N file(s), rewrote M.`

Combine with `--dry-run` to preview which files would be rewritten:

```bash
VAULT_PATH=/path/to/your/vault onyx-vellum --init --dry-run
```

`--init` and the normal rule-pipeline mode are mutually exclusive: use one or
the other per invocation.

### Manual testing without an Obsidian vault

Create any directory with `*.md` files and point `VAULT_PATH` at it:

```bash
mkdir /tmp/test-vault
echo "* [ ] A task due:today" > /tmp/test-vault/test.md
VAULT_PATH=/tmp/test-vault onyx-vellum --dry-run all
```

The tool only needs a folder of Markdown files — it does not require Obsidian.

### Unit testing a rule in isolation

Currently there is no first-class mechanism for testing a single rule outside
the full pipeline. Rules often depend on shared context (`inlineFieldsPlugin`,
`normalizeTodayLiteral`) that must be set up first. The E2E vault test
(`tests/vault.test.ts`) is the primary coverage. Unit tests for pure helper
functions (e.g. `scheduleUtils.ts`) work well; consider writing those for new
parser/utility logic.

### Run tests

```bash
npm test
```

When snapshot tests fail because you changed pipeline output (e.g. after modifying a rule),
re-bless all `.md.expected` files with `UPDATE_EXPECTED`:

```bash
UPDATE_EXPECTED=1 npx vitest run tests/vault.test.ts
```

This writes the current pipeline output to every `.md.expected` file and skips
assertions. Run `npm test` afterwards to confirm everything is green.

### Lint

```bash
npm run lint
```

Auto-fix lint issues:

```bash
npm run lint:fix
```

## Git Hooks (Husky)

A Husky pre-commit hook runs `typecheck → format → lint → test` before every
commit. If any step fails the commit is aborted. The hook is installed
automatically when you run `npm install` (via the `prepare` script).

## Rules

Rules are remark plugins created via `makePlugin()` from `src/rules/makePlugin.ts`
and wired in `src/markdown/createParseProcessor.ts`. Plugins execute in the order
they are `.use()`'d — no declared dependencies or topological sort.

| Rule                          | Source file                                      | What it does                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `normalizeTodayLiteral`       | `src/rules/normalizeTodayPlugin.ts`              | Replaces `today` / `yesterday` / `tomorrow` inline date literals with ISO dates.                                                                             |
| `commands`                    | `src/rules/onyxVellumCommands.ts`                | Processes `#onyx/` command tags — transcribe, extract tasks, summarize.                                                                                      |
| `ensureAudioTranscripts`      | `src/rules/ensureAudioTranscriptsPlugin.ts`      | For each embedded `.m4a`, inserts a mirrored transcript embed, creates a sibling `.transcript.md` placeholder when needed, and enqueues async transcription. |
| `stampDone`                   | `src/rules/stampDonePlugin.ts`                   | Adds `done:YYYY-MM-DD` to newly completed tasks that do not already have one.                                                                                |
| `repeatTasks`                 | `src/rules/repeatTasksPlugin.ts`                 | Clones recurring completed tasks forward to their next cycle.                                                                                                |
| `removeEphemeralOverdueTasks` | `src/rules/removeEphemeralOverdueTasksPlugin.ts` | Removes unchecked overdue tasks marked `ephemeral`.                                                                                                          |
| `moveDoneTasks`               | `src/rules/moveDoneTasksPlugin.ts`               | Moves checked tasks with `done:YYYY-MM-DD` from notes into matching daily notes.                                                                             |
| `sortTasks`                   | `src/rules/sortTasksPlugin.ts`                   | Sorts same-level task lists so incomplete tasks stay at the top, and completed tasks are ordered by newest `done:` date first.                               |
| `incompleteTaskAlert`         | `src/rules/incompleteTaskAlertPlugin.ts`         | Groups incomplete tasks using file-frontmatter filters and optionally posts them to a configured alert endpoint.                                             |

### normalizeTodayLiteral

**Source:** `src/rules/normalizeTodayPlugin.ts`

Replaces relative date literals (`today`, `yesterday`, `tomorrow`) in inline
date fields with resolved ISO dates (`YYYY-MM-DD`). Runs early so all subsequent
rules always operate on real dates.

### commands

**Source:** `src/rules/onyxVellumCommands.ts`

Processes Obsidian tags as commands:

- `#onyx/transcribe` — re-run transcription for an `.m4a` in the same section.
- `#onyx/tasks` — extract tasks from current section and append a "Tasks" section.
- `#onyx/summarize` — enqueue a text summarization job.

Tags are removed from the source note when the job is created.

### ensureAudioTranscripts

**Source:** `src/rules/ensureAudioTranscriptsPlugin.ts`

Scans configured markdown files for embedded `.m4a` audio files and supports
both embed forms:

- Obsidian wikilink embeds: `![[recordings/2024-01-15 12.34.56.m4a]]`
- Standard Markdown embeds: `![](recordings/2024-01-15 12.34.56.m4a)`

For each matching audio embed, the rule derives a sibling transcript file in
the same directory (`<basename>.transcript.md`) and inserts a transcript embed
immediately below the audio line, mirroring the original embed style:

- `![[recordings/foo.m4a]]` → `![[recordings/foo.transcript.md]]`
- `![](recordings/foo.m4a)` → `![](recordings/foo.transcript.md)`

If the transcript file does **not** already exist, the rule creates a pending
placeholder and enqueues a background transcription job. The main rule engine
does not wait for transcription to finish; the worker updates the transcript
file asynchronously once processing succeeds or fails.

If the sibling transcript file already exists, the rule leaves that file
untouched and only inserts the transcript embed into the source note when it is
missing. If the referenced audio file is missing, or the resolved path escapes
the vault root, the embed is skipped without error.

On worker failure the transcript file is replaced with a failure note:

```markdown
# Transcript

Status: failed
Job: <job-id>
Source audio: [[recordings/foo.m4a]]

> Transcription failed.

## Error

<error message>
```

#### Restricting the rule to part of the vault

The rule uses the normal per-rule `sources` config model. For example, to limit
it to `daily/**/*.md`:

```json
{
  "rules": {
    "ensureAudioTranscripts": {
      "sources": [{ "type": "glob", "pattern": "daily/**/*.md" }]
    }
  }
}
```

#### Dry-run behavior

With `--dry-run`, `ensureAudioTranscripts`:

1. Shows the diff for transcript-embed insertion in the source note.
2. Shows the placeholder transcript file content that would be created.
3. Does not write any files.
4. Does not enqueue any jobs.

To run the background GPU worker that fulfills queued jobs, start the Docker
Compose stack described above with `docker compose up --build` (see the Docker /
Docker Compose section for details).

### stampDone

**Source:** `src/rules/stampDonePlugin.ts`

Scans all configured markdown files for completed (checked) tasks and stamps
each one that does **not** already carry a `done:` inline field with
`done:YYYY-MM-DD` (today's date). Ensures every freshly completed task has an
explicit completion date before later rules run.

### repeatTasks

**Source:** `src/rules/repeatTasksPlugin.ts`

Finds every **recurring** checked task (one that has a `repeat:` field) whose
`done:` date equals **today** and that does not already carry a `copied:1`
marker, then:

1. Appends `copied:1` to the completed task so it is not re-processed on
   subsequent runs (idempotency guard).
2. Inserts a fresh **incomplete** copy of the task immediately after the
   completed one, with the clone's date fields (`due`, `start`, `sleep`)
   advanced according to the `repeat:` schedule. The `done:` field is **not**
   included on the clone.

Tasks without a `repeat:` field are **never** duplicated and never receive
`copied:1`, even if they are checked and have a `done:` date.

**Meaning of `copied:1`:** A task marked `copied:1` has already been rolled
over in a previous pipeline run. The repeatTasks rule skips it on all subsequent
runs. Tasks completed before today (i.e. `done:` is an older date) are also
skipped.

### removeEphemeralOverdueTasks

**Source:** `src/rules/removeEphemeralOverdueTasksPlugin.ts`

Removes **unchecked** tasks that carry an `ephemeral` field, have a `due:`
date, and whose due date is **strictly before today** (yesterday or earlier).
A task that was not completed by its deadline is considered expired and is
deleted from the file.

**Behavior:**

- Completed (checked) tasks are **never** removed, even if overdue — if you
  finished it, it stays.
- An ephemeral task with **no `due:` field** is not removed (safe default; no
  deadline means no expiry).
- Idempotent: re-running after removal produces no further changes.
- `--dry-run` shows the diff of what would be removed without writing.

**Usage:**

```markdown
- [ ] Read the article ephemeral:1 due:2026-05-10
```

If today is 2026-05-11 and the task is still unchecked, it is silently deleted
on the next pipeline run.

### moveDoneTasks

**Source:** `src/rules/moveDoneTasksPlugin.ts`

Moves checked tasks with a `done:` date from their current note into the
matching daily note (`daily/<done-date>.md`) when that daily file already
exists on disk. Removes the task from the source file.

Configure the daily notes folder via `rules.moveDoneTasks.dailyNotesFolder` in
`.onyx-vellum.json` (default: `"daily"`).

### sortTasks

**Source:** `src/rules/sortTasksPlugin.ts`

Sorts same-level task lists inline — incomplete tasks stay at the top, then
ordered by `sleep:` (ascending), then `due:` (ascending), then completed tasks
ordered by `done:` descending (newest first).

### incompleteTaskAlert

**Source:** `src/rules/incompleteTaskAlertPlugin.ts`

Finds all **incomplete** (unchecked) tasks that qualify for the current
file's frontmatter alert filter, and writes them to `onyx_alert.md`. Only
runs in `alert` mode.

You can add frontmatter to the file being alerted to tune the behavior:

```md
---
alertIf: due<=today
alertThreshold: 2
priority: low
---
```

`alertIf` is a compact comparison against a frontmatter field using `<=`,
`>=`, or `==`. `alertThreshold` defaults to `1` and controls how many
qualifying tasks must exist before the file alerts. `priority` remains a
separate presentation concern.

If `rules.incompleteTaskAlert.alertUrl` is set in `.onyx-vellum.json`,
performs an HTTP POST of the alert content to that URL with
`Content-Type: text/plain`, `Markdown: yes`, and optionally
`Authorization: Bearer <alertToken>`.

## Project Structure

```
src/
├── index.ts                     # CLI entrypoint
├── ConfiguredRules.ts           # Type exports for rule config shapes
├── helpText.ts                  # --help output text (exported for testing)
├── loadConfig.ts                # Vault-level config — zod schemas + load/apply
├── viewAST.ts                   # Debug utility to view parsed AST
├── worker.ts                    # GPU worker entrypoint (transcription)
├── markdown/
│   ├── PluginContext.ts         # Context type passed through the pipeline
│   ├── createParseProcessor.ts  # ← Plugin wiring: unified processor factory
│   ├── inlineFieldsPlugin.ts    # Inline field remark plugin + get/set helpers
│   ├── remarkObsidianPlugin.ts  # Wiki link / embed / tag / callout parser
│   ├── Task.ts                  # Task type definitions
│   └── types.ts                 # Embedded node type defs
├── engine/
│   ├── encoding.ts              # UTF-16 BOM detection and decoding
│   ├── runner.ts                # Pipeline runner, init pass, normalizeFileContent
│   ├── FileWriteManager.ts      # File read/stage/commit with vault path helpers
│   ├── FileOperationExecutor.ts # Deferred file operations (write AST back to files)
│   ├── vaultWatcher.ts          # fs.watch-based recursive file watcher
│   ├── createAlertScheduler.ts  # Cron-style scheduler for alert mode
│   └── userLocalTime.ts         # Timezone-aware date helpers
├── rules/
│   ├── makePlugin.ts            # Plugin factory — wraps core logic with source filtering
│   ├── scheduleUtils.ts         # parseRepeat, computeNextDue, date helpers
│   ├── normalizeTodayPlugin.ts
│   ├── stampDonePlugin.ts
│   ├── repeatTasksPlugin.ts
│   ├── removeEphemeralOverdueTasksPlugin.ts
│   ├── moveDoneTasksPlugin.ts
│   ├── sortTasksPlugin.ts
│   ├── incompleteTaskAlertPlugin.ts
│   ├── ensureAudioTranscriptsPlugin.ts
│   ├── onyxVellumCommands.ts
│   └── types.ts
├── transcription/
│   ├── queue.ts                 # File-based job queue (pending/processing/done/failed)
│   ├── types.ts                 # Job, FileOperation, ContentLocation types
│   └── worker/
│       ├── index.ts             # Worker loop — polls queue, processes jobs
│       └── transcribe.ts        # Transcribe/Clean/Summarize job handlers
tests/
├── vault.test.ts                # E2E vault snapshot test (primary coverage)
├── cli.test.ts                  # --help text
├── config.test.ts               # vault-level config: create, merge, validation
├── inlineFieldsPlugin.test.ts   # Inline field get/set utilities
├── parse.test.ts                # Markdown parse/stringify round-trip
├── roundtrip.test.ts            # Pipeline round-trip stability
├── scheduleUtils.test.ts        # parseRepeat, computeNextDue
├── moveDoneTranscriptTasksToDailyNote.test.ts
├── commandFindTasks.test.ts
├── fileOperationExecutor.test.ts
├── scheduler.test.ts
├── fasterWhisperBackend.test.ts
├── transcriptionRuntime.test.ts
├── watcher.test.ts
├── worker.test.ts
├── workerQueue.test.ts
├── testDate.ts                  # Pinned date: 2026-05-03 America/Los_Angeles
├── createTempDir.ts
└── test_vault/                  # 37+ scenario directories with .md.expected snapshots
```

## Adding a New Rule

1. Create `src/rules/myPlugin.ts` using the `makePlugin()` factory from
   `src/rules/makePlugin.ts`. The factory handles source filtering and context
   injection.
2. The `coreLogic` callback receives `{ tree, file, ctx, ruleConfig, config, debug }`.
   Mutate the AST directly — no declarative predicate/action model.
3. Import and `.use()` the plugin in **`src/markdown/createParseProcessor.ts`**
   at the appropriate position in the plugin chain.

### Plugin ordering

Plugins execute in the order they are `.use()`'d — there is no dependency-ordering
mechanism. Earlier rules stage AST changes that later rules see via the in-memory
transform queue. As a rule of thumb:

- Rules that resolve relative dates or parse inline fields should come first
  (so later rules see resolved values).
- Rules that reformat or restructure (sort, move, remove) should come later.
- If your rule needs an inline field (`due:today`), it must run after
  `inlineFieldsPlugin` and `normalizeTodayLiteral`.

### Fast-pass eligibility

In watch mode, rules in the `fast` block of `createParseProcessor.ts` run on
a short debounce (~5–10 s) for quick feedback. Currently the fast pass includes
`inlineFields`, `normalizeTodayLiteral`, `commands`, and `ensureAudioTranscripts`.
Rules that make very small changes or schedule jobs are good candidates. Rules
that reformat large sections of a file should stay in the `all` block only.
