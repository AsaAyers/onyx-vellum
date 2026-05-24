import type { Plugin, Processor } from "unified";
import { type Config, type RuleConfig } from "../config.js";
import type { Root } from "mdast";
import invariant from "tiny-invariant";
import type { VFile } from "vfile";
import { fileMatchesSources } from "../engine/runner.js";
import type { PluginContext } from "../markdown/parse.js";
import { join } from "node:path";
import { zVaultFile } from "../engine/io.js";

export function makePlugin<
  PluginName extends string,
  ThisRuleConfig extends RuleConfig = Config["rules"][PluginName],
>(
  pluginName: PluginName,
  coreLogic: (args: {
    tree: Root;
    file: VFile;
    ctx: PluginContext;
    ruleConfig?: ThisRuleConfig;
    config: Config;
  }) => Root | void,
): Plugin<[], Root> {
  return function pluginFactory(this: Processor) {
    const processor = this;
    const settings = processor.data("settings")?.onyxVellum;
    invariant(settings, `[${pluginName}] onyxVellum settings must be provided`);

    const { config, ctx } = settings;
    const ruleConfig = config.rules?.[pluginName] as ThisRuleConfig | undefined;

    return function (tree: Root, file: VFile): Root | void {
      try {
        const relativePath = file.path?.replace(ctx.vaultPath + "/", "");

        const vaultFile = file.path
          ? zVaultFile.parse({
              relativePath,
              absolutePath: join(ctx.vaultPath, relativePath),
            })
          : null;
        if (
          ruleConfig?.sources &&
          vaultFile &&
          !fileMatchesSources(vaultFile, ruleConfig.sources)
        ) {
          return tree;
        }

        return coreLogic({ tree, file, ctx, ruleConfig, config }) ?? tree;
      } catch (err) {
        console.error(`[${pluginName}] Plugin error:`, err);
        return tree;
      }
    };
  };
}
