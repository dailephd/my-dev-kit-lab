import { ExperimentPluginRegistry } from "./registry.js";
import { contextStrategyComparisonPlugin } from "./plugins/contextStrategyComparison/index.js";
import { warmIndexReusePlugin } from "./plugins/warmIndexReuse/index.js";

export function createDefaultExperimentPluginRegistry(): ExperimentPluginRegistry {
  const registry = new ExperimentPluginRegistry();
  registry.register(contextStrategyComparisonPlugin);
  registry.register(warmIndexReusePlugin);
  return registry;
}
