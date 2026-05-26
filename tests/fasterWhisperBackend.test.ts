import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fasterWhisperBackend } from "../src/transcription/fasterWhisperBackend.js";

const CREATED_DIRS: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  CREATED_DIRS.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("createFasterWhisperBackend", () => {
  it("reuses a single long-lived backend process across transcriptions", async () => {
    const dir = await createTempDir("onyx-vellum-backend-");
    const scriptPath = join(dir, "mock-backend.mjs");
    await fs.writeFile(
      scriptPath,
      `let calls = 0;
process.stdout.write(JSON.stringify({ type: "ready" }) + "\\n");
process.stdin.setEncoding("utf-8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newlineIndex = buffer.indexOf("\\n");
    if (newlineIndex === -1) break;
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const payload = JSON.parse(line);
    const fileName = payload.audioPath.split("/").pop() ?? "unknown";
    calls += 1;
    process.stdout.write(
      JSON.stringify({
        type: "result",
        text: \`call-\${calls}:\${fileName}\`,
      }) + "\\n",
    );
  }
});
`,
      "utf-8",
    );

    const backend = fasterWhisperBackend({
      executablePath: process.execPath,
      scriptPath,
    });

    await expect(backend.transcribe("/vault/audio/one.m4a")).resolves.toBe(
      "call-1:one.m4a",
    );
    await expect(backend.transcribe("/vault/audio/two.m4a")).resolves.toBe(
      "call-2:two.m4a",
    );
  });

  it("surfaces backend-side transcription errors", async () => {
    const dir = await createTempDir("onyx-vellum-backend-");
    const scriptPath = join(dir, "mock-backend.mjs");
    await fs.writeFile(
      scriptPath,
      `process.stdout.write(JSON.stringify({ type: "ready" }) + "\\n");
process.stdin.setEncoding("utf-8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newlineIndex = buffer.indexOf("\\n");
    if (newlineIndex === -1) break;
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const payload = JSON.parse(line);
    const fileName = payload.audioPath.split("/").pop() ?? "unknown";
    process.stdout.write(
      JSON.stringify({
        type: "error",
        error: \`cannot transcribe \${fileName}\`,
      }) + "\\n",
    );
  }
});
`,
      "utf-8",
    );

    const backend = fasterWhisperBackend({
      executablePath: process.execPath,
      scriptPath,
    });

    await expect(backend.transcribe("/vault/audio/bad.m4a")).rejects.toThrow(
      "cannot transcribe bad.m4a",
    );
  });
});
