import { spawn } from "node:child_process";
import type { TranscriberBackend } from "./types.js";
import invariant from "tiny-invariant";

type FasterWhisperBackendOptions = {
  executablePath?: string;
  scriptPath?: string;
  model?: string;
  device?: string;
  computeType?: string;
  downloadRoot?: string;
};

type ReadyMessage = {
  type: "ready";
};

type ResultMessage = {
  type: "result";
  text: string;
};

type ErrorMessage = {
  type: "error";
  error: string;
};

type BackendMessage = ReadyMessage | ResultMessage | ErrorMessage;

export function fasterWhisperBackend(
  options: FasterWhisperBackendOptions = {},
): TranscriberBackend {
  const executablePath = options.executablePath ?? "python3";
  const scriptPath =
    options.scriptPath ?? "/app/scripts/faster_whisper_service.py";
  const args = [
    scriptPath,
    "--model",
    options.model ?? "large-v3",
    "--device",
    options.device ?? "cuda",
    "--compute-type",
    options.computeType ?? "float16",
  ];
  if (options.downloadRoot) {
    args.push("--download-root", options.downloadRoot);
  }

  const child = spawn(executablePath, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const readyState: {
    resolve?: () => void;
    reject?: (reason: Error) => void;
    settled: boolean;
  } = {
    settled: false,
  };
  const ready = new Promise<void>((resolve, reject) => {
    readyState.resolve = () => {
      if (readyState.settled) {
        return;
      }
      readyState.settled = true;
      resolve();
    };
    readyState.reject = (reason: Error) => {
      if (readyState.settled) {
        return;
      }
      readyState.settled = true;
      reject(reason);
    };
  });
  let isReady = false;
  let pending:
    | {
        resolve: (value: string) => void;
        reject: (reason: Error) => void;
        promise?: Promise<string>;
      }
    | undefined;

  function rejectPending(message: string): void {
    pending?.reject(new Error(message));
    pending = undefined;
  }

  function handleMessage(message: BackendMessage): void {
    if (message.type === "ready") {
      isReady = true;
      readyState.resolve?.();
      return;
    }

    if (!pending) {
      return;
    }

    if (message.type === "result") {
      pending.resolve(message.text);
    } else {
      pending.reject(new Error(message.error));
    }
    pending = undefined;
  }

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      try {
        handleMessage(JSON.parse(line) as BackendMessage);
      } catch (err) {
        const message =
          err instanceof Error
            ? `Failed to parse backend message: ${err.message}`
            : "Failed to parse backend message";
        if (!isReady) {
          readyState.reject?.(new Error(message));
        }
        rejectPending(message);
      }
    }
  });

  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer += chunk;
  });

  child.on("error", (err) => {
    if (!isReady) {
      readyState.reject?.(err);
    }
    rejectPending(err.message);
  });

  child.on("exit", (code, signal) => {
    const details = stderrBuffer.trim();
    const suffix = details ? `: ${details}` : "";
    const reason =
      signal !== null
        ? `faster-whisper backend exited via signal ${signal}${suffix}`
        : `faster-whisper backend exited with code ${code ?? "unknown"}${suffix}`;
    if (!isReady) {
      readyState.reject?.(new Error(reason));
    }
    rejectPending(reason);
  });

  return {
    async transcribe(audioPath: string): Promise<string> {
      await ready;
      if (pending && pending.promise) {
        // The promise needs to be wrapped and replaced, so that if 2 new items
        // arrive while 1 is still processing, they will be processed in order
        // rather than all resolving/rejecting with the same promise.
        const t = Promise.resolve(pending.promise);
        pending.promise = t;
        await t;
      }

      const promise = new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        child.stdin.write(`${JSON.stringify({ audioPath })}\n`, "utf-8");
      });
      invariant(pending, "Missing pending after creating promise");
      pending.promise = promise;
      return promise;
    },
  };
}
