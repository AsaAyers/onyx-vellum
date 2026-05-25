import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimNext, enqueue } from "../src/transcription/queue.js";
import { startWorker } from "../src/transcription/worker.js";
import { type Job } from "../src/transcription/types.js";
import { zVaultFile } from "../src/engine/io.js";

const CREATED_DIRS: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  CREATED_DIRS.push(dir);
  return dir;
}

async function runWorkerForSingleJob(job: Job) {
  const stateDir = await createTempDir("onyx-vellum-worker-state-");
  await enqueue(stateDir, job);
  return runWorkerForSingleStateDir(stateDir);
}

async function runWorkerForSingleStateDir(stateDir: string) {
  let shouldRun = true;
  await startWorker({
    stateDir,
    backend: {
      async transcribe() {
        return "transcript body";
      },
    },
    pollIntervalMs: 1,
    shouldContinue: () => {
      if (shouldRun) {
        shouldRun = false;
        return true;
      }
      return false;
    },
    sleep: async () => Promise.resolve(),
  });
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("workers", () => {
  let vaultPath = "";
  let stateDir = "";
  beforeEach(async () => {
    vaultPath = await createTempDir("onyx-vellum-worker-vault-");
    stateDir = await createTempDir("onyx-vellum-worker-state-");
  });

  describe("transcription", async () => {
    it("Creates a transcript from the audio file", async () => {
      const audioPath = join(vaultPath, "audio", "clip.m4a");
      const audioPath2 = join(vaultPath, "audio", "clip2.m4a");
      const transcriptPath = join(vaultPath, "audio", "clip.transcript.md");
      await fs.mkdir(join(vaultPath, "audio"), { recursive: true });
      await fs.writeFile(
        transcriptPath,
        `
Source audio: [[audio/clip.m4a]]

# Header 2

Existing content
`,
        "utf-8",
      );

      const transcriptionJob: Job = {
        type: "transcribe",
        id: "01j-worker-a",
        vaultPath,
        audioPath,
        target: {
          location: {
            file: zVaultFile.parse({
              relativePath: "audio/clip.transcript.md",
              absolutePath: transcriptPath,
            }),
            header: "Header 3",
            position: "end",
          },
        },
        createdAt: "2026-05-13T00:00:00.000Z",
      };
      await runWorkerForSingleJob(transcriptionJob);
      transcriptionJob.audioPath = audioPath2;
      transcriptionJob.target.location.header = "Header 1";
      transcriptionJob.target.location.position = "start";
      await runWorkerForSingleJob(transcriptionJob);
      const content = await fs.readFile(transcriptPath, "utf-8");

      expect(content).toMatchInlineSnapshot(`
        "Source audio: [[audio/clip.m4a]]

        # Header 1

        transcript body

        # Header 2

        Existing content

        # Header 3

        transcript body
        "
      `);
    });
  });

  describe("summarize", async () => {
    it("Reads a header from a source and writes the summary to the target", async () => {});
  });

  describe("transcription-pipeline", () => {
    it("writes source audio wikilink relative to source note", async () => {
      const audioPath = join(vaultPath, "audio", "clip.m4a");
      const transcriptPath = join(vaultPath, "audio", "clip.transcript.md");
      const sourceNotePath = join(vaultPath, "daily.md");
      await fs.mkdir(join(vaultPath, "audio"), { recursive: true });

      await runWorkerForSingleJob({
        type: "transcription-pipeline",
        id: "01j-worker-a",
        vaultPath,
        audioPath,
        transcriptPath,
        sourceNotePath,
        createdAt: "2026-05-13T00:00:00.000Z",
      });
      const content = await fs.readFile(transcriptPath, "utf-8");

      expect(content).toContain("status: done");
      expect(content).toContain("Source audio: [[audio/clip.m4a]]");
    });

    it("supports parent-directory relative paths from nested notes", async () => {
      const sourceNotePath = join(vaultPath, "notes", "daily.md");
      const audioPath = join(vaultPath, "audio", "clip.m4a");
      const transcriptPath = join(vaultPath, "audio", "clip.transcript.md");
      await fs.mkdir(join(vaultPath, "notes"), { recursive: true });
      await fs.mkdir(join(vaultPath, "audio"), { recursive: true });

      await runWorkerForSingleJob({
        type: "transcription-pipeline",
        id: "01j-worker-b",
        vaultPath,
        audioPath,
        transcriptPath,
        sourceNotePath,
        createdAt: "2026-05-13T00:00:00.000Z",
      });
      const content = await fs.readFile(transcriptPath, "utf-8");

      expect(content).toContain("status: done");
      expect(content).toContain("Source audio: [[../audio/clip.m4a]]");
    });

    it("retries stale processing jobs when the worker restarts", async () => {
      const audioPath = join(vaultPath, "audio", "clip.m4a");
      const transcriptPath = join(vaultPath, "audio", "clip.transcript.md");
      const sourceNotePath = join(vaultPath, "daily.md");
      await fs.mkdir(join(vaultPath, "audio"), { recursive: true });

      const job: Job = {
        type: "transcription-pipeline",
        id: "01j-worker-c",
        vaultPath,
        audioPath,
        transcriptPath,
        sourceNotePath,
        createdAt: "2026-05-13T00:00:00.000Z",
      };
      await enqueue(stateDir, job);
      await claimNext(stateDir);

      await runWorkerForSingleStateDir(stateDir);
      const content = await fs.readFile(transcriptPath, "utf-8");

      expect(content).toContain("status: done");
      await expect(
        fs.stat(join(stateDir, "pending", `${job.id}.json`)),
      ).rejects.toThrow();
      await expect(
        fs.stat(join(stateDir, "done", `${job.id}.json`)),
      ).resolves.toBeDefined();
    });
  });
});
