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
import { loadConfig, CONFIG_FILENAME, DEFAULT_SOURCES } from "../src/config.js";

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

  it("returns the stored config when it already contains all known rules", async () => {
    const customSources = [
      { type: "glob" as const, pattern: "custom/**/*.md" },
    ];
    const initial = {
      rules: {
        specA: { sources: customSources },
        specB: { sources: [{ type: "glob", pattern: "notes/**/*.md" }] },
      },
    };
    await writeConfig(initial);

    const config = await loadConfig(tempVault);

    // Custom sources are preserved.
    expect(config.rules.specA.sources).toEqual(customSources);
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

  it("throws a descriptive error when a source has an unknown type", async () => {
    const bad = {
      rules: { specA: { sources: [{ type: "unknown", pattern: "**" }] } },
    };
    await writeConfig(bad);

    await expect(loadConfig(tempVault)).rejects.toThrow(CONFIG_FILENAME);
  });

  it("validates and returns the 'watch' key as part of the config", async () => {
    // A config with a "watch" section plus a rule config should parse without
    // error — zConfig knows about `watch` via its explicit schema.
    const initial = {
      watch: { debounce: 5000 },
      rules: {
        specA: { sources: [{ type: "glob", pattern: "**/*.md" }] },
      },
    };
    await writeConfig(initial);

    const config = await loadConfig(tempVault);

    // Rule config is returned correctly.
    expect(config.rules.specA.sources).toEqual([
      { type: "glob", pattern: "**/*.md" },
    ]);
    // Watch config is returned as part of the config.
    expect(config.watch).toEqual({ debounce: 5000 });
  });

  it("accepts and returns alertSchedule in the watch config", async () => {
    const initial = {
      watch: { debounce: 5000, alertSchedule: ["08:00", "18:00"] },
      rules: {
        specA: { sources: [{ type: "glob", pattern: "**/*.md" }] },
      },
    };
    await writeConfig(initial);

    const config = await loadConfig(tempVault);

    expect(config.watch).toEqual({
      debounce: 5000,
      alertSchedule: ["08:00", "18:00"],
    });
  });

  it("accepts and returns top-level timezone", async () => {
    const initial = {
      timezone: "America/New_York",
      rules: {
        specA: { sources: [{ type: "glob", pattern: "**/*.md" }] },
      },
    };
    await writeConfig(initial);

    const config = await loadConfig(tempVault);

    expect(config.timezone).toBe("America/New_York");
  });

  it("rejects an invalid top-level timezone via zod validation", async () => {
    const bad = {
      timezone: "Not/A_Real_Timezone",
      rules: {
        specA: { sources: [{ type: "glob", pattern: "**/*.md" }] },
      },
    };
    await writeConfig(bad);

    await expect(loadConfig(tempVault)).rejects.toThrow(CONFIG_FILENAME);
  });

  it("rejects an invalid 'watch' value via zod validation", async () => {
    // debounce must be a positive integer — a string is invalid.
    const bad = {
      watch: { debounce: "not-a-number" },
      rules: {
        specA: { sources: [{ type: "glob", pattern: "**/*.md" }] },
      },
    };
    await writeConfig(bad);

    await expect(loadConfig(tempVault)).rejects.toThrow(CONFIG_FILENAME);
  });

  it("preserves the 'watch' key when writing back new defaults", async () => {
    // Config has watch section but is missing specB — loadConfig will add specB
    // and write the merged result.  The watch key must survive the write-back.
    const initial = {
      watch: { debounce: 3000 },
      rules: {
        specA: { sources: [{ type: "glob", pattern: "**/*.md" }] },
      },
    };
    await writeConfig(initial);

    const config = await loadConfig(tempVault);

    expect(config.watch).toEqual({ debounce: 3000 });

    const written = await readConfigFile();
    expect(written.watch).toEqual({ debounce: 3000 });
  });

  it("accepts a top-level 'sources' key and validates it", async () => {
    const initial = {
      sources: [{ type: "glob", pattern: "notes/**/*.md" }],
      rules: {
        specA: { sources: [{ type: "glob", pattern: "**/*.md" }] },
      },
    };
    await writeConfig(initial);

    const config = await loadConfig(tempVault);

    expect(config.sources).toEqual([
      { type: "glob", pattern: "notes/**/*.md" },
    ]);
  });

  it("rejects an invalid top-level sources value via zod validation", async () => {
    const bad = {
      sources: "not-an-array",
      rules: { specA: { sources: [{ type: "glob", pattern: "**/*.md" }] } },
    };
    await writeConfig(bad);

    await expect(loadConfig(tempVault)).rejects.toThrow(CONFIG_FILENAME);
  });

  it("rejects legacy top-level rule keys outside the rules object", async () => {
    const bad = {
      watch: { debounce: 3000 },
      specA: { sources: [{ type: "glob", pattern: "legacy/**/*.md" }] },
    };
    await writeConfig(bad);

    await expect(loadConfig(tempVault)).rejects.toThrow(CONFIG_FILENAME);
  });
});
