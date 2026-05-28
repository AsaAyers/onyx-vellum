import { promises as fs } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { queue } from "../src/transcription/queue.js";
import { startWorker } from "../src/transcription/startWorker.js";
import {
  zJob,
  type ContentLocation,
  type Job,
  type WorkerEvent,
} from "../src/transcription/types.js";
import { VaultFile } from "../src/engine/VaultFile.js";
import { createTempDir } from "./createTempDir.js";

const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

async function runWorkerForSingleJob(job: Job) {
  const stateDir = await createTempDir("onyx-vellum-worker-state-");
  queue(stateDir, job);
  return runWorkerForSingleStateDir(stateDir);
}

async function runWorkerForSingleStateDir(stateDir: string) {
  let shouldRun = true;
  await startWorker({
    stateDir,
    getWhisperBackend: () => ({
      async transcribe() {
        return "transcript body";
      },
    }),
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

describe("workers", () => {
  let vaultPath = "";
  beforeEach(async () => {
    vaultPath = await createTempDir("onyx-vellum-worker-vault-");
  });

  describe("transcription", async () => {
    it("Creates a transcript from the audio file", async () => {
      const audioPath = join(vaultPath, "audio", "clip.m4a");
      const audioPath2 = join(vaultPath, "audio", "clip2.m4a");
      const transcriptPath = join(vaultPath, "audio", "clip.transcript.md");
      await fs.mkdir(join(vaultPath, "audio"), { recursive: true });
      await fs.writeFile(
        transcriptPath,
        `Source audio: [[audio/clip.m4a]]

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
            file: new VaultFile({
              relativePath: "audio/clip.transcript.md",
              absolutePath: transcriptPath,
              vaultPath,
            }),
            header: "Header 3",
            position: "end",
          },
        },
      };
      await runWorkerForSingleJob(transcriptionJob);
      transcriptionJob.audioPath = audioPath2;
      transcriptionJob.target.location.header = "Header 1";
      transcriptionJob.target.location.position = "start";
      await runWorkerForSingleJob(transcriptionJob);
      const content = await fs.readFile(transcriptPath, "utf-8");

      expect(
        content
          .replace(
            /cleanText: [a-z0-9\-]+/g,
            "cleanText: mpm64xtf-6cc39d2f-274d-488e-b193-a33120a4baba",
          )
          .replaceAll(isoRegex, "2024-01-01T00:00:00.000Z"),
      ).toMatchInlineSnapshot(`
        "---
        cleanText: mpm64xtf-6cc39d2f-274d-488e-b193-a33120a4baba
        transcribe: '2024-01-01T00:00:00.000Z'
        ---

        Source audio: [[audio/clip.m4a]]

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

  describe("clean-transcription", async () => {
    it("Cleans up the raw transcript from Whisper", async () => {
      const transcriptPath = join(vaultPath, "audio", "clip.transcript.md");
      await fs.mkdir(join(vaultPath, "audio"), { recursive: true });
      const header = "Some serious content";
      await fs.writeFile(
        transcriptPath,
        `# ${header}

Bacon ipsum dolor amet pork 
loin venison tongue,
chislic doner corned beef
`,
        "utf-8",
      );

      const source: ContentLocation = {
        file: new VaultFile({
          relativePath: "audio/clip.transcript.md",
          absolutePath: transcriptPath,
          vaultPath,
        }),
        header,
        position: "end",
      };
      await runWorkerForSingleJob(
        zJob.parse({
          type: "clean-transcription",
          vaultPath,
          id: "01j-worker-a",
          source,
          target: {
            location: source,
          },
        }),
      );
      const content = await fs.readFile(transcriptPath, "utf-8");

      expect(content.replaceAll(isoRegex, "2024-01-01T00:00:00.000Z"))
        .toMatchInlineSnapshot(`
        "---
        filename: some-serious-content.md
        cleanText: '2024-01-01T00:00:00.000Z'
        ---

        # Summary

        SuMmArY: bAcOn iPsUm dOlOr aM...

        # Some serious content

        BaCoN IpSuM DoLoR AmEt pOrK LoIn vEnIsOn tOnGuE, cHiSlIc dOnEr cOrNeD BeEf
        "
      `);
    });
  });

  describe("worker events", async () => {
    it("emits started, job-started, job-completed for a successful job", async () => {
      const stateDir = await createTempDir("onyx-vellum-worker-state-");
      const vaultPath = await createTempDir("onyx-vellum-worker-vault-");

      const audioPath = join(vaultPath, "audio", "test.m4a");
      const transcriptPath = join(vaultPath, "audio", "test.transcript.md");
      await fs.mkdir(join(vaultPath, "audio"), { recursive: true });
      await fs.writeFile(transcriptPath, "# Header\n", "utf-8");

      const job: Job = {
        type: "transcribe",
        id: "01j-event-test",
        vaultPath,
        audioPath,
        target: {
          location: {
            file: new VaultFile({
              relativePath: "audio/test.transcript.md",
              absolutePath: transcriptPath,
              vaultPath,
            }),
            header: null,
            position: "start",
          },
        },
      };
      await queue(stateDir, job);

      const events: WorkerEvent[] = [];
      let shouldRun = true;

      await startWorker({
        stateDir,
        getWhisperBackend: () => ({
          async transcribe() {
            return "transcript body";
          },
        }),
        pollIntervalMs: 1,
        shouldContinue: () => {
          if (shouldRun) {
            shouldRun = false;
            return true;
          }
          return false;
        },
        sleep: async () => Promise.resolve(),
        onEvent: (event) => {
          events.push(event);
        },
      });

      expect(events.some((e) => e.type === "started")).toBe(true);
      expect(events.some((e) => e.type === "recovery-complete")).toBe(true);
      expect(events.some((e) => e.type === "job-started")).toBe(true);
      expect(events.some((e) => e.type === "job-completed")).toBe(true);

      const started = events.find((e) => e.type === "job-started");
      expect(started).toBeDefined();
      if (started && started.type === "job-started") {
        expect(started.jobId).toBe("01j-event-test");
        expect(started.jobType).toBe("transcribe");
      }
    });

    it("emits started, recovery-complete, poll-idle when no jobs", async () => {
      const stateDir = await createTempDir("onyx-vellum-worker-state-");
      const events: WorkerEvent[] = [];
      let shouldRun = true;

      await startWorker({
        stateDir,
        getWhisperBackend: () => ({
          async transcribe() {
            return "";
          },
        }),
        pollIntervalMs: 1,
        shouldContinue: () => {
          if (shouldRun) {
            shouldRun = false;
            return true;
          }
          return false;
        },
        sleep: async () => Promise.resolve(),
        onEvent: (event) => {
          events.push(event);
        },
      });

      expect(events.some((e) => e.type === "started")).toBe(true);
      expect(events.some((e) => e.type === "recovery-complete")).toBe(true);
      expect(events.some((e) => e.type === "poll-idle")).toBe(true);
    });
  });
});
