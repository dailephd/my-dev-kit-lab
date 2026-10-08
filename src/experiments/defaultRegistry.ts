import { ExperimentPluginRegistry } from "./registry.js";
import { agentSuccessRatePlugin } from "./plugins/agentSuccessRate/index.js";
import { contextStrategyComparisonPlugin } from "./plugins/contextStrategyComparison/index.js";
import { contextPackGenerationPlugin } from "./plugins/contextPackGeneration/index.js";
import { contextWindowScalingPlugin } from "./plugins/contextWindowScaling/index.js";
import { incrementalChangeStalenessPlugin } from "./plugins/incrementalChangeStaleness/index.js";
import { retrievalPrecisionRecallPlugin } from "./plugins/retrievalPrecisionRecall/index.js";
import { retrievalQueryStrategyComparisonPlugin } from "./plugins/retrievalQueryStrategyComparison/index.js";
import { warmIndexReusePlugin } from "./plugins/warmIndexReuse/index.js";

export function createDefaultExperimentPluginRegistry(): ExperimentPluginRegistry {
  const registry = new ExperimentPluginRegistry();
  registry.register(contextStrategyComparisonPlugin);
  registry.register(warmIndexReusePlugin);
  registry.register(incrementalChangeStalenessPlugin);
  registry.register(contextWindowScalingPlugin);
  registry.register(retrievalPrecisionRecallPlugin);
  registry.register(retrievalQueryStrategyComparisonPlugin);
  registry.register(contextPackGenerationPlugin);
  registry.register(agentSuccessRatePlugin);
  return registry;
}
