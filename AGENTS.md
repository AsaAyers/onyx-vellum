# onyx-vellum — agent reference

## Architecture

TypeScript Markdown automation pipeline for Obsidian vaults. Uses the
[unified/remark](https://github.com/remarkjs/remark) ecosystem (AST-based).

The architecture is plugin-based: rules are remark plugins
(`*Plugin.ts` files in `src/rules/`) wired together in `src/markdown/createParseProcessor.ts`. No central rule registry file exists.

Entrypoint: `src/index.ts` (CLI). Runner: `src/engine/runner.ts`.

## Commands

| Command              | What it does                         |
| -------------------- | ------------------------------------ |
| `npm run build`      | `tsc` compile to `dist/`             |
| `npm run typecheck`  | `tsc --noEmit`                       |
| `npm run lint`       | `eslint .`                           |
| `npm run lint:fix`   | `eslint . --fix`                     |
| `npm run format`     | `prettier --write .`                 |
| `TZ=UTC npm test`    | `vitest run`                         |
| `npm run run`        | `tsx src/index.ts` (no build needed) |
| `npm run run:worker` | `tsx src/index.ts --worker`          |

Pre-commit hook (`.husky/pre-commit`): `typecheck → format → lint → test`.
Full test suite runs on every commit.

## Runtime

- `VAULT_PATH` env var **required** — absolute path to vault root.
- `STATE_DIR` env var optional (defaults to `.onyx-vellum-state` sibling).
- Vault config: `.onyx-vellum.json` at vault root.
- Modes: `all`, `alert`, `--init`, `--watch`.
- `--dry-run` produces unified diffs without writing.

## Inline fields

Always use helpers from `src/markdown/inlineFieldsPlugin.ts`:

- `getInlineFields(listItem)` → mutable `Record<string, string>`
- `setInlineField(listItem, key, value)`

Never access `listItem.data.inlineFields` directly.

## Date handling

Use `date-fns` (`addDays`, `differenceInCalendarDays`, etc.) for all date
arithmetic. Never add/subtract milliseconds or seconds directly.

## Testing

**E2E vault test** (`tests/vault.test.ts`) is the primary coverage:

- Runs full pipeline against `tests/test_vault/` in dry-run mode.
- Pinned date: `2026-05-03` (America/Los_Angeles) — see `tests/testDate.ts`.
- Every `.md` under `tests/test_vault/` requires a `.md.expected` companion.
- Assertion: pipeline output for each `.md` must exactly match `.md.expected`.
- Files unchanged by pipeline have `.expected` identical to source.

**Adding scenarios**: create `<scenario-name>/tasks.md` + `tasks.md.expected`
under `tests/test_vault/scenarios/`.

Write unit tests only for behaviour the E2E vault does not exercise.

## Code style

- ESLint blocks barrel re-exports (`export * from`, `export { X } from`).
  Import directly from the source file.
- `no-console` — allow only `console.warn` / `console.error`. Use `log()`
  arg in custom action `run()` for rule-output.
- Unused vars must be prefixed with `_`.
- Prettier: tabWidth 2, no tabs.
- No pass-through wrapper functions; import and use library functions directly.
- `erasableSyntaxOnly: true` in tsconfig — no runtime enums, no `namespace`.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical role strings use their default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
