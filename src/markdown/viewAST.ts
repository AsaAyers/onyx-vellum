import { parseMarkdown, stringifyMarkdown } from "./parse.js";
import { EMPTY_CONFIG } from "./defaultConfig.js";
import fs from "node:fs/promises";

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    console.error("Usage: viewAST <markdown-file>");
    process.exit(1);
  }

  const content = await fs.readFile(filename, "utf-8");
  // Use the file's directory as vaultPath for CLI/demo
  const vaultPath = process.cwd();
  const config = EMPTY_CONFIG;
  const ast = parseMarkdown(content, vaultPath, config);

  console.log(
    JSON.stringify(
      ast,
      (key, value) => {
        if (key === "position") return undefined; // Omit position for readability

        return value;
      },
      2,
    ),
  );
  console.log("=======================");
  console.log(stringifyMarkdown(ast, vaultPath, config));
}

main();
