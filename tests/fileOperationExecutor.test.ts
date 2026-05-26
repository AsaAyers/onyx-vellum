import { beforeEach, describe, expect, it } from "vitest";
import { FileOperationExecutor } from "../src/engine/FileOperationExecutor.js";
import { FileWriteManager, zVaultFile } from "../src/engine/io.js";
import { createParseProcessor } from "../src/markdown/parse.js";
import { buildJobId } from "../src/transcription/queue.js";
import { testDate } from "./testDate.js";

const markdownContent = `---
tags: [test]
---

HEAD

# A

A content

## A.A

AA content

# B

B content
`;

describe("FileOperationExecutor", () => {
  const vaultPath = "/tmp/fake-vault";
  const fileOperator = new FileOperationExecutor();
  const fileWriter = new FileWriteManager(vaultPath);
  const processor = createParseProcessor(
    { rules: {} },
    {
      vaultPath,
      updateFile: fileOperator.updateFile,
      queueJob: async function () {},
      jobIdFactory: buildJobId,
      env: {},
      mode: "normalize",
      dates: testDate,
      dryRun: false,
    },
  );
  // const file = new VFile({ path: "test.md", value: markdownContent });
  const vaultFile = zVaultFile.parse({
    absolutePath: "/tmp/fake-vault/test.md",
    relativePath: "test.md",
  });

  beforeEach(() => {
    fileOperator.resetAll();
    fileWriter.unstageAll();
    fileWriter.stage(vaultFile, markdownContent);
  });

  describe("With heading", () => {
    describe("heading exists", () => {
      // Replace A and verify that A.A is removed.
      it("Should replace the whole heading and subheading content", async () => {
        fileOperator.updateFile({
          location: {
            file: vaultFile,
            position: "start",
            header: "A",
          },
          content: "New A content",
        });

        await fileOperator.execute(processor, fileWriter);

        const result = await fileWriter.read(vaultFile);
        expect(result).toMatchInlineSnapshot(`
          "---
          tags: [test]
          ---

          HEAD

          # A

          New A content

          # B

          B content
          "
        `);
      });
    });

    describe("position: start", () => {
      it("Should create a new header at the top of the file", async () => {
        fileOperator.updateFile({
          location: {
            file: vaultFile,
            position: "start",
            header: "X",
          },
          content: "New X content",
        });

        await fileOperator.execute(processor, fileWriter);

        const result = await fileWriter.read(vaultFile);
        expect(result).toMatchInlineSnapshot(`
          "---
          tags: [test]
          ---

          HEAD

          # X

          New X content

          # A

          A content

          ## A.A

          AA content

          # B

          B content
          "
        `);
      });
      it("Should replace the whole file when there are no headers", async () => {
        const vaultFile = zVaultFile.parse({
          absolutePath: "/tmp/fake-vault/no-headers.md",
          relativePath: "no-headers.md",
        });
        fileWriter.stage(
          vaultFile,
          `---
tags: [test]
---

Source audio: [[A1_transcription_failure_audio.m4a]]

> [!onyx]+ OnyxVellum: job status
> Transcription is pending.
`,
        );

        fileOperator.updateFile({
          location: {
            file: vaultFile,
            position: "start",
            header: "X",
          },
          content: "New X content",
        });

        await fileOperator.execute(processor, fileWriter);

        const result = await fileWriter.read(vaultFile);
        expect(result).toMatchInlineSnapshot(`
          "---
          tags: [test]
          ---

          # X

          New X content
          "
        `);
      });
      it("Can create and then update a header in an empty file", async () => {
        const emptyVaultFile = zVaultFile.parse({
          absolutePath: "/tmp/fake-vault/empty.md",
          relativePath: "empty.md",
        });
        fileOperator.updateFile({
          location: {
            file: emptyVaultFile,
            position: "start",
            header: "X",
          },
          content: "New X content 1",
        });
        fileOperator.updateFile({
          location: {
            file: emptyVaultFile,
            position: "start",
            header: "X",
          },
          content: "New X content 2",
        });

        await fileOperator.execute(processor, fileWriter);

        const result = await fileWriter.read(emptyVaultFile);
        expect(result).toMatchInlineSnapshot(`
          "# X

          New X content 2
          "
        `);
      });
    });
    describe("position: end", () => {
      it("should create a new header at the end of the file", async () => {
        fileOperator.updateFile({
          location: {
            file: vaultFile,
            position: "start",
            header: "X",
          },
          content: "New X content",
        });

        await fileOperator.execute(processor, fileWriter);

        const result = await fileWriter.read(vaultFile);
        expect(result).toMatchInlineSnapshot(`
          "---
          tags: [test]
          ---

          HEAD

          # X

          New X content

          # A

          A content

          ## A.A

          AA content

          # B

          B content
          "
        `);
      });
    });
  });
  describe("Without heading", () => {
    describe("position: start", () => {
      it("Should insert before the first header", async () => {
        fileOperator.updateFile({
          location: {
            file: vaultFile,
            position: "start",
            header: null,
          },
          content: "New X content",
        });

        await fileOperator.execute(processor, fileWriter);

        const result = await fileWriter.read(vaultFile);
        expect(result).toMatchInlineSnapshot(`
          "---
          tags: [test]
          ---

          New X content

          # A

          A content

          ## A.A

          AA content

          # B

          B content
          "
        `);
      });
    });
    describe("position: end", () => {
      it("should append content at the end of the file", async () => {
        fileOperator.updateFile({
          location: {
            file: vaultFile,
            position: "end",
            header: null,
          },
          content: "New X content",
        });

        await fileOperator.execute(processor, fileWriter);

        const result = await fileWriter.read(vaultFile);
        expect(result).toMatchInlineSnapshot(`
          "---
          tags: [test]
          ---

          HEAD

          # A

          A content

          ## A.A

          AA content

          # B

          B content

          New X content
          "
        `);
      });
    });
  });
});
