import { ExperimentPluginRegistry } from "./registry.js";
import { contextStrategyComparisonPlugin } from "./plugins/contextStrategyComparison/index.js";

export function createDefaultExperimentPluginRegistry(): ExperimentPluginRegistry {
  const registry = new ExperimentPluginRegistry();
  registry.register(contextStrategyComparisonPlugin);
  return registry;
}
