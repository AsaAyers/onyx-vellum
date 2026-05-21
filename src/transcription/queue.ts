import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Job } from "./types.js";

const QUEUE_DIRS = ["pending", "processing", "done", "failed"] as const;

function queuePath(stateDir: string, dir: (typeof QUEUE_DIRS)[number]): string {
  return join(stateDir, dir);
}

function jobPath(
  stateDir: string,
  dir: (typeof QUEUE_DIRS)[number],
  id: string,
): string {
  return join(queuePath(stateDir, dir), `${id}.json`);
}

async function ensureQueueDirs(stateDir: string): Promise<void> {
  await Promise.all(
    QUEUE_DIRS.map((dir) =>
      fs.mkdir(queuePath(stateDir, dir), { recursive: true }),
    ),
  );
}

export async function enqueue(stateDir: string, job: Job): Promise<void> {
  await ensureQueueDirs(stateDir);
  await fs.writeFile(
    jobPath(stateDir, "pending", job.id),
    `${JSON.stringify(job, null, 2)}\n`,
    "utf-8",
  );
}

export async function claimNext(stateDir: string): Promise<Job | null> {
  await ensureQueueDirs(stateDir);
  const pendingPath = queuePath(stateDir, "pending");
  const files = (await fs.readdir(pendingPath))
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const from = join(pendingPath, file);
    const to = join(queuePath(stateDir, "processing"), file);
    try {
      await fs.rename(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw err;
    }
    const raw = await fs.readFile(to, "utf-8");
    return JSON.parse(raw) as Job;
  }

  return null;
}

export async function markDone(stateDir: string, id: string): Promise<void> {
  await ensureQueueDirs(stateDir);
  await fs.rename(
    jobPath(stateDir, "processing", id),
    jobPath(stateDir, "done", id),
  );
}

export async function markFailed(
  stateDir: string,
  id: string,
  error: string,
): Promise<void> {
  await ensureQueueDirs(stateDir);
  await fs.rename(
    jobPath(stateDir, "processing", id),
    jobPath(stateDir, "failed", id),
  );
  await fs.writeFile(
    join(queuePath(stateDir, "failed"), `${id}.error.txt`),
    `${error}\n`,
    "utf-8",
  );
}
