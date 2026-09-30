import { ExperimentPluginRegistry } from "./registry.js";
import { contextStrategyComparisonPlugin } from "./plugins/contextStrategyComparison/index.js";
import { contextWindowScalingPlugin } from "./plugins/contextWindowScaling/index.js";
import { incrementalChangeStalenessPlugin } from "./plugins/incrementalChangeStaleness/index.js";
import { warmIndexReusePlugin } from "./plugins/warmIndexReuse/index.js";

export function createDefaultExperimentPluginRegistry(): ExperimentPluginRegistry {
  const registry = new ExperimentPluginRegistry();
  registry.register(contextStrategyComparisonPlugin);
  registry.register(warmIndexReusePlugin);
  registry.register(incrementalChangeStalenessPlugin);
  registry.register(contextWindowScalingPlugin);
  return registry;
}
