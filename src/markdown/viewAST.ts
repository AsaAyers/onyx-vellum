import { createParseProcessor } from "./parse.js";
import { type PluginContext } from "./PluginContext.js";
import { EMPTY_CONFIG } from "./defaultConfig.js";
import fs from "node:fs/promises";
import { VFile } from "vfile";
import type { Root } from "mdast";
import { buildJobId } from "../transcription/queue.js";
import { FileOperationExecutor } from "../engine/FileOperationExecutor.js";
import { userLocalTime } from "../engine/timezone.js";

// eslint-disable-next-line no-console
const log = console.log.bind(console);

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    console.error("Usage: viewAST <markdown-file>");
    process.exit(1);
  }

  const contents = await fs.readFile(filename, "utf-8");
  // Use the file's directory as vaultPath for CLI/demo
  const vaultPath = process.cwd();
  const config = EMPTY_CONFIG;

  const vfile = new VFile({ path: filename, value: contents });

  const tz = "America/Los_Angeles";
  const fileOperations = new FileOperationExecutor();
  const ruleContext: PluginContext = {
    mode: "all",
    dates: userLocalTime({ tz }),
    async queueJob() {},
    jobIdFactory: buildJobId,
    vaultPath,
    updateFile: fileOperations.updateFile,
    env: {},
    dryRun: true,
  };
  const processor = createParseProcessor(config, ruleContext);

  let tree = processor.parse(vfile);
  tree = (await processor.run(tree, vfile)) as Root;

  log(
    JSON.stringify(
      tree,
      (key, value) => {
        if (key === "position") return undefined; // Omit position for readability

        return value;
      },
      2,
    ),
  );
  log("=======================");
  const normalized = processor.stringify(tree, vfile);
  log(normalized);
}

main();
