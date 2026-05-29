import path from "path";

export interface ParsedArgs {
  dryRun: boolean;
  verbose: boolean;
  init: boolean;
  watch: boolean;
  help: boolean;
  tui: boolean;
  isWorker: boolean;
  isViewAst: boolean;
  viewAstFile?: string;
  onlyGlob?: string[];
  mode?: string;
  vaultPath?: string;
}

export function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");
  const init = args.includes("--init");
  const watch = args.includes("--watch");
  const tui = args.includes("--tui");
  const help = args.includes("--help") || args.includes("-h");

  const workerIdx = args.indexOf("--worker");
  const isWorker = workerIdx !== -1;

  const viewAstIdx = args.indexOf("--view-ast");
  const isViewAst = viewAstIdx !== -1;
  const viewAstFile =
    isViewAst && viewAstIdx + 1 < args.length && !args[viewAstIdx + 1].startsWith("-")
      ? args[viewAstIdx + 1]
      : undefined;

  const onlyIdx = args.indexOf("--only");
  if (
    onlyIdx !== -1 &&
    (onlyIdx + 1 >= args.length || args[onlyIdx + 1].startsWith("-"))
  ) {
    console.error("Error: --only requires a glob pattern argument.");
    console.error('  Example: onyx-vellum --dry-run --only "notes/**" all');
    process.exit(1);
  }
  const onlyGlob: string[] | undefined =
    onlyIdx !== -1 ? [args[onlyIdx + 1]] : undefined;

  const positional = args.filter((a) => !a.startsWith("-"));
  const mode = positional[0] as string | undefined;

  let vaultPath = process.env["VAULT_PATH"];
  if (vaultPath && !path.isAbsolute(vaultPath)) {
    vaultPath = path.resolve(process.cwd(), vaultPath);
  }

  return {
    dryRun,
    verbose,
    init,
    watch,
    help,
    tui,
    isWorker,
    isViewAst,
    viewAstFile,
    onlyGlob,
    mode,
    vaultPath,
  };
}
