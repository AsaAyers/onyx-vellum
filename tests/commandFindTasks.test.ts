import { describe, expect, it } from "vitest";
import { createTempDir } from "./createTempDir.js";
import { join } from "node:path";
import { runner } from "../src/engine/runner.js";
import { testDate } from "./testDate.js";
import fs from "node:fs/promises";
import type { Job } from "../src/transcription/types.js";

/**
 * example voice transcript of someone telling what their plan is for today
 */
const exampleTranscript = `
# Transcript

Hey, so today I need to clean the car, and I also have to take out the trash.
Oh, and I should probably call mom too. Maybe I'll do that after I finish
cleaning the car.

#onyx/tasks

# Other notes

Bacon Ipsum
`;

describe("Command: #onyx/tasks", () => {
  it("should detect #onyx/tasks in a command and queue a 'find-tasks' job", async () => {
    const vaultPath = await createTempDir("onyx-vellum-worker-vault-");

    await fs.mkdir(join(vaultPath, "audio"), { recursive: true });
    await fs.writeFile(
      join(vaultPath, ".onyx-vellum.json"),
      '{\n  "rules": {}\n}\n',
      "utf-8",
    );
    await fs.writeFile(
      join(vaultPath, "audio", "session.transcript.md"),
      exampleTranscript,
      "utf-8",
    );
    const readTranscriptFile = () =>
      fs.readFile(join(vaultPath, "audio", "session.transcript.md"), "utf-8");

    expect(await readTranscriptFile()).toContain("#onyx/tasks");
    const jobs: Job[] = [];
    await runner({
      vaultPath,
      dates: testDate,
      dryRun: false,
      jobIdFactory: () => "mpligejw-32d7d796-4e0b-4d40-999a-4371f48d8b36",
      env: {},
      mode: "all",
      queueJob: (job) => jobs.push(job),
    });

    const j = JSON.parse(
      JSON.stringify(
        jobs,

        (key, value) => {
          if (typeof value === "string") {
            return value.replaceAll(
              /onyx-vellum-worker-vault-....../g,
              "onyx-vellum-worker-vault-XXXXXX",
            );
          }
          return value;
        },
      ),
    );

    delete j[0].createdAt;
    expect(j).toMatchInlineSnapshot(`
      [
        {
          "id": "mpligejw-32d7d796-4e0b-4d40-999a-4371f48d8b36",
          "source": {
            "file": {
              "absolutePath": "/tmp/onyx-vellum-worker-vault-XXXXXX/audio/session.transcript.md",
              "relativePath": "audio/session.transcript.md",
              "vaultPath": "/tmp/onyx-vellum-worker-vault-XXXXXX",
            },
            "header": "Transcript",
            "position": "end",
          },
          "target": {
            "frontmatter": {
              "tasks": "mpligejw-32d7d796-4e0b-4d40-999a-4371f48d8b36",
            },
            "location": {
              "file": {
                "absolutePath": "/tmp/onyx-vellum-worker-vault-XXXXXX/audio/session.transcript.md",
                "relativePath": "audio/session.transcript.md",
                "vaultPath": "/tmp/onyx-vellum-worker-vault-XXXXXX",
              },
              "header": "Tasks",
              "position": "end",
            },
          },
          "type": "find-tasks",
          "vaultPath": "/tmp/onyx-vellum-worker-vault-XXXXXX",
        },
      ]
    `);

    expect(await readTranscriptFile()).not.toContain("#onyx/tasks");
  });
});
