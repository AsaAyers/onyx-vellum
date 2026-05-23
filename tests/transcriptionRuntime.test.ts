import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAllRules } from "../src/engine/runner.js";
import { resolveStateDir } from "../src/transcription/runtime.js";

const CREATED_DIRS: string[] = [];
const TODAY = new Date(2026, 4, 3);

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  CREATED_DIRS.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("transcription runtime", () => {
  it("enqueues transcription jobs into STATE_DIR when rules run for real", async () => {
    const vaultPath = await createTempDir("onyx-vellum-vault-");
    const stateDir = await createTempDir("onyx-vellum-state-");
    await fs.mkdir(join(vaultPath, "audio"), { recursive: true });
    await fs.writeFile(
      join(vaultPath, "daily.md"),
      "# Daily\n\n![[audio/clip.m4a]]\n",
      "utf-8",
    );
    await fs.writeFile(join(vaultPath, "audio", "clip.m4a"), "audio", "utf-8");

    await runAllRules({
      vaultPath,
      todayDate: TODAY,
      dryRun: false,
      env: { STATE_DIR: stateDir },
      mode: "all",
    });

    const noteContent = await fs.readFile(join(vaultPath, "daily.md"), "utf-8");
    expect(noteContent).toContain("![[audio/clip.transcript.md]]");

    const transcriptContent = await fs.readFile(
      join(vaultPath, "audio", "clip.transcript.md"),
      "utf-8",
    );
    const pendingFiles = await fs.readdir(join(stateDir, "pending"));
    expect(pendingFiles).toHaveLength(1);
    expect(pendingFiles[0]).toBeDefined();
    const pendingFile = pendingFiles[0]!;
    const pendingJob = await fs.readFile(
      join(stateDir, "pending", pendingFile),
      "utf-8",
    );

    expect(transcriptContent).toContain("status: pending");
    expect(pendingJob).toContain(
      `"audioPath": "${join(vaultPath, "audio", "clip.m4a")}"`,
    );
  });

  it("defaults the state directory to a vault sibling outside the vault", () => {
    const vaultPath = "/tmp/example/vault";
    expect(resolveStateDir({}, vaultPath)).toBe(
      join(dirname(vaultPath), ".onyx-vellum-state"),
    );
  });
});
