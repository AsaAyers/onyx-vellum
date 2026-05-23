import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAllRules } from "../src/engine/runner.js";

const CREATED_DIRS: string[] = [];
const TODAY = new Date(2026, 4, 3);

async function createTempVault(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "onyx-vellum-transcript-rule-"));
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

describe("moveDoneTasks - config opt-in", () => {
  it("does not move anything when dailyNotesFolder is not configured", async () => {
    const vaultPath = await createTempVault();
    await fs.mkdir(join(vaultPath, "audio"), { recursive: true });
    await fs.writeFile(
      join(vaultPath, ".onyx-vellum.json"),
      '{\n  "rules": {\n    "moveDoneTasks": {}\n  }\n}\n',
      "utf-8",
    );
    await fs.writeFile(
      join(vaultPath, "audio", "session.transcript.md"),
      "* [x] Keep in transcript done:2026-05-01\n",
      "utf-8",
    );

    await runAllRules({
      vaultPath,
      todayDate: TODAY,
      dryRun: false,
      env: {},
      mode: "all",
    });

    const transcript = await fs.readFile(
      join(vaultPath, "audio", "session.transcript.md"),
      "utf-8",
    );
    expect(transcript).toContain("* [x] Keep in transcript done:2026-05-01");
  });
});
