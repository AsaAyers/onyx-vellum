import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VaultFile } from "../src/engine/VaultFile.js";
import { VFile } from "vfile";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VAULT_PATH = "/tmp/test-vault";
const ABSOLUTE_PATH = "/tmp/test-vault/scenarios/foo/tasks.md";
const RELATIVE_PATH = "scenarios/foo/tasks.md";

describe("VaultFile constructor", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("sets absolutePath, relativePath, vaultPath from valid options", () => {
    const f = new VaultFile({
      absolutePath: ABSOLUTE_PATH,
      relativePath: RELATIVE_PATH,
      vaultPath: VAULT_PATH,
      isNew: true,
    });
    expect(f.absolutePath).toBe(ABSOLUTE_PATH);
    expect(f.relativePath).toBe(RELATIVE_PATH);
    expect(f.vaultPath).toBe(VAULT_PATH);
  });

  it("sets value when provided", () => {
    const f = new VaultFile({
      absolutePath: ABSOLUTE_PATH,
      relativePath: RELATIVE_PATH,
      vaultPath: VAULT_PATH,
      value: "# Hello\n",
      isNew: true,
    });
    expect(f.value).toBe("# Hello\n");
  });

  it("sets VFile.path to relativePath via super", () => {
    const f = new VaultFile({
      absolutePath: ABSOLUTE_PATH,
      relativePath: RELATIVE_PATH,
      vaultPath: VAULT_PATH,
      isNew: true,
    });
    expect(f.path).toBe(RELATIVE_PATH);
  });

  it("throws when absolutePath does not match join(vaultPath, relativePath)", () => {
    expect(
      () =>
        new VaultFile({
          absolutePath: "/tmp/vault/mismatch.md",
          relativePath: RELATIVE_PATH,
          vaultPath: VAULT_PATH,
          isNew: true,
        }),
    ).toThrow();
  });

  it("throws when absolutePath does not end with relativePath", () => {
    expect(
      () =>
        new VaultFile({
          absolutePath: "/tmp/test-vault/foo.md",
          relativePath: RELATIVE_PATH,
          vaultPath: VAULT_PATH,
          isNew: true,
        }),
    ).toThrow();
  });

  it("throws when absolutePath is relative", () => {
    expect(
      () =>
        new VaultFile({
          absolutePath: "relative/path.md",
          relativePath: "relative/path.md",
          vaultPath: VAULT_PATH,
          isNew: true,
        }),
    ).toThrow();
  });

  it("warns when file does not exist and isNew is not set", () => {
    new VaultFile({
      absolutePath: ABSOLUTE_PATH,
      relativePath: RELATIVE_PATH,
      vaultPath: VAULT_PATH,
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("does not exist");
  });

  it("does not warn when isNew is true", () => {
    new VaultFile({
      absolutePath: ABSOLUTE_PATH,
      relativePath: RELATIVE_PATH,
      vaultPath: VAULT_PATH,
      isNew: true,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when the file exists on disk", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "vaultfile-test-"));
    const filePath = join(tmpDir, "exists.md");
    await mkdir(tmpDir, { recursive: true });
    await writeFile(filePath, "content");

    new VaultFile({
      absolutePath: filePath,
      relativePath: "exists.md",
      vaultPath: tmpDir,
    });

    expect(warnSpy).not.toHaveBeenCalled();
    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("VaultFile.fromVFile", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("converts a plain VFile with a relative path", () => {
    const vfile = new VFile({ path: "notes/tasks.md" });
    const result = VaultFile.fromVFile(vfile, "/my/vault");

    expect(result.relativePath).toBe("notes/tasks.md");
    expect(result.absolutePath).toBe("/my/vault/notes/tasks.md");
    expect(result.vaultPath).toBe("/my/vault");
  });

  it("converts a VFile with an absolute path (fallback)", () => {
    const vfile = new VFile({ path: "/my/vault/notes/tasks.md" });
    const result = VaultFile.fromVFile(vfile, "/my/vault");

    expect(result.relativePath).toBe("notes/tasks.md");
    expect(result.absolutePath).toBe("/my/vault/notes/tasks.md");
    expect(result.vaultPath).toBe("/my/vault");
  });

  it("emits a warning when converting an absolute path", () => {
    const vfile = new VFile({ path: "/my/vault/notes/tasks.md" });
    VaultFile.fromVFile(vfile, "/my/vault");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("converting absolute path"),
    );
  });

  it("extracts vaultPath from a VaultFile when no second arg given", () => {
    const src = new VaultFile({
      absolutePath: "/my/vault/a.md",
      relativePath: "a.md",
      vaultPath: "/my/vault",
      isNew: true,
    });
    const result = VaultFile.fromVFile(src);

    expect(result.vaultPath).toBe("/my/vault");
    expect(result.relativePath).toBe("a.md");
  });

  it("throws when no vaultPath is provided for a plain VFile", () => {
    const vfile = new VFile({ path: "notes/tasks.md" });
    expect(() =>
      VaultFile.fromVFile(vfile as unknown as VFile, ""),
    ).toThrow("vaultPath is required");
  });
});

describe("VaultFile.toJSON and Zod schema", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("toJSON produces the expected shape", () => {
    const f = new VaultFile({
      absolutePath: ABSOLUTE_PATH,
      relativePath: RELATIVE_PATH,
      vaultPath: VAULT_PATH,
      isNew: true,
    });
    expect(f.toJSON()).toEqual({
      absolutePath: ABSOLUTE_PATH,
      relativePath: RELATIVE_PATH,
      vaultPath: VAULT_PATH,
    });
  });

  it("Zod schema round-trips toJSON output", () => {
    const f = new VaultFile({
      absolutePath: ABSOLUTE_PATH,
      relativePath: RELATIVE_PATH,
      vaultPath: VAULT_PATH,
      isNew: true,
    });
    const json = f.toJSON();
    const restored = VaultFile.schema.parse(json);

    expect(restored).toBeInstanceOf(VaultFile);
    expect(restored.absolutePath).toBe(ABSOLUTE_PATH);
    expect(restored.relativePath).toBe(RELATIVE_PATH);
    expect(restored.vaultPath).toBe(VAULT_PATH);
  });
});
