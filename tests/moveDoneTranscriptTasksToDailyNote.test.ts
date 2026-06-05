import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { runner } from "../src/engine/runner.js";
import { testDate } from "./testDate.js";
import { createTempDir } from "./createTempDir.js";

describe("moveDoneTasks - frontmatter opt-in", () => {
  it("does not move anything when moveDoneTasks frontmatter is not configured", async () => {
    const vaultPath = await createTempDir("onyx-vellum-transcript-rule-");
    await fs.mkdir(join(vaultPath, "audio"), { recursive: true });
    await fs.writeFile(
      join(vaultPath, ".onyx-vellum.json"),
      '{\n  "rules": {\n    "moveDoneTasks": {}\n  }\n}\n',
      "utf-8",
    );
    await fs.writeFile(
      join(vaultPath, "audio", "session.transcript.md"),
      "* [x] Keep in transcript ✅:2026-05-01\n",
      "utf-8",
    );

    await runner({
      vaultPath,
      dates: testDate,
      dryRun: false,
      env: {},
      mode: "all",
      queueJob: async () => {},
    });

    const transcript = await fs.readFile(
      join(vaultPath, "audio", "session.transcript.md"),
      "utf-8",
    );
    expect(transcript).toContain("* [x] Keep in transcript ✅:2026-05-01");
  });
});
