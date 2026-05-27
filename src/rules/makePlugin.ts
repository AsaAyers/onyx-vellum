import type { Plugin, Processor } from "unified";
import { type Config, type RuleConfig } from "../loadConfig.js";
import type { Root } from "mdast";
import invariant from "tiny-invariant";
import type { VFile } from "vfile";
import { fileMatchesSources } from "../engine/FileOperationExecutor.js";
import type { PluginContext } from "../markdown/types.js";
import { VaultFile } from "../engine/FileWriteManager.js";
import createDebug from "debug";

export function makePlugin<
  PluginName extends string,
  ThisRuleConfig extends RuleConfig = Config["rules"][PluginName],
>(
  pluginName: PluginName,
  coreLogic: (args: {
    tree: Root;
    file: VaultFile;
    ctx: PluginContext;
    ruleConfig?: ThisRuleConfig;
    config: Config;
    debug: ReturnType<typeof createDebug>;
  }) => Root | void,
): Plugin<[], Root> {
  const debug = createDebug(`onyx:plugins:${pluginName}`);

  const debugMakePlugin = createDebug(`onyx:makePlugin:${pluginName}`);
  return function pluginFactory(this: Processor) {
    const processor = this;
    const settings = processor.data("settings")?.onyxVellum;
    invariant(settings, `[${pluginName}] onyxVellum settings must be provided`);

    const { config, ctx } = settings;
    const ruleConfig = config.rules?.[pluginName] as ThisRuleConfig | undefined;

    return function (tree: Root, file: VFile): Root | void {
      invariant(
        file instanceof VaultFile,
        `[${pluginName}] Expected file to be an instance of VaultFile, got ${file.constructor.name}`,
      );
      try {
        invariant(
          ctx.vaultPath,
          `[${pluginName}] vaultPath must be provided in plugin context`,
        );

        if (
          ruleConfig?.sources &&
          file &&
          !fileMatchesSources(file, ruleConfig.sources)
        ) {
          debugMakePlugin(
            `[${pluginName}] Skipping file ${file.relativePath} due to source filter`,
          );
          return tree;
        }

        debugMakePlugin(
          `[${pluginName}] running plugin on file ${file?.path ?? "unknown"}`,
        );

        return (
          coreLogic({ tree, file, ctx, ruleConfig, config, debug }) ?? tree
        );
      } catch (err) {
        const msg = `[${pluginName}] Plugin error in ${file.relativePath}: ${(err as Error).message}`;
        console.error(msg);
        ctx.report?.(msg);
        return tree;
      }
    };
  };
}
