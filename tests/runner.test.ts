vi.mock("../src/rules/incompleteTaskAlertPlugin.js", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...(mod as object),
    sendNotification: vi.fn(),
  };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runner, runInitPass } from "../src/engine/runner.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createTempDir } from "./createTempDir.js";
import { testDate } from "./testDate.js";
import { commandsMarkdown } from "../src/rules/onyxVellumCommands.js";
import { sendNotification } from "../src/rules/incompleteTaskAlertPlugin.js";
import type { Mock } from "vitest";

async function createVault(
  files: Record<string, string | Buffer>,
): Promise<string> {
  const vaultPath = await createTempDir("runner-test-");
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(vaultPath, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }
  return vaultPath;
}

const runnerBase = {
  dates: testDate,
  env: {} as NodeJS.ProcessEnv,
  queueJob: async () => {},
  mode: "all" as const,
};

describe("runner", () => {
  beforeEach(() => {
    (sendNotification as Mock).mockClear();
  });

  it("falls back to EMPTY_CONFIG when .onyx-vellum.json is malformed", async () => {
    const vaultPath = await createVault({
      ".onyx-vellum.json": "not valid json{{{",
    });

    const result = await runner({
      ...runnerBase,
      vaultPath,
      dryRun: true,
    });

    expect(result.report).toContain("could not load vault config");
  });

  it("onlyGlob excludes onyx-commands.md and classifies sources correctly", async () => {
    const vaultPath = await createVault({
      "a.md": "* [ ] Task A\n",
      "b.md": "* [ ] Task B\n",
      "onyx-commands.md": commandsMarkdown,
    });

    const result = await runner({
      ...runnerBase,
      vaultPath,
      dryRun: true,
      onlyGlob: ["a.md", "b.md", "onyx-commands.md"],
    });

    const relPaths = result.matchingFiles.map((f) => f.relativePath);
    expect(relPaths).toContain("a.md");
    expect(relPaths).toContain("b.md");
    expect(relPaths).not.toContain("onyx-commands.md");
  });

  it("logs Processing: for each file in verbose mode", async () => {
    const vaultPath = await createVault({
      "test.md": "* [ ] Task\n",
    });

    const result = await runner({
      ...runnerBase,
      vaultPath,
      dryRun: true,
      verbose: true,
    });

    expect(result.report).toContain("Processing: test.md");
  });

  it("warns about empty files", async () => {
    const vaultPath = await createVault({
      "empty.md": "",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runner({
      ...runnerBase,
      vaultPath,
      dryRun: true,
    });

    expect(warnSpy).toHaveBeenCalledWith("Empty file:", "empty.md");
    warnSpy.mockRestore();
  });

  it("dry-run with no changes logs 'No changes.'", async () => {
    const vaultPath = await createVault({
      "onyx-commands.md": commandsMarkdown,
    });

    const result = await runner({
      ...runnerBase,
      vaultPath,
      dryRun: true,
    });

    expect(result.changes).toHaveLength(0);
    expect(result.report).toContain("No changes.");
  });

  it("non-dry-run with no changes logs 'No files written.'", async () => {
    const vaultPath = await createVault({
      "onyx-commands.md": commandsMarkdown,
    });

    const result = await runner({
      ...runnerBase,
      vaultPath,
      dryRun: false,
    });

    expect(result.changes).toHaveLength(0);
    expect(result.report).toContain("No files written.");
  });

  it("alert mode reprocesses alert file and stages it in changes", async () => {
    const vaultPath = await createVault({
      ".onyx-vellum.json": JSON.stringify({
        rules: {
          incompleteTaskAlert: { alertUrl: "https://example.com/alert" },
        },
      }),
      "tasks.md": "* [ ] First task\n* [ ] Second task\n* [ ] Third task\n",
    });

    const result = await runner({
      ...runnerBase,
      vaultPath,
      dryRun: true,
      mode: "alert",
    });

    const alertChange = result.changes.find(
      (c) => c.vaultFile.relativePath === "onyx_alert.md",
    );
    expect(alertChange).toBeDefined();
    expect(alertChange!.content.length).toBeGreaterThan(0);
    expect(alertChange!.content).toContain("First task");
    expect(alertChange!.content).toContain("Second task");
    expect(alertChange!.content).toContain("Third task");
  });

  it("alert mode honors current-file alertIf and alertThreshold frontmatter", async () => {
    const vaultPath = await createVault({
      ".onyx-vellum.json": JSON.stringify({
        rules: {
          incompleteTaskAlert: { alertUrl: "https://example.com/alert" },
        },
      }),
      "chores.md": `---
alertIf: due<=today
alertThreshold: 2
---
* [ ] Dishes due:2026-05-03
* [ ] Laundry due:2026-05-04
* [ ] Clean the car due:2026-05-02
`,
    });

    const result = await runner({
      ...runnerBase,
      vaultPath,
      dryRun: true,
      mode: "alert",
    });

    const alertChange = result.changes.find(
      (c) => c.vaultFile.relativePath === "onyx_alert.md",
    );
    expect(alertChange).toBeDefined();
    expect(alertChange!.content).toContain("Dishes");
    expect(alertChange!.content).toContain("Clean the car");
    expect(alertChange!.content).not.toContain("Laundry");
  });

  it("alert mode with empty alert content logs 'No alerts to report.'", async () => {
    const vaultPath = await createVault({
      ".onyx-vellum.json": JSON.stringify({
        rules: {
          incompleteTaskAlert: { alertUrl: "https://example.com/alert" },
        },
      }),
      // No .md files — processing loop has nothing to run, alert file stays empty
    });

    const result = await runner({
      ...runnerBase,
      vaultPath,
      dryRun: false,
      mode: "alert",
    });

    expect(result.report).toContain("No alerts to report.");
  });

  it("alert mode with non-empty content sends notification", async () => {
    const vaultPath = await createVault({
      ".onyx-vellum.json": JSON.stringify({
        rules: {
          incompleteTaskAlert: { alertUrl: "https://ntfy.sh/test123" },
        },
      }),
      "tasks.md": "* [ ] Alert-worthy task\n",
    });
    (sendNotification as Mock).mockResolvedValue(undefined);
    (sendNotification as Mock).mockClear();

    await runner({
      ...runnerBase,
      vaultPath,
      dryRun: false,
      mode: "alert",
    });

    expect(sendNotification).toHaveBeenCalled();
    const calledWithArgs = (sendNotification as Mock).mock.lastCall;
    expect(calledWithArgs![1]).toContain("Alert-worthy task");
  });
});

describe("runInitPass", () => {
  it("decodes UTF-16 LE with BOM", async () => {
    const vaultPath = await createVault({});
    const content = "# UTF-16 LE\n* [ ] Task\n";
    const leBuf = Buffer.from(content, "utf16le");
    const buf = Buffer.alloc(2 + leBuf.length);
    buf.writeUInt16LE(0xfeff, 0);
    leBuf.copy(buf, 2);
    await writeFile(join(vaultPath, "note.md"), buf);

    const { changes } = await runInitPass(vaultPath, true);

    expect(changes).toHaveLength(1);
    expect(changes[0].content).toBe(content);
  });

  it("decodes UTF-16 BE with BOM by swapping bytes", async () => {
    const vaultPath = await createVault({});
    const content = "# UTF-16 BE\n* [ ] Task\n";
    const leBuf = Buffer.from(content, "utf16le");
    const buf = Buffer.alloc(2 + leBuf.length);
    buf[0] = 0xfe;
    buf[1] = 0xff;
    for (let i = 0; i < leBuf.length; i += 2) {
      buf[2 + i] = leBuf[i + 1];
      buf[2 + i + 1] = leBuf[i];
    }
    await writeFile(join(vaultPath, "note.md"), buf);

    const { changes } = await runInitPass(vaultPath, true);

    expect(changes).toHaveLength(1);
    expect(changes[0].content).toBe(content);
  });

  it("decodes BOM-less UTF-16 LE via null-byte heuristic", async () => {
    const vaultPath = await createVault({});
    const content = "# BOM-less UTF-16\n* [ ] Task\n";
    const buf = Buffer.from(content, "utf16le");
    await writeFile(join(vaultPath, "note.md"), buf);

    const { changes } = await runInitPass(vaultPath, true);

    expect(changes).toHaveLength(1);
    expect(changes[0].content).toBe(content);
  });

  it("skips UTF-8 files without staging them", async () => {
    const vaultPath = await createVault({
      "note.md": "# Normal UTF-8\n* [ ] Task\n",
    });

    const { changes } = await runInitPass(vaultPath, true);

    expect(changes).toHaveLength(0);
  });

  it("dry-run returns changes without writing to disk", async () => {
    const vaultPath = await createVault({});
    const content = "# Dry-run test\n";
    const buf = Buffer.from(content, "utf16le");
    await writeFile(join(vaultPath, "note.md"), buf);

    const { changes } = await runInitPass(vaultPath, true);

    expect(changes).toHaveLength(1);
    expect(changes[0].content).toBe(content);
    const diskContent = await (
      await import("node:fs/promises")
    ).readFile(join(vaultPath, "note.md"), "utf-8");
    expect(diskContent).toContain("\0"); // original UTF-16 LE preserved on disk
  });

  it("live mode writes UTF-8 files to disk", async () => {
    const vaultPath = await createVault({});
    const content = "# Live mode\n* [ ] Task\n";
    const buf = Buffer.from(content, "utf16le");
    await writeFile(join(vaultPath, "note.md"), buf);

    const { changes } = await runInitPass(vaultPath, false);

    expect(changes).toHaveLength(1);
    const diskContent = await (
      await import("node:fs/promises")
    ).readFile(join(vaultPath, "note.md"), "utf-8");
    expect(diskContent).toBe(content);
    expect(diskContent).not.toContain("\0");
  });

  it("sorts changes by absolute path when multiple files change", async () => {
    const vaultPath = await createVault({});
    const content = "# File\n";
    const buf = Buffer.from(content, "utf16le");
    await writeFile(join(vaultPath, "z.md"), buf);
    await writeFile(join(vaultPath, "a.md"), buf);

    const { changes } = await runInitPass(vaultPath, true);

    expect(changes).toHaveLength(2);
    expect(changes[0].vaultFile.relativePath).toBe("a.md");
    expect(changes[1].vaultFile.relativePath).toBe("z.md");
  });
});
