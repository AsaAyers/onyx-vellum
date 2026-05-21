import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claimNext, enqueue } from "../src/transcription/queue.js";
import { startWorker } from "../src/transcription/worker.js";
import type {
  Job,
  TranscriptionPipelineJob,
} from "../src/transcription/types.js";

const CREATED_DIRS: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  CREATED_DIRS.push(dir);
  return dir;
}

async function runWorkerForSingleJob(
  job: TranscriptionPipelineJob,
): Promise<string> {
  const stateDir = await createTempDir("onyx-vellum-worker-state-");
  await enqueue(stateDir, job);
  return runWorkerForSingleStateDir(stateDir, job.transcriptPath);
}

async function runWorkerForSingleStateDir(
  stateDir: string,
  transcriptPath: string,
): Promise<string> {
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

  return fs.readFile(transcriptPath, "utf-8");
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("transcription worker", () => {
  it("writes source audio wikilink relative to source note", async () => {
    const vaultDir = await createTempDir("onyx-vellum-worker-vault-");
    const audioPath = join(vaultDir, "audio", "clip.m4a");
    const transcriptPath = join(vaultDir, "audio", "clip.transcript.md");
    const sourceNotePath = join(vaultDir, "daily.md");
    await fs.mkdir(join(vaultDir, "audio"), { recursive: true });

    const content = await runWorkerForSingleJob({
      type: "transcription-pipeline",
      id: "01j-worker-a",
      audioPath,
      transcriptPath,
      sourceNotePath,
      createdAt: "2026-05-13T00:00:00.000Z",
    });

    expect(content).toContain("status: done");
    expect(content).toContain("Source audio: [[audio/clip.m4a]]");
  });

  it("supports parent-directory relative paths from nested notes", async () => {
    const vaultDir = await createTempDir("onyx-vellum-worker-vault-");
    const sourceNotePath = join(vaultDir, "notes", "daily.md");
    const audioPath = join(vaultDir, "audio", "clip.m4a");
    const transcriptPath = join(vaultDir, "audio", "clip.transcript.md");
    await fs.mkdir(join(vaultDir, "notes"), { recursive: true });
    await fs.mkdir(join(vaultDir, "audio"), { recursive: true });

    const content = await runWorkerForSingleJob({
      type: "transcription-pipeline",
      id: "01j-worker-b",
      audioPath,
      transcriptPath,
      sourceNotePath,
      createdAt: "2026-05-13T00:00:00.000Z",
    });

    expect(content).toContain("status: done");
    expect(content).toContain("Source audio: [[../audio/clip.m4a]]");
  });

  it("retries stale processing jobs when the worker restarts", async () => {
    const vaultDir = await createTempDir("onyx-vellum-worker-vault-");
    const stateDir = await createTempDir("onyx-vellum-worker-state-");
    const audioPath = join(vaultDir, "audio", "clip.m4a");
    const transcriptPath = join(vaultDir, "audio", "clip.transcript.md");
    const sourceNotePath = join(vaultDir, "daily.md");
    await fs.mkdir(join(vaultDir, "audio"), { recursive: true });

    const job: Job = {
      type: "transcription-pipeline",
      id: "01j-worker-c",
      audioPath,
      transcriptPath,
      sourceNotePath,
      createdAt: "2026-05-13T00:00:00.000Z",
    };
    await enqueue(stateDir, job);
    await claimNext(stateDir);

    const content = await runWorkerForSingleStateDir(stateDir, transcriptPath);

    expect(content).toContain("status: done");
    await expect(
      fs.stat(join(stateDir, "pending", `${job.id}.json`)),
    ).rejects.toThrow();
    await expect(
      fs.stat(join(stateDir, "done", `${job.id}.json`)),
    ).resolves.toBeDefined();
  });
});
