import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FileWriteManager,
  walkMarkdownFiles,
  readFile,
} from "../src/engine/FileWriteManager.js";
import { VaultFile } from "../src/engine/VaultFile.js";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync } from "node:fs";

function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fwm-test-"));
}

async function cleanupTempDir(dir: string) {
  await rmSync(dir, { recursive: true, force: true });
}

describe("readFile", () => {
  it("returns empty string for non-existent path", async () => {
    const result = await readFile("/nonexistent/path/that/does/not/exist.md");
    expect(result).toBe("");
  });

  it("re-throws non-ENOENT errors", async () => {
    const dir = await makeTempDir();
    try {
      await expect(readFile(dir)).rejects.toThrow();
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("reads an existing file", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "test.md");
    await writeFile(filePath, "hello world");
    try {
      const result = await readFile(filePath);
      expect(result).toBe("hello world");
    } finally {
      await cleanupTempDir(dir);
    }
  });
});

describe("FileWriteManager", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("read", () => {
    it("returns staged content when present", async () => {
      const fwm = new FileWriteManager("/tmp/vault");
      const vf = new VaultFile({
        absolutePath: "/tmp/vault/tasks.md",
        relativePath: "tasks.md",
        vaultPath: "/tmp/vault",
        isNew: true,
      });
      fwm.stage(vf, "staged content");

      const result = await fwm.read(vf);
      expect(result).toBe("staged content");
    });

    it("falls back to disk when file is not staged", async () => {
      const vaultPath = await makeTempDir();
      const filePath = join(vaultPath, "tasks.md");
      await writeFile(filePath, "disk content");

      const fwm = new FileWriteManager(vaultPath);
      const vf = new VaultFile({
        absolutePath: filePath,
        relativePath: "tasks.md",
        vaultPath,
      });
      try {
        const result = await fwm.read(vf);
        expect(result).toBe("disk content");
      } finally {
        await cleanupTempDir(vaultPath);
      }
    });

    it("returns empty string when file is neither staged nor on disk", async () => {
      const fwm = new FileWriteManager("/tmp/vault");
      const vf = new VaultFile({
        absolutePath: "/tmp/vault/nonexistent.md",
        relativePath: "nonexistent.md",
        vaultPath: "/tmp/vault",
        isNew: true,
      });

      const result = await fwm.read(vf);
      expect(result).toBe("");
    });
  });

  describe("stage / unstageAll", () => {
    it("stage sets content and unstageAll clears it", async () => {
      const fwm = new FileWriteManager("/tmp/vault");
      const vf = new VaultFile({
        absolutePath: "/tmp/vault/a.md",
        relativePath: "a.md",
        vaultPath: "/tmp/vault",
        isNew: true,
      });

      fwm.stage(vf, "alpha");
      expect(await fwm.read(vf)).toBe("alpha");

      fwm.stage(vf, "beta");
      expect(await fwm.read(vf)).toBe("beta");

      fwm.unstageAll();
      expect(await fwm.read(vf)).toBe("");
    });
  });

  describe("commit", () => {
    it("dry-run returns changes without writing to disk", async () => {
      const vaultPath = await makeTempDir();
      const filePath = join(vaultPath, "dry-run.md");
      const fwm = new FileWriteManager(vaultPath);
      const vf = new VaultFile({
        absolutePath: filePath,
        relativePath: "dry-run.md",
        vaultPath,
        isNew: true,
      });

      fwm.stage(vf, "dry-run content");
      const changes = await fwm.commit(true);

      expect(changes).toHaveLength(1);
      expect(changes[0].content).toBe("dry-run content");
      expect(changes[0].vaultFile.relativePath).toBe("dry-run.md");
      expect(existsSync(filePath)).toBe(false);

      await cleanupTempDir(vaultPath);
    });

    it("writes files to disk when not dry-run", async () => {
      const vaultPath = await makeTempDir();
      const filePath = join(vaultPath, "live.md");
      const fwm = new FileWriteManager(vaultPath);
      const vf = new VaultFile({
        absolutePath: filePath,
        relativePath: "live.md",
        vaultPath,
        isNew: true,
      });

      fwm.stage(vf, "live content");
      try {
        const changes = await fwm.commit(false);

        expect(changes).toHaveLength(1);
        expect(changes[0].content).toBe("live content");
        expect(existsSync(filePath)).toBe(true);
        const content = await readFile(filePath);
        expect(content).toBe("live content");
      } finally {
        await cleanupTempDir(vaultPath);
      }
    });

    it("creates parent directories on write", async () => {
      const vaultPath = await makeTempDir();
      const filePath = join(vaultPath, "subdir", "nested", "deep.md");
      const fwm = new FileWriteManager(vaultPath);
      const vf = new VaultFile({
        absolutePath: filePath,
        relativePath: "subdir/nested/deep.md",
        vaultPath,
        isNew: true,
      });

      fwm.stage(vf, "nested content");
      try {
        await fwm.commit(false);
        expect(existsSync(filePath)).toBe(true);
      } finally {
        await cleanupTempDir(vaultPath);
      }
    });

    it("sets isWriting during commit in non-dry-run mode", async () => {
      const vaultPath = await makeTempDir();
      const fwm = new FileWriteManager(vaultPath);
      const vf = new VaultFile({
        absolutePath: join(vaultPath, "flag-test.md"),
        relativePath: "flag-test.md",
        vaultPath,
        isNew: true,
      });

      fwm.stage(vf, "content");
      expect(FileWriteManager.isWriting).toBe(false);
      await fwm.commit(false);
      expect(FileWriteManager.isWriting).toBe(false);
      await cleanupTempDir(vaultPath);
    });
  });

  describe("canWatch", () => {
    afterEach(() => {
      FileWriteManager.isWriting = false;
      FileWriteManager.recentFiles.clear();
    });

    it("returns true for a normal path", () => {
      expect(FileWriteManager.canWatch("/some/path.md")).toBe(true);
    });

    it("returns false when isWriting is true", () => {
      FileWriteManager.isWriting = true;
      expect(FileWriteManager.canWatch("/some/path.md")).toBe(false);
    });

    it("returns false for a recently written path", () => {
      FileWriteManager.recentFiles.add("/some/path.md");
      expect(FileWriteManager.canWatch("/some/path.md")).toBe(false);
    });

    it("allows other paths when one is recently written", () => {
      FileWriteManager.recentFiles.add("/some/path.md");
      expect(FileWriteManager.canWatch("/other/path.md")).toBe(true);
    });

    it("recentFiles expires after 1s", async () => {
      vi.useFakeTimers();
      try {
        const vaultPath = "/tmp/vault";
        const fwm = new FileWriteManager(vaultPath);
        const vf = new VaultFile({
          absolutePath: "/tmp/vault/expire-test.md",
          relativePath: "expire-test.md",
          vaultPath,
          isNew: true,
        });

        fwm.stage(vf, "content");
        await fwm.commit(true);

        expect(FileWriteManager.canWatch("/tmp/vault/expire-test.md")).toBe(
          false,
        );

        vi.advanceTimersByTime(999);
        expect(FileWriteManager.canWatch("/tmp/vault/expire-test.md")).toBe(
          false,
        );

        vi.advanceTimersByTime(1);
        expect(FileWriteManager.canWatch("/tmp/vault/expire-test.md")).toBe(
          true,
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("walkMarkdownFiles", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function setupVault(files: Record<string, string>): Promise<string> {
    const vaultPath = await makeTempDir();
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(vaultPath, relPath);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, content);
    }
    return vaultPath;
  }

  it("finds .md files and returns sorted VaultFiles with correct paths", async () => {
    const vaultPath = await setupVault({
      "a.md": "a",
      "b.md": "b",
      "c.md": "c",
    });
    try {
      const files = await walkMarkdownFiles(vaultPath, vaultPath);
      expect(files).toHaveLength(3);
      expect(files[0].relativePath).toBe("a.md");
      expect(files[0].absolutePath).toBe(join(vaultPath, "a.md"));
      expect(files[0].vaultPath).toBe(vaultPath);
      expect(files[1].relativePath).toBe("b.md");
      expect(files[2].relativePath).toBe("c.md");
    } finally {
      await cleanupTempDir(vaultPath);
    }
  });

  it("traverses subdirectories recursively", async () => {
    const vaultPath = await setupVault({
      "root.md": "root",
      "sub/a.md": "a",
      "sub/subsub/deep.md": "deep",
    });
    try {
      const files = await walkMarkdownFiles(vaultPath, vaultPath);
      expect(files).toHaveLength(3);
      const relPaths = files.map((f) => f.relativePath);
      expect(relPaths).toContain("root.md");
      expect(relPaths).toContain("sub/a.md");
      expect(relPaths).toContain("sub/subsub/deep.md");
    } finally {
      await cleanupTempDir(vaultPath);
    }
  });

  it("excludes non-.md files", async () => {
    const vaultPath = await setupVault({
      "note.md": "note",
      "script.js": "script",
      "data.json": "{}",
      ".hidden.md": "hidden",
    });
    try {
      const files = await walkMarkdownFiles(vaultPath, vaultPath);
      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe("note.md");
    } finally {
      await cleanupTempDir(vaultPath);
    }
  });

  it("excludes hidden directories (starting with .)", async () => {
    const vaultPath = await setupVault({
      "visible/file.md": "visible",
      ".hidden/file.md": "hidden",
    });
    try {
      const files = await walkMarkdownFiles(vaultPath, vaultPath);
      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe("visible/file.md");
    } finally {
      await cleanupTempDir(vaultPath);
    }
  });

  it("returns empty array for non-existent directory", async () => {
    const files = await walkMarkdownFiles(
      "/nonexistent/directory/path",
      "/nonexistent/directory/path",
    );
    expect(files).toEqual([]);
  });

  it("returns files sorted lexicographically", async () => {
    const vaultPath = await setupVault({
      "z.md": "z",
      "a.md": "a",
      "m.md": "m",
    });
    try {
      const files = await walkMarkdownFiles(vaultPath, vaultPath);
      expect(files).toHaveLength(3);
      expect(files[0].relativePath).toBe("a.md");
      expect(files[1].relativePath).toBe("m.md");
      expect(files[2].relativePath).toBe("z.md");
    } finally {
      await cleanupTempDir(vaultPath);
    }
  });
});
