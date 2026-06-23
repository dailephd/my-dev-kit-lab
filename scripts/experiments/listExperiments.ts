import { createDefaultExperimentPluginRegistry } from "../../src/experiments/index.js";
import type { ExperimentPlugin, ExperimentPluginMetadata } from "../../src/experiments/index.js";

type ListedExperiment = ExperimentPluginMetadata & {
  supportedVariants: string[];
};

async function main(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const registry = createDefaultExperimentPluginRegistry();
  const plugins = registry.list().map((metadata) => {
    const plugin = registry.get(metadata.id);
    return toListedExperiment(metadata, plugin);
  });

  if (json) {
    console.log(JSON.stringify({ experiments: plugins }, null, 2));
    return 0;
  }

  console.log("Registered experiment plugins");
  console.log("");
  for (const plugin of plugins) {
    console.log(`${plugin.id}`);
    console.log(`  Name: ${plugin.name}`);
    console.log(`  Description: ${plugin.description}`);
    console.log(`  Status: ${plugin.status}`);
    console.log(`  Supported variants: ${plugin.supportedVariants.join(", ") || "not declared"}`);
    console.log(`  Outputs: ${plugin.supportedOutputs.join(", ")}`);
  }
  return 0;
}

function toListedExperiment(metadata: ExperimentPluginMetadata, plugin: ExperimentPlugin): ListedExperiment {
  return {
    ...metadata,
    supportedVariants: readSupportedVariants(plugin),
  };
}

function readSupportedVariants(plugin: ExperimentPlugin): string[] {
  const strategies = readArrayField(plugin.defaultConfig, "strategies");
  return strategies.filter((value): value is string => typeof value === "string");
}

function readArrayField(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field : [];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  process.exitCode = await main(process.argv.slice(2));
}
