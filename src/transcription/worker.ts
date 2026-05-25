import { promises as fs } from "node:fs";
import path, { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { taskArraySchema } from "../markdown/tasks.js";
import { createFasterWhisperBackend } from "./fasterWhisperBackend.js";
import { formatTranscriptFile, type TranscriptionStatus } from "./format.js";
import {
  buildJobId,
  claimNext,
  enqueue,
  markDone,
  markFailed,
} from "./queue.js";
import { resolveStateDir } from "./queue.js";
import type { Job, TranscriptionPipelineJob, WorkerOptions } from "./types.js";
import { trimDeadAir } from "./trimDeadAir.js";
import os from "node:os";
import type z from "zod";
import { FileWriteManager } from "../engine/io.js";
import { FileOperationExecutor } from "../engine/FileOperationExecutor.js";
import { createParseProcessor } from "../markdown/parse.js";
import { loadConfig } from "../config.js";
import type { PluginContext } from "../markdown/PluginContext.js";
import { userLocalTime } from "../engine/timezone.js";
import { transcriptWorker } from "./worker/transcript.js";
import {
  processRawTranscript,
  summarizeTextWorker,
  type TranscriptResult,
} from "./worker/cleanTranscript.js";
import type { JobWorker } from "./worker/types.js";
import { gatherTasks } from "./worker/findTasks.js";

const DEFAULT_POLL_INTERVAL_MS = 2_000;

function buildSourceAudioWikilink(job: TranscriptionPipelineJob): string {
  const sourceDir = dirname(job.sourceNotePath);
  const relTarget = relative(sourceDir, job.audioPath).replace(/\\/g, "/");
  return `[[${relTarget}]]`;
}

async function recoverStaleProcessingJobs(stateDir: string): Promise<void> {
  const processingDir = `${stateDir}/processing`;
  const pendingDir = `${stateDir}/pending`;
  await fs.mkdir(processingDir, { recursive: true });
  await fs.mkdir(pendingDir, { recursive: true });
  const files = (await fs.readdir(processingDir))
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  await Promise.all(
    files.map((file) =>
      fs.rename(`${processingDir}/${file}`, `${pendingDir}/${file}`),
    ),
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWorker(options: WorkerOptions): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger ?? console;

  await recoverStaleProcessingJobs(options.stateDir);

  const fileOperations = new FileOperationExecutor();
  const ruleContext: Omit<PluginContext, "dates" | "vaultPath"> = {
    updateFile: fileOperations.updateFile,
    jobIdFactory: buildJobId,
    async queueJob(job) {
      await enqueue(options.stateDir, job);
    },
    env: process.env,
    mode: "normalize",
    dryRun: false,
  };

  const writeManagers = new Map<string, FileWriteManager>();
  const getWriteManager = (vaultPath: string): FileWriteManager => {
    let manager = writeManagers.get(vaultPath);
    if (!manager) {
      manager = new FileWriteManager(vaultPath);
      writeManagers.set(vaultPath, manager);
    }
    return manager;
  };

  const getProcessor = async (vaultPath: string) => {
    const config = await loadConfig(vaultPath);
    return createParseProcessor(config, {
      ...ruleContext,
      jobIdFactory: buildJobId,
      vaultPath,
      dates: userLocalTime({ tz: config.timezone ?? "UTC" }),
    });
  };

  let lastJob: Job | null = null;
  while (options.shouldContinue?.() ?? true) {
    try {
      const job = await claimNext(options.stateDir);
      lastJob = job;
      if (!job) {
        await (options.sleep ?? sleep)(pollIntervalMs);
        continue;
      }

      if (job.type !== "transcription-pipeline") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jobArgs: Parameters<JobWorker<any>>[0] = {
          options,
          job,
          fileOperations,
          getProcessor,
          getWriteManager,
        };
        switch (job.type) {
          case "transcribe":
            await transcriptWorker(jobArgs);
            break;
          case "summarize-text":
          case "clean-transcription":
            await summarizeTextWorker(jobArgs);
            break;
          case "find-tasks":
          default:
            logger.error(`Unknown job type: ${job.type}`);
        }

        console.log(
          `Completed job ${job.id}. Changes: ${fileOperations.hasPendingOperations()}`,
        );
        if (fileOperations.hasPendingOperations()) {
          const vaultPath = job.vaultPath;
          const fileWriteManger = getWriteManager(vaultPath);
          const processor = await getProcessor(vaultPath);
          await fileOperations.execute(processor, fileWriteManger);
          await fileWriteManger.commit(false);
        }
        continue;
      }

      console.log(`Claimed job ${job.id} for audio ${job.audioPath}`);

      const sourceAudioWikilink = buildSourceAudioWikilink(job);
      let transcriptText: string | undefined;
      let transcriptResult: TranscriptResult | undefined;
      let trimmedFile = job.audioPath;
      let tasks: z.infer<typeof taskArraySchema> = [];

      let lastStatus: TranscriptionStatus = "pending";
      const writeFile = async (
        status: TranscriptionStatus,
        errorMessage?: string,
      ) => {
        lastStatus = status;
        await fs.writeFile(
          job.transcriptPath,
          formatTranscriptFile({
            jobId: job.id,
            sourceAudioWikilink,
            trimmed: trimmedFile !== job.audioPath,
            transcriptText,
            transcriptResult,
            status,
            tasks,
            errorMessage,
          }),
          "utf-8",
        );
      };
      try {
        await writeFile("trimDeadAir");

        if (options.trimDeadAir) {
          trimmedFile = path.join(
            os.tmpdir(),
            `trimmed-${Math.random().toString(16).slice(2)}.m4a`,
          );

          trimmedFile =
            dirname(job.audioPath) +
            "/" +
            path.basename(job.audioPath, ".m4a") +
            "-trimmed.m4a";

          const trimmedFileExists = await fs
            .access(trimmedFile)
            .then(() => true)
            .catch(() => false);
          if (!trimmedFileExists) {
            await writeFile("trimDeadAir");
            await trimDeadAir({
              input: job.audioPath,
              output: trimmedFile,
              thresholdDb: -35,
            });
          }
        }

        await writeFile("transcribing");
        transcriptText = await options.backend.transcribe(trimmedFile);

        if (options.ollamaHost) {
          await writeFile("processingTranscript");
          transcriptResult = await processRawTranscript(transcriptText);

          await writeFile("gatheringTasks");
          tasks = await gatherTasks(transcriptResult.cleanedTranscript);
        }

        await writeFile("done");
        await markDone(options.stateDir, job.id);
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : String(err);
        await writeFile("fail", `lastStatus: ${lastStatus}\n\n${message}`);
        await markFailed(options.stateDir, job.id, message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      logger.error(`worker loop error: [${lastJob?.type}] ${message}`);
      await sleep(pollIntervalMs);
    }
  }
}

async function main(): Promise<void> {
  const vaultPath = process.env["VAULT_PATH"] ?? "/vault";
  const stateDir = resolveStateDir(process.env, vaultPath);
  const backend = createFasterWhisperBackend({
    executablePath: process.env["FASTER_WHISPER_EXECUTABLE"],
    scriptPath: process.env["FASTER_WHISPER_SCRIPT"],
    model: process.env["FASTER_WHISPER_MODEL"],
    device: process.env["FASTER_WHISPER_DEVICE"],
    computeType: process.env["FASTER_WHISPER_COMPUTE_TYPE"],
    downloadRoot: process.env["FASTER_WHISPER_DOWNLOAD_ROOT"],
  });

  console.log(`Starting transcription worker...`);
  console.log(`Vault: ${vaultPath}`);
  console.log(`State dir: ${stateDir}`);

  await startWorker({
    stateDir,
    backend,
    trimDeadAir: true,
    ollamaHost: process.env.OLLAMA_HOST,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error("Fatal transcription worker error:", (err as Error).message);
    process.exit(1);
  });
}
