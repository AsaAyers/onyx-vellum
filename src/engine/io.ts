import { promises as fs } from "node:fs";
import path, { dirname, join } from "node:path";
import createDebug from "debug";
import z from "zod";
import invariant from "tiny-invariant";

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
      const fullPath = join(dir, name);
      if (entry.isDirectory() && !name.startsWith(".")) {
        results.push(...(await walkMarkdownFiles(fullPath, vaultPath)));
      } else if (
        entry.isFile() &&
        name.endsWith(".md") &&
        !name.startsWith(".")
      ) {
        const relative = path.relative(vaultPath, fullPath);
        results.push(
          zVaultFile.parse({ absolutePath: fullPath, relativePath: relative }),
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
    return await fs.readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

export const zVaultFile = z
  .object({
    absolutePath: z.string(),
    relativePath: z.string(),
  })
  .brand("VaultFile")
  .transform((obj) => {
    invariant(
      path.isAbsolute(obj.absolutePath),
      `absolutePath must be absolute ${obj.absolutePath}`,
    );
    invariant(
      obj.absolutePath.endsWith(obj.relativePath),
      "Relative path must be a suffix of absolute path",
    );

    return obj;
  });

export type VaultFile = z.infer<typeof zVaultFile>;

export type ChangesArray = Array<{
  vaultFile: VaultFile;
  content: string;
}>;

export class FileWriteManager {
  private pending: Map<string, string> = new Map();
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

  static isWriting = false;

  /**
   * Flush all staged changes.
   * In dry-run mode, files are NOT written to disk; the staged changes are
   * returned so the caller can generate diffs or other output.
   * Returns the full list of staged changes (path + final content).
   */
  async commit(dryRun: boolean): Promise<ChangesArray> {
    const changes: ChangesArray = [];
    FileWriteManager.isWriting = !dryRun;
    for (const [relativePath, content] of this.pending) {
      const vaultFile = zVaultFile.parse({
        absolutePath: join(this.vaultPath, relativePath),
        relativePath,
      });

      if (!dryRun) {
        await fs.mkdir(dirname(vaultFile.absolutePath), { recursive: true });
        await fs.writeFile(vaultFile.absolutePath, content, "utf-8");
      }
      changes.push({ vaultFile, content });
    }
    this.pending.clear();
    FileWriteManager.isWriting = false;
    return changes;
  }
}
