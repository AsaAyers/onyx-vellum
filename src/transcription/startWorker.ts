import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { fasterWhisperBackend } from "./fasterWhisperBackend.js";
import { buildJobId, claimNext, queue, markDone, markFailed } from "./queue.js";
import { resolveStateDir } from "./queue.js";
import { type Job, type WorkerOptions, type WorkerEvent } from "./types.js";
import { FileWriteManager } from "../engine/FileWriteManager.js";
import { FileOperationExecutor } from "../engine/FileOperationExecutor.js";
import { createParseProcessor } from "../markdown/createParseProcessor.js";
import { loadConfig } from "../loadConfig.js";
import type { PluginContext } from "../markdown/types.js";
import { userLocalTime } from "../engine/userLocalTime.js";
import { transcribe } from "./worker/transcribe.js";
import { cleanTranscript } from "./worker/cleanTranscript.js";
import type { JobWorker } from "./worker/types.js";
import { findTasks } from "./worker/findTasks.js";
import createDebug from "debug";
import { unreachable } from "../unreachable.js";

const DEFAULT_POLL_INTERVAL_MS = 2_000;

const debug = createDebug("onyx:worker");
createDebug.enable("onyx:worker*");

// eslint-disable-next-line no-console
const log = console.log.bind(console);

async function recoverStaleProcessingJobs(stateDir: string): Promise<string[]> {
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

  return files;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWorker(options: WorkerOptions): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger ?? console;
  const emit = options.onEvent
    ? (event: WorkerEvent) => { options.onEvent!(event); }
    : () => {};

  emit({ type: "started" });

  const staleFiles = await recoverStaleProcessingJobs(options.stateDir);
  emit({ type: "recovery-complete", recovered: staleFiles.length });

  const fileOperations = new FileOperationExecutor();
  const ruleContext: Omit<PluginContext, "dates" | "vaultPath"> = {
    updateFile: fileOperations.updateFile,
    jobIdFactory: buildJobId,
    async queueJob(job) {
      await queue(options.stateDir, job);
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
        emit({ type: "poll-idle" });
        await (options.sleep ?? sleep)(pollIntervalMs);
        continue;
      }

      emit({
        type: "job-started",
        jobId: job.id,
        jobType: job.type,
        detail: JSON.stringify(job),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobArgs: Parameters<JobWorker<any>>[0] = {
        options,
        job,
        fileOperations,
        debug: debug.extend(job.type),
        getProcessor,
        getWriteManager,
      };
      switch (job.type) {
        case "transcribe":
          await transcribe(jobArgs);
          break;
        case "summarize-text":
        case "clean-transcription":
          await cleanTranscript(jobArgs);
          break;
        case "find-tasks":
          await findTasks(jobArgs);
          break;
        default:
          logger.error(`Unknown job type: ${JSON.stringify(job)}`);
          unreachable(job);
      }

      log(
        `Completed job ${job.type}. Changes: ${fileOperations.hasPendingOperations()}`,
      );

      if (fileOperations.hasPendingOperations()) {
        const vaultPath = job.vaultPath;
        const fileWriteManger = getWriteManager(vaultPath);
        const processor = await getProcessor(vaultPath);
        await fileOperations.execute(processor, fileWriteManger);
        await fileWriteManger.commit(false);
      }

      await markDone(options.stateDir, job.id);

      emit({
        type: "job-completed",
        jobId: job.id,
        jobType: job.type,
        detail: JSON.stringify(job),
      });
      continue;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(options.stateDir, lastJob!.id, message);
      console.error(err);
      logger.error(`worker loop error: [${lastJob?.type}] ${message}`);

      if (lastJob) {
        emit({
          type: "job-failed",
          jobId: lastJob.id,
          jobType: lastJob.type,
          detail: JSON.stringify(lastJob),
          error: message,
        });
      }

      await sleep(pollIntervalMs);
    }
  }
}

async function main(): Promise<void> {
  const vaultPath = process.env["VAULT_PATH"] ?? "/vault";
  const stateDir = resolveStateDir(process.env, vaultPath);

  log(`Starting transcription worker...`);
  log(`Vault: ${vaultPath}`);
  log(`State dir: ${stateDir}`);

  let backend: ReturnType<typeof fasterWhisperBackend> | null = null;
  await startWorker({
    stateDir,
    getWhisperBackend: () => {
      backend ??= fasterWhisperBackend({
        executablePath: process.env["FASTER_WHISPER_EXECUTABLE"],
        scriptPath: process.env["FASTER_WHISPER_SCRIPT"],
        model: process.env["FASTER_WHISPER_MODEL"],
        device: process.env["FASTER_WHISPER_DEVICE"],
        computeType: process.env["FASTER_WHISPER_COMPUTE_TYPE"],
        downloadRoot: process.env["FASTER_WHISPER_DOWNLOAD_ROOT"],
      });
      return backend;
    },
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
