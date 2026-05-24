/**
 * End-to-end snapshot tests for the committed test vault.
 *
 * Every `.md.expected` file under `tests/test_vault/` documents the exact output
 * the pipeline should produce for the corresponding `.md` path. For existing
 * files we compare against the staged dry-run output (or the on-disk source when
 * unchanged). For generated transcript files we compare against staged writes
 * even when the `.md` input file does not yet exist on disk.
 */
import { afterEach, describe, expect, it } from "vitest";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runAllRules } from "../src/engine/runner.js";
import { walkMarkdownFiles } from "../src/engine/io.js";
import fs, { promises as fsp } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_VAULT = join(__dirname, "test_vault");
const WORKER_ONLY_EXPECTED_OUTPUTS = new Set([
  join(
    TEST_VAULT,
    "scenarios",
    "audio-embed-transcription-failure",
    "recordings",
    "A1_transcription_failure_audio.m4a",
  ),
]);

// Pin the date so the test produces the same output regardless of when it runs.
const TODAY = new Date(2026, 4, 3); // 2026-05-03

const CREATED_DIRS: string[] = [];
const deterministicJobIdFactory = (): string => `mopf7ts0-test-job-001`;

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await fsp.readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map((dir) =>
      fsp.rm(dir, { recursive: true, force: true }),
    ),
  );
});

// ...existing setup code...

function walkExpectedFilesSync(dir: string): string[] {
  const expectedFiles: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      expectedFiles.push(...walkExpectedFilesSync(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md.expected")) {
      expectedFiles.push(fullPath);
    }
  }
  return expectedFiles;
}

describe("test vault — .md.expected snapshots", () => {
  let pipelineOutputs: Map<string, string>;
  const expectedFiles = walkExpectedFilesSync(TEST_VAULT);
  const pipelineReady: Promise<void> = (async () => {
    const { changes } = await runAllRules({
      vaultPath: TEST_VAULT,
      todayDate: TODAY,
      dryRun: true,
      env: {},
      jobIdFactory: deterministicJobIdFactory,
      mode: "all",
    });
    pipelineOutputs = new Map(
      changes.map((c) => [c.vaultFile.absolutePath, c.content]),
    );
  })();

  type DirTree = { [name: string]: DirTree | string };
  function buildTree(files: string[]): DirTree {
    const tree: DirTree = {};
    for (const file of files) {
      const rel = relative(TEST_VAULT, file);
      const parts = rel.split("/");
      let node: DirTree = tree;
      for (let i = 0; i < parts.length - 1; ++i) {
        if (!node[parts[i]]) node[parts[i]] = {};
        node = node[parts[i]] as DirTree;
      }
      node[parts[parts.length - 1]] = file;
    }
    return tree;
  }

  function defineTests(node: DirTree, pathArr: string[] = []) {
    for (const [fileName, expectedPath] of Object.entries(node)) {
      if (typeof expectedPath === "string") {
        const absolutePath = expectedPath.slice(0, -".expected".length);
        const relPath = relative(TEST_VAULT, absolutePath);
        if (WORKER_ONLY_EXPECTED_OUTPUTS.has(absolutePath)) continue;
        it(basename(relPath), async () => {
          await pipelineReady;
          const expectedContent = await fsp.readFile(expectedPath, "utf-8");
          const actualContent =
            pipelineOutputs.get(absolutePath) ??
            (await readOptionalFile(absolutePath));
          if (actualContent === undefined) {
            throw new Error(`expected output file was not produced`);
          }
          expect(actualContent, relPath).toBe(expectedContent);
        });
      } else {
        describe(fileName, () => {
          defineTests(expectedPath, pathArr.concat(fileName));
        });
      }
    }
  }

  describe("vault", () => {
    const tree = buildTree(expectedFiles);
    defineTests(tree);
  });

  it("does not modify any committed markdown file on disk in dry-run mode", async () => {
    const mdFiles = await walkMarkdownFiles(TEST_VAULT, TEST_VAULT);
    const before = new Map(
      await Promise.all(
        mdFiles
          .map((path) => path.absolutePath)
          .map(async (p) => [p, await fsp.readFile(p, "utf-8")] as const),
      ),
    );

    await runAllRules({
      vaultPath: TEST_VAULT,
      todayDate: TODAY,
      dryRun: true,
      env: {},
      jobIdFactory: deterministicJobIdFactory,
      mode: "all",
    });

    for (const [p, content] of before) {
      const after = await fsp.readFile(p, "utf-8");
      expect(
        after,
        `${relative(TEST_VAULT, p)} was modified on disk in dry-run mode`,
      ).toBe(content);
    }
  });
});
