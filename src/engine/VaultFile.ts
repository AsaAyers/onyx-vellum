import { statSync } from "fs";
import path from "path";
import invariant from "tiny-invariant";
import { VFile } from "vfile";
import z from "zod";

export type FilePathInfo = {
  isNew?: boolean;
  absolutePath: string;
  relativePath: string;
  vaultPath: string;
  value?: string;
};

export class VaultFile extends VFile {
  static schema = z
    .object({
      absolutePath: z.string(),
      relativePath: z.string(),
      vaultPath: z.string(),
      value: z.string().optional(),
    })
    .transform((val) => new VaultFile(val));
  static fromVFile<T extends VFile>(
    ...args: T extends VaultFile ? [T] : [T, string]
  ): VaultFile {
    const vfile = args[0];
    let vaultPath: string = args[1] ?? "";
    if (vfile instanceof VaultFile) {
      vaultPath = vfile.vaultPath;
    }
    invariant(vaultPath, "vaultPath is required when converting from VFile");
    let relativePath = vfile.path;
    if (path.isAbsolute(relativePath) && relativePath.startsWith(vaultPath)) {
      console.warn(
        `Warning: converting absolute path ${relativePath} to relative path by stripping vaultPath ${vaultPath}. This is a fallback for cases where VaultFile instances are created without proper relative paths, but it may mask underlying issues with file path handling. If you see this warning, please investigate why the VaultFile was created with an absolute path and consider fixing the root cause.`,
      );
      relativePath = path.relative(vaultPath, relativePath);
    }

    return new VaultFile({
      absolutePath: path.join(vaultPath, relativePath),
      relativePath: relativePath,
      vaultPath,
    });
  }
  constructor(options: FilePathInfo) {
    super({ path: options.relativePath, ...options, isNew: undefined });
    invariant(
      options.absolutePath ===
        path.join(options.vaultPath, options.relativePath),
      `${options.absolutePath} !== ${path.join(options.vaultPath, options.relativePath)}`,
    );
    invariant(
      options.absolutePath.endsWith(options.relativePath),
      `${options.absolutePath} does not end with ${options.relativePath}`,
    );
    invariant(
      path.isAbsolute(options.absolutePath),
      `absolutePath must be absolute ${options.absolutePath}`,
    );
    let isFile = false;
    try {
      isFile = statSync(options.absolutePath).isFile();
    } catch {
      // File doesn't exist, which is fine — we'll create it on write.
    }
    if (!isFile && !options.isNew) {
      console.warn(
        `Warning: file ${options.absolutePath} does not exist on disk. This may be normal if the file is newly created and not yet committed, but it may also indicate a problem if the file is expected to already exist.`,
      );
    }
    this.absolutePath = options.absolutePath;
    this.relativePath = options.relativePath;
    this.vaultPath = options.vaultPath;
  }
  vaultPath: string;
  absolutePath: string;
  relativePath: string;

  toJSON() {
    return {
      absolutePath: this.absolutePath,
      relativePath: this.relativePath,
      vaultPath: this.vaultPath,
    };
  }
}
