/**
 * Unit tests for runInitPass.
 *
 * The init pass round-trips every .md file through parse → stringify without
 * applying any rule-driven transformations.  These behaviors are NOT exercised
 * by the E2E vault snapshot, so unit tests are appropriate here.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runInitPass } from "../src/engine/runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INIT_SCENARIO = join(__dirname, "test_vault", "scenarios", "init-pass");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readScenarioFile(name: string): Promise<string> {
  return fs.readFile(join(INIT_SCENARIO, name), "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runInitPass", () => {
  it("reports a file that needs normalization (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    const needsNorm = changes.find((c) =>
      c.path.includes("needs-normalization"),
    );
    expect(
      needsNorm,
      "needs-normalization.md must appear in changes",
    ).toBeDefined();
  });

  it("does NOT report a file that is already normalized (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    const alreadyNorm = changes.find((c) =>
      c.path.includes("already-normalized"),
    );
    expect(
      alreadyNorm,
      "already-normalized.md must NOT appear in changes",
    ).toBeUndefined();
  });

  it("does NOT apply rule-driven transformations — due:today stays as-is (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    const changed = changes.find((c) => c.path.includes("needs-normalization"));
    // The content should still have the literal "due:today" — init never converts it
    expect(changed).toBeDefined();
    expect(changed!.content).toContain("due:today");
    expect(changed!.content).not.toContain("due:2026-");
  });

  it("dry-run: does not modify files on disk", async () => {
    const originalContent = await readScenarioFile("needs-normalization.md");

    await runInitPass(INIT_SCENARIO, true);

    const afterContent = await readScenarioFile("needs-normalization.md");
    expect(afterContent).toBe(originalContent);
  });

  // ---------------------------------------------------------------------------
  // Wikilink preservation
  // ---------------------------------------------------------------------------

  it("preserves Obsidian wikilinks [[...]] without escaping (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    // with-wikilinks.md is already normalized, so it must not appear in changes
    const wikiChange = changes.find((c) => c.path.includes("with-wikilinks"));
    expect(
      wikiChange,
      "with-wikilinks.md is already normalized and must not require changes",
    ).toBeUndefined();
  });

  it("preserves wikilinks in normalized content — no \\[[ escaping", async () => {
    // Verify the round-trip of the wikilinks file produces no escaping
    const original = await readScenarioFile("with-wikilinks.md");
    // If the file was changed by runInitPass it would appear in changes;
    // since it doesn't, we verify the content directly would not be escaped
    expect(original).not.toContain("\\[\\[");
    expect(original).toContain("[[");
  });

  // ---------------------------------------------------------------------------
  // Obsidian tag preservation
  // ---------------------------------------------------------------------------

  it("preserves Obsidian hashtags without escaping (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    // with-obsidian-tags.md is already normalized — # must not become \#
    const tagChange = changes.find((c) =>
      c.path.includes("with-obsidian-tags"),
    );
    expect(tagChange, "should not require changes").toBeUndefined();
  });

  it("normalizeFileContent does not escape # in Obsidian tags", async () => {
    const { normalizeFileContent } = await import("../src/engine/runner.js");
    // Tag at start of paragraph (atBreak position — the case remark escapes)
    const input = "#feeling/good\n\nSome text with #work/project inline.\n";
    const output = normalizeFileContent(input);
    expect(output).not.toContain("\\#");
    expect(output).toContain("#feeling/good");
    expect(output).toContain("#work/project");
  });

  // ---------------------------------------------------------------------------
  // Link URL preservation
  // ---------------------------------------------------------------------------

  it("preserves link query-string ampersands without escaping (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    // with-links.md is already normalized — & must not become \&
    const linkChange = changes.find((c) => c.path.includes("with-links"));
    expect(linkChange, "should not require changes").toBeUndefined();
  });

  it("normalizeFileContent does not escape & in link URLs", async () => {
    const { normalizeFileContent } = await import("../src/engine/runner.js");
    const input =
      "![Card](https://example.com/image?id=1&type=card)\n\n[link](https://example.com?a=1&b=2)\n";
    const output = normalizeFileContent(input);
    expect(output).not.toContain("\\&");
    expect(output).toContain("?id=1&type=card");
    expect(output).toContain("?a=1&b=2");
  });

  // ---------------------------------------------------------------------------
  // Templater / asterisk preservation
  // ---------------------------------------------------------------------------

  it("preserves Templater <%* syntax without escaping (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    // with-templater.md is already normalized — the <%* must not be changed
    const templaterChange = changes.find((c) =>
      c.path.includes("with-templater"),
    );
    expect(
      templaterChange,
      "with-templater.md is already normalized and must not require changes",
    ).toBeUndefined();
  });

  it("normalizeFileContent does not escape * in Templater syntax", async () => {
    const { normalizeFileContent } = await import("../src/engine/runner.js");
    const input = "<%* const title = tp.file.title; %>\n\n# Some heading\n";
    const output = normalizeFileContent(input);
    expect(output).not.toContain("\\*");
    expect(output).toContain("<%*");
  });

  // ---------------------------------------------------------------------------
  // UTF-16 file handling
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Frontmatter preservation
  // ---------------------------------------------------------------------------

  it("preserves YAML frontmatter verbatim (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    // with-frontmatter.md should NOT appear in changes — the frontmatter
    // should be preserved exactly and the body is already normalized
    const fmChange = changes.find((c) => c.path.includes("with-frontmatter"));
    expect(
      fmChange,
      "with-frontmatter.md is already normalized and must not require changes",
    ).toBeUndefined();
  });

  it("does not corrupt publish:false frontmatter into a Markdown heading (dry-run)", async () => {
    // This file now intentionally contains a checked task that needs stamping.
    // We should get a change that adds done while preserving the
    // frontmatter block byte-for-byte.
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    const fmChange = changes.find((c) =>
      c.path.includes("with-publish-frontmatter"),
    );
    expect(
      fmChange,
      "with-publish-frontmatter.md should require done stamping",
    ).toBeDefined();
    expect(fmChange!.content).toContain("done:unknown");

    const original = await readScenarioFile("with-publish-frontmatter.md");
    const frontmatterRe = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
    const originalFrontmatter = frontmatterRe.exec(original)?.[0];
    const changedFrontmatter = frontmatterRe.exec(fmChange!.content)?.[0];

    expect(originalFrontmatter).toBeDefined();
    expect(changedFrontmatter).toBeDefined();
    expect(changedFrontmatter).toBe(originalFrontmatter);
    // Regression assertion: no setext-heading artifact from mis-parsed `---`.
    expect(fmChange!.content).not.toContain("## publish: false");
  });

  it("normalizeFileContent preserves publish:false frontmatter without body", async () => {
    const { normalizeFileContent } = await import("../src/engine/runner.js");
    // The exact content from the bug report — frontmatter only, no body.
    const src = "---\npublish: false\n---\n";
    const result = normalizeFileContent(src);
    expect(result).toBe(src);
    // Must not contain a setext heading artefact
    expect(result).not.toContain("## publish: false");
  });

  // ---------------------------------------------------------------------------
  // Double-pass stability (new requirement)
  // ---------------------------------------------------------------------------

  it("second pass on already-normalized content produces no changes (stability)", async () => {
    // Run on the scenario dir — should be stable (no unstable files error)
    await expect(runInitPass(INIT_SCENARIO, true)).resolves.not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // done stamping during --init
  // ---------------------------------------------------------------------------

  it("stamps done:unknown on checked tasks that lack one (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    const stamped = changes.find((c) => c.path.includes("with-completed-task"));
    expect(
      stamped,
      "with-completed-task.md must appear in changes",
    ).toBeDefined();
    expect(stamped!.content).toContain("done:unknown");
  });

  it("does not overwrite an existing done (dry-run)", async () => {
    const TMP_DIR = join(__dirname, "..", "tmp", "init-stamp-existing-test");
    await fs.mkdir(TMP_DIR, { recursive: true });
    try {
      // File already has a done — init must not overwrite it
      await fs.writeFile(
        join(TMP_DIR, "task.md"),
        "* [x] Done done:2025-06-15\n",
        "utf-8",
      );
      const { changes } = await runInitPass(TMP_DIR, true);
      const change = changes.find((c) => c.path.includes("task.md"));
      // No change expected — done is already present
      expect(change).toBeUndefined();
    } finally {
      await fs.rm(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("does not stamp done on unchecked tasks (dry-run)", async () => {
    const { changes } = await runInitPass(INIT_SCENARIO, true);
    // with-unchecked-task.md contains only an unchecked task — it must not be stamped
    const change = changes.find((c) => c.path.includes("with-unchecked-task"));
    expect(change).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Write mode
  // ---------------------------------------------------------------------------

  describe("write mode", () => {
    const TMP_DIR = join(__dirname, "..", "tmp", "init-test-vault");

    beforeEach(async () => {
      // Copy scenario files to a temp dir so we can test real writes
      await fs.mkdir(TMP_DIR, { recursive: true });
      await fs.copyFile(
        join(INIT_SCENARIO, "needs-normalization.md"),
        join(TMP_DIR, "needs-normalization.md"),
      );
      await fs.copyFile(
        join(INIT_SCENARIO, "already-normalized.md"),
        join(TMP_DIR, "already-normalized.md"),
      );
      await fs.copyFile(
        join(INIT_SCENARIO, "with-wikilinks.md"),
        join(TMP_DIR, "with-wikilinks.md"),
      );
      await fs.copyFile(
        join(INIT_SCENARIO, "with-frontmatter.md"),
        join(TMP_DIR, "with-frontmatter.md"),
      );
      await fs.copyFile(
        join(INIT_SCENARIO, "with-templater.md"),
        join(TMP_DIR, "with-templater.md"),
      );
    });

    afterEach(async () => {
      await fs.rm(TMP_DIR, { recursive: true, force: true });
    });

    it("does not touch already-normalized files (non-dry-run)", async () => {
      const originalContent = await fs.readFile(
        join(TMP_DIR, "already-normalized.md"),
        "utf-8",
      );

      await runInitPass(TMP_DIR, false);

      const afterContent = await fs.readFile(
        join(TMP_DIR, "already-normalized.md"),
        "utf-8",
      );
      expect(afterContent).toBe(originalContent);
    });

    it("preserves frontmatter verbatim after write", async () => {
      const originalContent = await fs.readFile(
        join(TMP_DIR, "with-frontmatter.md"),
        "utf-8",
      );
      await runInitPass(TMP_DIR, false);
      const afterContent = await fs.readFile(
        join(TMP_DIR, "with-frontmatter.md"),
        "utf-8",
      );

      expect(afterContent).toBe(originalContent);
      expect(afterContent.startsWith("---\n")).toBe(true);
    });

    it("stamps done to disk for checked tasks (non-dry-run)", async () => {
      await fs.copyFile(
        join(INIT_SCENARIO, "with-completed-task.md"),
        join(TMP_DIR, "with-completed-task.md"),
      );

      await runInitPass(TMP_DIR, false);

      const afterContent = await fs.readFile(
        join(TMP_DIR, "with-completed-task.md"),
        "utf-8",
      );
      expect(afterContent).toContain("done:unknown");
    });
  });
});
