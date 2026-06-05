import { describe, it, expect, vi, beforeEach } from "vitest";
import { VaultFile } from "../src/engine/VaultFile.js";
import { FileOperationExecutor } from "../src/engine/FileOperationExecutor.js";
import { createParseProcessor } from "../src/markdown/createParseProcessor.js";
import { testDate } from "./testDate.js";
import { ALERT_FILE } from "../src/rules/incompleteTaskAlertPlugin.js";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const vaultPath = "/tmp/test-vault";
const alertUrl = "https://ntfy.sh/test-alert";
const defaultConfig = {
  rules: {
    incompleteTaskAlert: {
      alertUrl,
      schedule: ["08:00"],
    },
  },
};

/** Run the incompleteTaskAlert plugin over `content` and return collected ops. */
async function runAlert(content: string, relPath = "notes/tasks.md") {
  const ops = new FileOperationExecutor();
  const processor = createParseProcessor(
    {
      rules: {
        incompleteTaskAlert: { alertUrl, schedule: ["08:00"] },
      },
    },
    {
      vaultPath,
      updateFile: ops.updateFile,
      queueJob: async () => {},
      jobIdFactory: () => "id",
      env: {},
      mode: "alert",
      dates: testDate,
      dryRun: true,
    },
  );

  const vf = new VaultFile({
    absolutePath: join(vaultPath, relPath),
    relativePath: relPath,
    value: content,
    vaultPath,
  });
  const tree = processor.parse(vf);
  await processor.run(tree, vf);

  return { ops, vf };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("incompleteTaskAlertPlugin", () => {
  // -----------------------------------------------------------------------
  // Early returns
  // -----------------------------------------------------------------------

  it("skips when mode is not 'alert'", async () => {
    const ops = new FileOperationExecutor();
    const processor = createParseProcessor(defaultConfig, {
      vaultPath,
      updateFile: ops.updateFile,
      queueJob: async () => {},
      jobIdFactory: () => "id",
      env: {},
      mode: "all",
      dates: testDate,
      dryRun: true,
    });

    const vf = new VaultFile({
      absolutePath: join(vaultPath, "notes/tasks.md"),
      relativePath: "notes/tasks.md",
      value: "- [ ] task 1\n- [ ] task 2",
      vaultPath,
    });
    const tree = processor.parse(vf);
    await processor.run(tree, vf);

    expect(ops.fileOperations).toEqual({});
  });

  it("skips when no alertUrl is configured", async () => {
    const ops = new FileOperationExecutor();
    const processor = createParseProcessor(
      { rules: { incompleteTaskAlert: {} } },
      {
        vaultPath,
        updateFile: ops.updateFile,
        queueJob: async () => {},
        jobIdFactory: () => "id",
        env: {},
        mode: "alert",
        dates: testDate,
        dryRun: true,
      },
    );

    const vf = new VaultFile({
      absolutePath: join(vaultPath, "notes/tasks.md"),
      relativePath: "notes/tasks.md",
      value: "- [ ] task 1",
      vaultPath,
    });
    const tree = processor.parse(vf);
    await processor.run(tree, vf);

    expect(ops.fileOperations).toEqual({});
  });

  it("skips the alert file itself to avoid recursive alerts", async () => {
    const { ops } = await runAlert("- [ ] task 1\n- [x] done", ALERT_FILE);
    expect(ops.fileOperations).toEqual({});
  });

  // -----------------------------------------------------------------------
  // Snooze handling (confirms snooze is dead code in current impl)
  // -----------------------------------------------------------------------

  it("snoozed fields are never filtered because 'snooze' is not in KNOWN_INLINE_FIELD_ORDER", async () => {
    const { ops } = await runAlert(`- [ ] snoozed task \`snooze::2026-05-10\``);
    // snoozed tasks are still alerted because inlineFieldsPlugin does not
    // extract 'snooze' into a structured field, so the guard
    //   fields.snooze && fields.snooze > ctx.dates.today
    // never evaluates to true.
    const rels = Object.keys(ops.fileOperations);
    expect(rels.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Priority handling
  // -----------------------------------------------------------------------

  it("priority=low only counts tasks without calling updateFile per-task", async () => {
    const ops = new FileOperationExecutor();
    const processor = createParseProcessor(
      {
        rules: {
          incompleteTaskAlert: {
            alertUrl,
            schedule: ["08:00"],
          },
        },
      },
      {
        vaultPath,
        updateFile: ops.updateFile,
        queueJob: async () => {},
        jobIdFactory: () => "id",
        env: {},
        mode: "alert",
        dates: testDate,
        dryRun: true,
      },
    );

    const vf = new VaultFile({
      absolutePath: join(vaultPath, "notes/tasks.md"),
      relativePath: "notes/tasks.md",
      value: `---
priority: low
---
- [ ] task 1
- [ ] task 2
- [x] done`,
      vaultPath,
    });
    const tree = processor.parse(vf);
    await processor.run(tree, vf);

    const opsFor = ops.fileOperations[ALERT_FILE] ?? [];
    // Exactly 1 op: the summary line, no per-task entries
    expect(opsFor.length).toBe(1);
    expect(opsFor[0].content).toContain("2 tasks in notes/tasks.md");
  });

  it("priority=medium (default) batches incomplete tasks into one alert entry", async () => {
    const { ops } = await runAlert(
      `- [ ] task 1
- [ ] task 2
- [x] done`,
    );
    const opsFor = ops.fileOperations[ALERT_FILE] ?? [];
    expect(opsFor.length).toBe(1);
    expect(opsFor[0].content).toMatchObject({
      type: "list",
      children: expect.arrayContaining([
        expect.objectContaining({ checked: false }),
        expect.objectContaining({ checked: false }),
      ]),
    });
  });

  it("priority=high also batches incomplete tasks into one alert entry", async () => {
    const ops = new FileOperationExecutor();
    const processor = createParseProcessor(
      {
        rules: {
          incompleteTaskAlert: {
            alertUrl,
            schedule: ["08:00"],
          },
        },
      },
      {
        vaultPath,
        updateFile: ops.updateFile,
        queueJob: async () => {},
        jobIdFactory: () => "id",
        env: {},
        mode: "alert",
        dates: testDate,
        dryRun: true,
      },
    );

    const vf = new VaultFile({
      absolutePath: join(vaultPath, "notes/tasks.md"),
      relativePath: "notes/tasks.md",
      value: `---
priority: high
---
- [ ] urgent task`,
      vaultPath,
    });
    const tree = processor.parse(vf);
    await processor.run(tree, vf);

    const opsFor = ops.fileOperations[ALERT_FILE] ?? [];
    expect(opsFor.length).toBe(1); // 1 per-task
    expect(opsFor[0].content).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // VaultFile path correctness
  // -----------------------------------------------------------------------

  it("alert entries are targeted at onyx_alert.md in the vault root", async () => {
    const { ops } = await runAlert("- [ ] important");
    const opsFor = ops.fileOperations[ALERT_FILE] ?? [];
    expect(opsFor.length).toBe(1);
    for (const op of opsFor) {
      expect(op.location.file.absolutePath).toBe(join(vaultPath, ALERT_FILE));
    }
  });
});

// ---------------------------------------------------------------------------
// sendNotification pure function tests
// ---------------------------------------------------------------------------

describe("sendNotification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns early when alertUrl is missing", async () => {
    const { sendNotification } =
      await import("../src/rules/incompleteTaskAlertPlugin.js");
    const result = await sendNotification({}, "some content");
    expect(result).toBeUndefined();
  });

  it("sends POST with correct headers", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const { sendNotification } =
      await import("../src/rules/incompleteTaskAlertPlugin.js");

    await sendNotification({ alertUrl }, "# Tasks\n\n- [ ] foo");

    expect(fetchSpy).toHaveBeenCalledWith(
      alertUrl,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "text/plain",
          Markdown: "yes",
          Title: "Incomplete Tasks",
        }),
      }),
    );
  });

  it("includes Authorization header when alertToken is set", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const { sendNotification } =
      await import("../src/rules/incompleteTaskAlertPlugin.js");

    await sendNotification({ alertUrl, alertToken: "tok_abc" }, "content");

    expect(fetchSpy).toHaveBeenCalledWith(
      alertUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok_abc",
        }),
      }),
    );
  });

  it("throws on non-OK HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limit", {
        status: 429,
        statusText: "Too Many Requests",
      }),
    );
    const { sendNotification } =
      await import("../src/rules/incompleteTaskAlertPlugin.js");

    await expect(sendNotification({ alertUrl }, "content")).rejects.toThrow(
      "HTTP 429",
    );
  });

  it("throws when fetch itself fails (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connect ECONNREFUSED"),
    );
    const { sendNotification } =
      await import("../src/rules/incompleteTaskAlertPlugin.js");

    await expect(sendNotification({ alertUrl }, "content")).rejects.toThrow(
      "connect ECONNREFUSED",
    );
  });
});
