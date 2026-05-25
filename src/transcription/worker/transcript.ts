import fs from "node:fs/promises";
import path from "path";
import { dirname } from "path/posix";
import { enqueue, buildJobId } from "../queue.js";
import { trimDeadAir } from "../trimDeadAir.js";
import type { TranscribeJob } from "../types.js";
import type { JobWorker } from "./types.js";

export const transcriptWorker: JobWorker<TranscribeJob> =
  async function transcriptJob({ options, job, fileOperations }) {
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
    const transcriptText = await options.backend.transcribe(srcAudio);
    job.target.content = transcriptText;
    fileOperations.updateFile(job.target);

    fileOperations.updateFile({
      location: job.target.location,
      frontmatter: {
        cleanText: job.id,
      },
    });

    const createdAt = new Date();
    enqueue(options.stateDir, {
      type: "clean-transcription",
      id: buildJobId(createdAt),
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

    // const targetOperation: FileOperation = {
    //   location: {
    //     file: job.target.location.file,
    //     header: "Summary",
    //     position: "end",
    //   },
    //   content: `> [!onyx]+ Summarizing transcript...`,
    // };

    // enqueue(options.stateDir, {
    //   type: "summarize-text",
    //   id: buildJobId(createdAt),
    //   vaultPath: job.vaultPath,
    //   createdAt: createdAt.toISOString(),
    //   source: job.target.location,
    //   target: targetOperation,
    // });
  };
