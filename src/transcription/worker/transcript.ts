import fs from "node:fs/promises";
import path from "path";
import { dirname } from "path/posix";
import { enqueue, buildJobId } from "../queue.js";
import { trimDeadAir } from "../trimDeadAir.js";
import type { TranscribeJob } from "../types.js";
import type { JobWorker } from "./types.js";

export const transcriptWorker: JobWorker<TranscribeJob> =
  async function transcriptJob({ options, job, fileOperations, debug }) {
    let srcAudio = job.audioPath;
    if (options.trimDeadAir) {
      srcAudio =
        dirname(job.audioPath) +
        "/" +
        path.basename(job.audioPath, ".m4a") +
        "-trimmed.m4a";

      const trimmedFileExists = await fs
        .access(srcAudio)
        .then(() => true)
        .catch(() => false);
      if (!trimmedFileExists) {
        await trimDeadAir({
          input: job.audioPath,
          output: srcAudio,
          thresholdDb: -35,
        });
      }
    }
    debug(`Transcribing ${srcAudio} ${options.trimDeadAir ? "(trimmed)" : ""}`);
    const transcriptText = await options
      .getWhisperBackend()
      .transcribe(srcAudio);
    debug(`Transcript: ${transcriptText}`);

    const createdAt = new Date();
    const id = buildJobId(createdAt);
    job.target.content = transcriptText;
    job.target.frontmatter ??= {};
    job.target.frontmatter.cleanText = id;
    job.target.frontmatter.transcribe = new Date().toISOString();
    fileOperations.updateFile(job.target);

    enqueue(options.stateDir, {
      type: "clean-transcription",
      id,
      vaultPath: job.vaultPath,
      createdAt: createdAt.toISOString(),
      source: job.target.location,
      target: {
        location: job.target.location,
        frontmatter: {
          cleanText: "done",
        },
      },
    });
  };
