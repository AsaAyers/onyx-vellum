import { createParseProcessor } from "./markdown/createParseProcessor.js";
import { type PluginContext } from "./markdown/types.js";
import { EMPTY_CONFIG } from "./engine/runner.js";
import fs from "node:fs/promises";
import type { Root } from "mdast";
import { buildJobId } from "./transcription/queue.js";
import { FileOperationExecutor } from "./engine/FileOperationExecutor.js";
import { userLocalTime } from "./engine/userLocalTime.js";
import { VaultFile } from "./engine/VaultFile.js";
import path from "node:path";

// eslint-disable-next-line no-console
const log = console.log.bind(console);

export async function viewAST(absolutePath: string) {
  const resolved = path.isAbsolute(absolutePath)
    ? absolutePath
    : path.join(process.cwd(), absolutePath);

  const contents = await fs.readFile(resolved, "utf-8");
  const vaultPath = path.dirname(resolved);
  const config = EMPTY_CONFIG;
  const relativePath = path.relative(vaultPath, resolved);

  const vfile = new VaultFile({
    absolutePath: resolved,
    relativePath,
    vaultPath,
    value: contents,
  });

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
    fileAlerts: new Map(),
  };
  const processor = createParseProcessor(config, ruleContext);

  let tree = processor.parse(vfile);
  tree = (await processor.run(tree, vfile)) as Root;

  log(
    JSON.stringify(
      tree,
      (key, value) => {
        if (key === "position") return undefined;
        return value;
      },
      2,
    ),
  );
  log("=======================");
  const normalized = processor.stringify(tree, vfile);
  log(normalized);
}
