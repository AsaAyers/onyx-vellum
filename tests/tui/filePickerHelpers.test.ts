import { describe, it, expect } from "vitest";
import { filterFiles } from "../../src/tui/main/filePickerHelpers.js";

describe("filterFiles", () => {
  const files = [
    "daily/2026-05-01.md",
    "daily/2026-05-28.md",
    "projects/onyx-vellum/tasks.md",
    "inbox/random-note.md",
    "archive/old-project/notes.md",
  ];

  it("returns all files when query is empty", () => {
    expect(filterFiles(files, "")).toEqual(files);
  });

  it("filters by substring (case-insensitive)", () => {
    expect(filterFiles(files, "DAILY")).toEqual([
      "daily/2026-05-01.md",
      "daily/2026-05-28.md",
    ]);
  });

  it("filters by partial path", () => {
    expect(filterFiles(files, "old-project")).toEqual([
      "archive/old-project/notes.md",
    ]);
  });

  it("filters by file extension part", () => {
    expect(filterFiles(files, ".md")).toEqual(files);
  });

  it("returns empty array when no files match", () => {
    expect(filterFiles(files, "nonexistent")).toEqual([]);
  });

  it("handles case insensitivity", () => {
    expect(filterFiles(files, "INBOX")).toEqual(["inbox/random-note.md"]);
  });
});
