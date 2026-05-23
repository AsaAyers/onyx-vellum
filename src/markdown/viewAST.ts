import { createParseProcessor, type PluginContext } from "./parse.js";
import { EMPTY_CONFIG } from "./defaultConfig.js";
import fs from "node:fs/promises";
import { VFile } from "vfile";
import type { Root } from "mdast";
import { buildJobId } from "../transcription/queue.js";
import { toZonedTime } from "date-fns-tz";

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

  const timezone = "America/Los_Angeles";
  const ruleContext: PluginContext = {
    timezone,
    todayDate: toZonedTime(new Date(), timezone),
    alertTasks: [],
    addTasks: {},
    async queueJob() {},
    jobIdFactory: buildJobId,
    vaultPath,
    updateFile(transcriptPath, arg1) {
      console.log("updateFile called with:", transcriptPath, arg1);
    },
  };
  const processor = createParseProcessor(config, ruleContext);

  console.log({ filename, contents });
  const tree = processor.parse(vfile);
  const processed = (await processor.run(tree, vfile)) as Root;

  console.log(
    JSON.stringify(
      processed,
      (key, value) => {
        if (key === "position") return undefined; // Omit position for readability

        return value;
      },
      2,
    ),
  );
  console.log("=======================");
  const normalized = processor.stringify(processed);
  console.log(normalized);
}

main();
