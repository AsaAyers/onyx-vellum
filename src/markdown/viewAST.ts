import { parseMarkdown } from "./parse.js";
import fs from "node:fs/promises";

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    console.error("Usage: viewAST <markdown-file>");
    process.exit(1);
  }

  const content = await fs.readFile(filename, "utf-8");
  const ast = parseMarkdown(content);

  console.log(JSON.stringify(ast, null, 2));
}

main();
