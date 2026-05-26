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
import { helpText } from "../src/helpText.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// --help text
// ---------------------------------------------------------------------------

describe("HELP_TEXT", () => {
  it("mentions --dry-run", () => {
    expect(helpText).toContain("--dry-run");
  });

  it("mentions --verbose", () => {
    expect(helpText).toContain("--verbose");
  });

  it("mentions --only", () => {
    expect(helpText).toContain("--only");
  });

  it("mentions --watch", () => {
    expect(helpText).toContain("--watch");
  });

  it("mentions --init", () => {
    expect(helpText).toContain("--init");
  });

  it("mentions --help", () => {
    expect(helpText).toContain("--help");
  });

  it('mentions the "all" keyword', () => {
    expect(helpText).toContain("all");
  });

  it("lists known rule names", () => {
    expect(helpText).toContain("normalizeTodayLiteral");
    expect(helpText).toContain("stampDone");
    expect(helpText).toContain("completedTaskRollover");
    expect(helpText).toContain("ensureAudioTranscripts");
    expect(helpText).toContain("incompleteTaskAlert");
  });

  it("mentions VAULT_PATH environment variable", () => {
    expect(helpText).toContain("VAULT_PATH");
  });

  it("shows a usage example with a single rule name", () => {
    expect(helpText).toContain("stampDone");
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
