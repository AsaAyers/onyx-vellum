/**
 * Tests for CLI-level behavior: --help text, rule selection via runAllRules,
 * unknown-rule validation.
 *
 * Rule-selection engine logic (selectRuleSpecs) is tested in
 * ruleSpecRunner.test.ts.  These tests exercise the integration between the
 * runner and the registered rule registry.
 */
import { describe, it, expect } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runAllRules } from "../src/engine/runner.js";
import { HELP_TEXT } from "../src/helpText.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEST_VAULT = join(__dirname, "test_vault");

const TODAY = new Date(2026, 4, 3); // 2026-05-03

// ---------------------------------------------------------------------------
// --help text
// ---------------------------------------------------------------------------

describe("HELP_TEXT", () => {
  it("mentions --dry-run", () => {
    expect(HELP_TEXT).toContain("--dry-run");
  });

  it("mentions --verbose", () => {
    expect(HELP_TEXT).toContain("--verbose");
  });

  it("mentions --only", () => {
    expect(HELP_TEXT).toContain("--only");
  });

  it("mentions --watch", () => {
    expect(HELP_TEXT).toContain("--watch");
  });

  it("mentions --init", () => {
    expect(HELP_TEXT).toContain("--init");
  });

  it("mentions --help", () => {
    expect(HELP_TEXT).toContain("--help");
  });

  it('mentions the "all" keyword', () => {
    expect(HELP_TEXT).toContain("all");
  });

  it("lists known rule names", () => {
    expect(HELP_TEXT).toContain("normalizeTodayLiteral");
    expect(HELP_TEXT).toContain("stampDone");
    expect(HELP_TEXT).toContain("completedTaskRollover");
    expect(HELP_TEXT).toContain("ensureAudioTranscripts");
    expect(HELP_TEXT).toContain("incompleteTaskAlert");
  });

  it("mentions VAULT_PATH environment variable", () => {
    expect(HELP_TEXT).toContain("VAULT_PATH");
  });

  it("shows a usage example with a single rule name", () => {
    expect(HELP_TEXT).toContain("stampDone");
  });
});

// ---------------------------------------------------------------------------
// runAllRules — selectedRuleNames
// ---------------------------------------------------------------------------

