import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFasterWhisperBackend } from "./fasterWhisperBackend.js";
import { buildJobId, claimNext, enqueue, markDone } from "./queue.js";
import { resolveStateDir } from "./queue.js";
import { type Job, type WorkerOptions } from "./types.js";
import { FileWriteManager } from "../engine/io.js";
import { FileOperationExecutor } from "../engine/FileOperationExecutor.js";
import { createParseProcessor } from "../markdown/parse.js";
import { loadConfig } from "../config.js";
import type { PluginContext } from "../markdown/PluginContext.js";
import { userLocalTime } from "../engine/timezone.js";
import { transcriptWorker } from "./worker/transcript.js";
import { summarizeTextWorker } from "./worker/cleanTranscript.js";
import type { JobWorker } from "./worker/types.js";
import { findTasksWorker } from "./worker/findTasks.js";
import createDebug from "debug";
import { unreachable } from "../unreachable.js";

const DEFAULT_POLL_INTERVAL_MS = 2_000;

const debug = createDebug("onyx:worker");
createDebug.enable("onyx:worker*");

// eslint-disable-next-line no-console
const log = console.log.bind(console);

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
          await transcriptWorker(jobArgs);
          break;
        case "summarize-text":
        case "clean-transcription":
          await summarizeTextWorker(jobArgs);
          break;
        case "find-tasks":
          await findTasksWorker(jobArgs);
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
      continue;
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

  log(`Starting transcription worker...`);
  log(`Vault: ${vaultPath}`);
  log(`State dir: ${stateDir}`);

  let backend: ReturnType<typeof createFasterWhisperBackend> | null = null;
  await startWorker({
    stateDir,
    getWhisperBackend: () => {
      backend ??= createFasterWhisperBackend({
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
