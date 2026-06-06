import { promises as fs } from "node:fs";
import path, { dirname, join } from "node:path";
import createDebug from "debug";
import { VaultFile } from "./VaultFile.js";
import { decodeBuffer } from "./encoding.js";

const debug = createDebug("onyx:io");

/**
 * Recursively collect every `.md` file under `dir`, sorted lexicographically
 * so results are deterministic across OS/filesystem implementations.
 */
export async function walkMarkdownFiles(
  dir: string,
  vaultPath: string,
): Promise<VaultFile[]> {
  const results: VaultFile[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const name = entry.name as string;
      const absolutePath = join(dir, name);
      if (entry.isDirectory() && !name.startsWith(".")) {
        results.push(...(await walkMarkdownFiles(absolutePath, vaultPath)));
      } else if (
        entry.isFile() &&
        name.endsWith(".md") &&
        !name.startsWith(".")
      ) {
        const relativePath = path.relative(vaultPath, absolutePath);
        results.push(
          new VaultFile({
            absolutePath,
            relativePath: relativePath,
            vaultPath,
          }),
        );
      }
    }
  } catch {
    // Directory doesn't exist or is not accessible — skip silently.
  }
  return results;
}

export async function readFile(path: string): Promise<string> {
  try {
    const buffer = await fs.readFile(path);
    return decodeBuffer(buffer).content;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

export type ChangesArray = Array<{
  vaultFile: VaultFile;
  content: string;
}>;

export class FileWriteManager {
  private pending: Map<string, string> = new Map();
  private isWriting = false;
  private recentFiles = new Set<string>();
  public readonly vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Read a file through the transform queue: if the file has been staged by an
   * earlier rule in this run, return the staged content so the current rule sees
   * the accumulated in-memory state rather than the (potentially stale) disk copy.
   * Falls back to the real file on disk when no staged version exists.
   */
  async read(file: VaultFile): Promise<string> {
    const path = file.relativePath;
    const staged = this.pending.get(path);
    if (staged !== undefined) return staged;
    return readFile(file.absolutePath);
  }

  stage(file: VaultFile, content: string): void {
    debug(`Staging change for ${file.relativePath}`);
    this.pending.set(file.relativePath, content);
  }

  unstageAll() {
    this.pending.clear();
  }

  canWatch(path: string): boolean {
    if (this.isWriting) {
      debug(`Cannot write ${path} because another write is in progress`);
      return false;
    }
    if (this.recentFiles.has(path)) {
      debug(
        `Cannot write ${path} because it was recently written (possible self-trigger)`,
      );
      return false;
    }
    return true;
  }

  stagedFiles() {
    return Array.from(this.pending.keys()).map((relativePath) => {
      return new VaultFile({
        absolutePath: join(this.vaultPath, relativePath),
        relativePath,
        vaultPath: this.vaultPath,
        value: this.pending.get(relativePath) ?? "",
      });
    });
  }

  private markFileAsWritten(path: string) {
    this.recentFiles.add(path);
    setTimeout(() => {
      this.recentFiles.delete(path);
    }, 1000);
  }

  /**
   * Flush all staged changes.
   * In dry-run mode, files are NOT written to disk; the staged changes are
   * returned so the caller can generate diffs or other output.
   * Returns the full list of staged changes (path + final content).
   */
  async commit(dryRun: boolean): Promise<ChangesArray> {
    const changes: ChangesArray = [];
    this.isWriting = !dryRun;
    for (const [relativePath, content] of this.pending) {
      const vaultFile = new VaultFile({
        absolutePath: join(this.vaultPath, relativePath),
        relativePath: relativePath,
        vaultPath: this.vaultPath,
      });
      this.markFileAsWritten(vaultFile.absolutePath);

      if (!dryRun) {
        await fs.mkdir(dirname(vaultFile.absolutePath), { recursive: true });
        await fs.writeFile(vaultFile.absolutePath, content, "utf-8");
      }
      changes.push({ vaultFile, content });
    }
    this.pending.clear();
    this.isWriting = false;
    return changes;
  }
}
