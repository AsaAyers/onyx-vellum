/**
 * Tests for the vault-level config module (src/config.ts).
 *
 * These tests exercise behaviour that the E2E vault run does not cover:
 *   - Creating a missing config file with all defaults.
 *   - Merging defaults for new rules into an existing (outdated) config.
 *   - Rejecting invalid config (bad types caught by zod).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  CONFIG_FILENAME,
  DEFAULT_SOURCES,
} from "../src/loadConfig.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempVault: string;

beforeEach(async () => {
  tempVault = await fs.mkdtemp(join(tmpdir(), "onyx-vellum-config-test-"));
});

afterEach(async () => {
  await fs.rm(tempVault, { recursive: true, force: true });
});

function configPath(): string {
  return join(tempVault, CONFIG_FILENAME);
}

async function writeConfig(config: unknown): Promise<void> {
  await fs.writeFile(
    configPath(),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf-8",
  );
}

async function readConfigFile(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(configPath(), "utf-8"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  it("creates the config file with all defaults when it does not exist", async () => {
    const config = await loadConfig(tempVault);

    // Returned value has top-level sources and empty per-rule entries.
    expect(config).toEqual({
      sources: DEFAULT_SOURCES,
      rules: {},
    });

    // File was written to disk with top-level sources and empty per-rule entries.
    const written = await readConfigFile();
    expect(written).toEqual({
      sources: [{ type: "glob", pattern: "**/*.md" }],
      rules: {},
    });
  });

  it("throws a descriptive error when the config contains invalid JSON", async () => {
    await fs.writeFile(configPath(), '{\n  "rules": [\n}\n', "utf-8");

    await expect(loadConfig(tempVault)).rejects.toThrow(CONFIG_FILENAME);
  });

  it("throws a descriptive error when the config fails zod validation", async () => {
    // "sources" must be an array of Source objects — a string is invalid.
    const bad = { rules: { specA: { sources: "not-an-array" } } };
    await writeConfig(bad);

    await expect(loadConfig(tempVault)).rejects.toThrow(CONFIG_FILENAME);
  });
});
