import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const CREATED_DIRS: string[] = [];

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

export async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  CREATED_DIRS.push(dir);
  return dir;
}
