import { promises as fsp, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { Job } from "./types.js";
import { randomUUID } from "crypto";

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

function ensureQueueDirs(stateDir: string): void {
  QUEUE_DIRS.map((dir) =>
    mkdirSync(queuePath(stateDir, dir), { recursive: true }),
  );
}

export function queue(stateDir: string, job: Job): void {
  ensureQueueDirs(stateDir);
  writeFileSync(
    jobPath(stateDir, "pending", job.id),
    `${JSON.stringify(job, null, 2)}\n`,
    "utf-8",
  );
}

export async function claimNext(stateDir: string): Promise<Job | null> {
  await ensureQueueDirs(stateDir);
  const pendingPath = queuePath(stateDir, "pending");
  const files = (await fsp.readdir(pendingPath))
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const from = join(pendingPath, file);
    const to = join(queuePath(stateDir, "processing"), file);
    try {
      await fsp.rename(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw err;
    }
    const raw = await fsp.readFile(to, "utf-8");
    return JSON.parse(raw) as Job;
  }

  return null;
}

export async function markDone(stateDir: string, id: string): Promise<void> {
  await ensureQueueDirs(stateDir);
  await fsp.rename(
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
  await fsp.rename(
    jobPath(stateDir, "processing", id),
    jobPath(stateDir, "failed", id),
  );
  await fsp.writeFile(
    join(queuePath(stateDir, "failed"), `${id}.error.txt`),
    `${error}\n`,
    "utf-8",
  );
}
export function buildJobId(createdAt: Date): string {
  const createdAtMs = createdAt.getTime();
  const uuid = randomUUID();
  return `${createdAtMs.toString(36)}-${uuid}`;
}
export function resolveStateDir(
  env: NodeJS.ProcessEnv,
  vaultPath: string,
): string {
  const configured = env["STATE_DIR"];
  return configured
    ? resolve(configured)
    : join(dirname(vaultPath), DEFAULT_STATE_DIRNAME);
}
const DEFAULT_STATE_DIRNAME = ".onyx-vellum-state";
