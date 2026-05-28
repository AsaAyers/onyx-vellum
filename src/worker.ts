import { fileURLToPath } from "url";
import { fasterWhisperBackend } from "./transcription/fasterWhisperBackend.js";
import { resolveStateDir } from "./transcription/queue.js";
import { startWorker } from "./transcription/startWorker.js";

// eslint-disable-next-line no-console
const log = console.log.bind(console);

export async function worker(): Promise<void> {
  const vaultPath = process.env["VAULT_PATH"] ?? "/vault";
  const stateDir = resolveStateDir(process.env, vaultPath);

  const backendOptions = {
    executablePath: process.env["FASTER_WHISPER_EXECUTABLE"],
    scriptPath: process.env["FASTER_WHISPER_SCRIPT"],
    model: process.env["FASTER_WHISPER_MODEL"],
    device: process.env["FASTER_WHISPER_DEVICE"],
    computeType: process.env["FASTER_WHISPER_COMPUTE_TYPE"],
    downloadRoot: process.env["FASTER_WHISPER_DOWNLOAD_ROOT"],
  };

  if (!process.stdout.isTTY) {
    log(`Starting transcription worker...`);
    log(`Vault: ${vaultPath}`);
    log(`State dir: ${stateDir}`);

    let backend: ReturnType<typeof fasterWhisperBackend> | null = null;
    await startWorker({
      stateDir,
      getWhisperBackend: () => {
        backend ??= fasterWhisperBackend(backendOptions);
        return backend;
      },
      trimDeadAir: true,
      ollamaHost: process.env.OLLAMA_HOST,
    });
    return;
  }

  const { createWorkerTui } = await import("./tui/worker/WorkerTui.js");
  let running = true;

  const tui = createWorkerTui({
    onStop: () => {
      running = false;
    },
  });

  process.on("SIGINT", () => {
    running = false;
  });

  let backend: ReturnType<typeof fasterWhisperBackend> | null = null;
  await startWorker({
    stateDir,
    getWhisperBackend: () => {
      backend ??= fasterWhisperBackend(backendOptions);
      return backend;
    },
    trimDeadAir: true,
    ollamaHost: process.env.OLLAMA_HOST,
    shouldContinue: () => running,
    onEvent: (event) => tui.store.dispatch(event),
  });

  tui.stop();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  worker().catch((err: unknown) => {
    console.error("Fatal transcription worker error:", (err as Error).message);
    process.exit(1);
  });
}
