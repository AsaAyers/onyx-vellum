// Central AST and unified type augmentations for the pipeline
// This file should be imported by any plugin or code that needs the extended types
import type { Config } from "../config.js";
import type { PluginContext } from "./PluginContext.js";

// import type { ListItem } from "mdast";

// Augment mdast ListItem data to include inlineFields
// (This is required for type-safe access in plugins)
declare module "mdast" {}

// Augment unified Settings to include onyxVellum config
// (This is required for type-safe config access in plugins)
declare module "unified" {
  interface Processor {
    plugins?: Set<string>;
  }

  interface Settings {
    onyxVellum?: {
      ctx: PluginContext;
      config: Config;
    };
  }
}