describe("runAllRules — selectedRuleNames", () => {
  it('runs all rules when selectedRuleNames is "all"', async () => {
    // Expect changes from the vault including normalizeTodayLiteral transforms.
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      today: TODAY,
      dryRun: true,
      env: {},
      selectedRuleNames: "all",
    });
    // The vault TODO.md has due:today which normalizeTodayLiteral replaces.
    const todoChange = changes.find((c) => c.path.endsWith("TODO.md"));
    expect(todoChange).toBeDefined();
    expect(todoChange!.content).toContain("due:2026-05-03");
  });

  it("runs all rules when selectedRuleNames is omitted (backward compat)", async () => {
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      today: TODAY,
      dryRun: true,
      env: {},
    });
    const todoChange = changes.find((c) => c.path.endsWith("TODO.md"));
    expect(todoChange).toBeDefined();
  });

  it("selecting stampDone also runs normalizeTodayLiteral (its dependency)", async () => {
    // The vault has tasks with due:today in TODO.md.
    // normalizeTodayLiteral should run because stampDone depends on it.
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      today: TODAY,
      dryRun: true,
      env: {},
      selectedRuleNames: ["stampDone"],
    });
    const todoChange = changes.find((c) => c.path.endsWith("TODO.md"));
    expect(todoChange).toBeDefined();
    // normalizeTodayLiteral ran → "today" replaced with ISO date.
    expect(todoChange!.content).toContain("due:2026-05-03");
  });

  it("onlyGlob: restricts files processed to those matching the glob", async () => {
    // Only process a single specific file via onlyGlob.
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      today: TODAY,
      dryRun: true,
      env: {},
      onlyGlob: ["TODO.md"],
    });
    // Only the top-level TODO.md should appear in the changes.
    for (const c of changes) {
      expect(c.path).toMatch(/TODO\.md$/);
    }
  });

  it("onlyGlob: does not suppress all-rules execution", async () => {
    // When onlyGlob is set, all rules still run — only files are narrowed.
    // normalizeTodayLiteral should still fire on TODO.md (it matches the glob).
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      today: TODAY,
      dryRun: true,
      env: {},
      onlyGlob: ["TODO.md"],
    });
    const todoChange = changes.find((c) => c.path.endsWith("TODO.md"));
    expect(todoChange).toBeDefined();
    expect(todoChange!.content).toContain("due:2026-05-03");
  });

  it("onlyGlob: subdirectory glob restricts to files under that directory", async () => {
    // Use a subdirectory glob — only files under scenarios/ should be processed.
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      today: TODAY,
      dryRun: true,
      env: {},
      onlyGlob: ["scenarios/**"],
    });
    // Every changed file must live under scenarios/.
    for (const c of changes) {
      expect(c.path).toContain("/scenarios/");
    }
    // The top-level TODO.md must not appear in the changes.
    const topLevelTodo = changes.find(
      (c) => c.path.endsWith("TODO.md") && !c.path.includes("/scenarios/"),
    );
    expect(topLevelTodo).toBeUndefined();
  });

  it("onlyGlob: processes all matching files when given multiple patterns", async () => {
    // Simulate watch mode batching: pass an array of relative paths.
    // Include a non-existent path alongside a real one to verify that
    // non-matching entries produce no output while matching ones still work.
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      today: TODAY,
      dryRun: true,
      env: {},
      selectedRuleNames: ["normalizeTodayLiteral"],
      onlyGlob: ["TODO.md", "nonexistent-file-that-matches-nothing.md"],
    });
    // The top-level TODO.md should appear — it matches the first array entry.
    const todoChange = changes.find((c) => c.path.endsWith("TODO.md"));
    expect(todoChange).toBeDefined();
    expect(todoChange!.content).toContain("due:2026-05-03");
    // No file outside the array should appear (the second entry matched nothing).
    for (const c of changes) {
      expect(c.path).toMatch(/TODO\.md$/);
    }
  });

  it("onlyGlob: array with multiple entries processes all matched files", async () => {
    // Pass both the top-level TODO.md and a specific scenario glob.
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      today: TODAY,
      dryRun: true,
      env: {},
      selectedRuleNames: ["normalizeTodayLiteral"],
      onlyGlob: ["TODO.md", "scenarios/**"],
    });
    // TODO.md must be present.
    const todoChange = changes.find(
      (c) => c.path.endsWith("TODO.md") && !c.path.includes("/scenarios/"),
    );
    expect(todoChange).toBeDefined();
    // All changes must match one of the two patterns.
    for (const c of changes) {
      const isTopLevelTodo =
        c.path.endsWith("TODO.md") && !c.path.includes("/scenarios/");
      const isUnderScenarios = c.path.includes("/scenarios/");
      expect(isTopLevelTodo || isUnderScenarios).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// CLI process smoke test — validates the entrypoint is runnable via tsx
// ---------------------------------------------------------------------------

describe("CLI entrypoint smoke test", () => {
  const tsxBin = join(ROOT, "node_modules", ".bin", "tsx");
  const entrypoint = join(ROOT, "src", "index.ts");

  it("exits 0 and prints help text when --help is passed", () => {
    const result = spawnSync(tsxBin, [entrypoint, "--help"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--init");
    expect(result.stdout).toContain("VAULT_PATH");
  });

  it("exits non-zero when VAULT_PATH is missing and no --help flag", () => {
    const result = spawnSync(tsxBin, [entrypoint, "all"], {
      encoding: "utf-8",
      env: { ...process.env, VAULT_PATH: "" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VAULT_PATH");
  });
});
