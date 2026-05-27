import { describe, it, expect, vi, beforeEach } from "vitest";
import { VaultFile } from "../src/engine/VaultFile.js";
import { FileOperationExecutor } from "../src/engine/FileOperationExecutor.js";
import { createParseProcessor } from "../src/markdown/createParseProcessor.js";
import { testDate } from "./testDate.js";
import { join } from "node:path";
import { ONYX_COMMANDS_FILE } from "../src/rules/onyxVellumCommands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const vaultPath = "/tmp/test-vault";
const queueJob = vi.fn();
const jobIdFactory = vi.fn(() => "test-job-id");

function opsForFile(relPath: string, ops: FileOperationExecutor) {
  return ops.fileOperations[relPath] ?? [];
}

/** Run the onyxVellumCommands plugin over `content` and return collected ops + queueJob calls. */
async function processFile(
  content: string,
  relPath = "notes/doc.md",
  extraConfig: Record<string, unknown> = {},
) {
  queueJob.mockClear();
  const ops = new FileOperationExecutor();
  const processor = createParseProcessor(
    { rules: {} },
    {
      vaultPath,
      updateFile: ops.updateFile,
      queueJob,
      jobIdFactory,
      env: {},
      mode: "all",
      dates: testDate,
      dryRun: true,
      ...extraConfig,
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

describe("onyxVellumCommands", () => {
  beforeEach(() => {
    queueJob.mockClear();
  });

  it("skips onyx-commands.md entirely", async () => {
    const { ops } = await processFile("#onyx/tasks", ONYX_COMMANDS_FILE);

    expect(opsForFile(ONYX_COMMANDS_FILE, ops)).toHaveLength(0);
    expect(queueJob).not.toHaveBeenCalled();
  });

  describe("#onyx/tasks", () => {
    it("queues a find-tasks job and an updateFile op", async () => {
      const relPath = "notes/doc.md";
      const { ops } = await processFile(
        "# Section\n\n#onyx/tasks\n\nSome content",
        relPath,
      );

      const fileOps = opsForFile(relPath, ops);
      expect(fileOps).toHaveLength(1);
      expect(fileOps[0].frontmatter).toEqual({ tasks: "test-job-id" });
      expect(fileOps[0].location.header).toBe("Tasks");

      expect(queueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "find-tasks",
          id: "test-job-id",
          source: expect.objectContaining({ header: "Section" }),
        }),
      );
    });

    it("extracts the source header from the nearest preceding heading", async () => {
      queueJob.mockClear();
      const ops = new FileOperationExecutor();
      const processor = createParseProcessor(
        { rules: {} },
        {
          vaultPath,
          updateFile: ops.updateFile,
          queueJob,
          jobIdFactory,
          env: {},
          mode: "all",
          dates: testDate,
          dryRun: true,
        },
      );

      const vf = new VaultFile({
        absolutePath: join(vaultPath, "notes/doc.md"),
        relativePath: "notes/doc.md",
        value: "# Meeting\n\n## Agenda\n\n#onyx/tasks",
        vaultPath,
      });
      const tree = processor.parse(vf);
      await processor.run(tree, vf);

      expect(queueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({ header: "Agenda" }),
        }),
      );
    });

    it("falls back to null header when no preceding heading exists", async () => {
      queueJob.mockClear();
      const ops = new FileOperationExecutor();
      const processor = createParseProcessor(
        { rules: {} },
        {
          vaultPath,
          updateFile: ops.updateFile,
          queueJob,
          jobIdFactory,
          env: {},
          mode: "all",
          dates: testDate,
          dryRun: true,
        },
      );

      const vf = new VaultFile({
        absolutePath: join(vaultPath, "no-header.md"),
        relativePath: "no-header.md",
        value: "Just text\n\n#onyx/tasks",
        vaultPath,
      });
      const tree = processor.parse(vf);
      await processor.run(tree, vf);

      expect(queueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({ header: null }),
        }),
      );
    });
  });

  describe("#onyx/transcribe", () => {
    it("resolves audio path via dirname(file.absolutePath) and queues a transcribe job", async () => {
      const relPath = "notes/meeting.md";
      const { ops } = await processFile(
        "# Section\n\n#onyx/transcribe\n\n[[recording.m4a]]",
        relPath,
      );

      // Note: #onyx/transcribe does NOT call ctx.updateFile — the file
      // operation is carried inside the job and applied by the worker.
      const fileOps = opsForFile(relPath, ops);
      expect(fileOps).toHaveLength(0);

      expect(queueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transcribe",
          audioPath: join(vaultPath, "notes", "recording.m4a"),
        }),
      );
    });
  });

  describe("#onyx/summarize", () => {
    it("queues a summarize-text job and an updateFile op", async () => {
      const relPath = "notes/report.md";
      const { ops } = await processFile(
        "# Report\n\n#onyx/summarize\n\nLong content here",
        relPath,
      );

      const fileOps = opsForFile(relPath, ops);
      expect(fileOps).toHaveLength(1);
      expect(fileOps[0].frontmatter).toEqual({
        summarizeText: "test-job-id",
      });
      expect(fileOps[0].location.header).toBe("Summary");
      expect(fileOps[0].location.position).toBe("start");

      expect(queueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "summarize-text",
          id: "test-job-id",
        }),
      );
    });
  });

  describe("AST mutation", () => {
    it("removes the obsidianTag node from the tree after processing", async () => {
      const relPath = "notes/doc.md";
      const ops = new FileOperationExecutor();
      const processor = createParseProcessor(
        { rules: {} },
        {
          vaultPath,
          updateFile: ops.updateFile,
          queueJob,
          jobIdFactory,
          env: {},
          mode: "all",
          dates: testDate,
          dryRun: true,
        },
      );

      const vf = new VaultFile({
        absolutePath: join(vaultPath, relPath),
        relativePath: relPath,
        value: "# Section\n\n#onyx/tasks\n\n- [ ] task",
        vaultPath,
      });
      const tree = processor.parse(vf);
      const result = await processor.run(tree, vf);

      const serialised = String(processor.stringify(result, vf));
      expect(serialised).not.toContain("#onyx/tasks");
    });

    it("does not crash on an unknown obsidianTag", async () => {
      const { ops } = await processFile(
        "# Section\n\n#unknown/tag\n\nSome text",
      );

      expect(opsForFile("notes/doc.md", ops)).toHaveLength(0);
      expect(queueJob).not.toHaveBeenCalled();
    });
  });
});
