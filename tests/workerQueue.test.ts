import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimNext,
  enqueue,
  markDone,
  markFailed,
} from "../src/transcription/queue.js";
import type { Job } from "../src/transcription/types.js";
import { zVaultFile } from "../src/engine/io.js";

const CREATED_DIRS: string[] = [];

async function createStateDir(): Promise<string> {
  const stateDir = await fs.mkdtemp(join(tmpdir(), "onyx-vellum-queue-"));
  CREATED_DIRS.push(stateDir);
  return stateDir;
}

function makeJob(id: string): Job {
  return {
    type: "transcribe",
    id,
    vaultPath: "/vault",
    audioPath: `/vault/audio/${id}.m4a`,
    target: {
      location: {
        file: zVaultFile.parse({
          absolutePath: `/vault/audio/${id}.transcript.md`,
          relativePath: `audio/${id}.transcript.md`,
        }),
        header: "Transcript",
        position: "end",
      },
    },
    createdAt: "2026-05-03T00:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("transcription queue", () => {
  it("enqueue writes a JSON file in pending", async () => {
    const stateDir = await createStateDir();
    const job = makeJob("01j0-a");

    await enqueue(stateDir, job);

    const pendingJson = await fs.readFile(
      join(stateDir, "pending", "01j0-a.json"),
      "utf-8",
    );
    expect(JSON.parse(pendingJson)).toEqual(job);
  });

  it("claimNext returns null when queue is empty", async () => {
    const stateDir = await createStateDir();
    await expect(claimNext(stateDir)).resolves.toBeNull();
  });

  it("claimNext moves the oldest job from pending to processing", async () => {
    const stateDir = await createStateDir();
    // Queue ordering is filename-lexicographic, so this test uses sortable IDs.
    const older = makeJob("01j0-a");
    const newer = makeJob("01j0-b");
    await enqueue(stateDir, newer);
    await enqueue(stateDir, older);

    const claimed = await claimNext(stateDir);

    expect(claimed?.id).toBe("01j0-a");
    await expect(
      fs.stat(join(stateDir, "pending", "01j0-a.json")),
    ).rejects.toThrow();
    await expect(
      fs.stat(join(stateDir, "processing", "01j0-a.json")),
    ).resolves.toBeDefined();
  });

  it("markDone moves a processing job to done", async () => {
    const stateDir = await createStateDir();
    const job = makeJob("01j0-a");
    await enqueue(stateDir, job);
    await claimNext(stateDir);

    await markDone(stateDir, job.id);

    await expect(
      fs.stat(join(stateDir, "processing", `${job.id}.json`)),
    ).rejects.toThrow();
    await expect(
      fs.stat(join(stateDir, "done", `${job.id}.json`)),
    ).resolves.toBeDefined();
  });

  it("markFailed moves a processing job to failed and writes error sidecar", async () => {
    const stateDir = await createStateDir();
    const job = makeJob("01j0-a");
    await enqueue(stateDir, job);
    await claimNext(stateDir);

    await markFailed(stateDir, job.id, "backend unavailable");

    await expect(
      fs.stat(join(stateDir, "processing", `${job.id}.json`)),
    ).rejects.toThrow();
    await expect(
      fs.stat(join(stateDir, "failed", `${job.id}.json`)),
    ).resolves.toBeDefined();
    await expect(
      fs.readFile(join(stateDir, "failed", `${job.id}.error.txt`), "utf-8"),
    ).resolves.toContain("backend unavailable");
  });

  it("concurrent claimNext calls never claim the same job", async () => {
    const stateDir = await createStateDir();
    await enqueue(stateDir, makeJob("01j0-a"));
    await enqueue(stateDir, makeJob("01j0-b"));

    const [first, second] = await Promise.all([
      claimNext(stateDir),
      claimNext(stateDir),
    ]);

    const ids = [first?.id, second?.id].filter(
      (id): id is string => id !== undefined,
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
