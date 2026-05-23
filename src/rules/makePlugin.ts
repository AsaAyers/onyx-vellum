import type { Plugin, Processor } from "unified";
import { type Config, type RuleConfig } from "../config.js";
import type { Root } from "mdast";
import invariant from "tiny-invariant";
import type { VFile } from "vfile";
import { fileMatchesSources } from "../engine/runner.js";
import type { PluginContext } from "../markdown/parse.js";

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
        invariant(
          file.path,
          "file.path must be defined for moveDoneTasksPlugin",
        );
        const vaultPath: string = ctx.vaultPath;
        if (
          ruleConfig?.sources &&
          file.path &&
          !fileMatchesSources(file.path, ruleConfig.sources, vaultPath)
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
