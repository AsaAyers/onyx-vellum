import fs from "node:fs/promises";
import path from "path";
import { dirname } from "path/posix";
import { queue, buildJobId } from "../queue.js";
import { getAudioDurationSeconds, trimDeadAir } from "../trimDeadAir.js";
import type { TranscribeJob } from "../types.js";
import type { JobWorker } from "./types.js";

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const transcribe: JobWorker<TranscribeJob> =
  async function transcriptJob({ options, job, fileOperations, debug }) {
    let srcAudio = job.audioPath;
    if (options.trimDeadAir) {
      const originalDuration = await getAudioDurationSeconds(job.audioPath);

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

      if (originalDuration !== null) {
        const trimmedDuration = await getAudioDurationSeconds(srcAudio);
        if (trimmedDuration !== null) {
          const diff = Math.round(originalDuration - trimmedDuration);
          if (diff > 0) {
            job.target.frontmatter ??= {};
            job.target.frontmatter.deadAir = formatDuration(diff);
          }
        }
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

    queue(options.stateDir, {
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
