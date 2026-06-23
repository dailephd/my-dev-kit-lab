import { createDefaultExperimentPluginRegistry } from "../../src/experiments/index.js";
import type {
  ExperimentConfigFieldDefinition,
  ExperimentPlugin,
} from "../../src/experiments/index.js";

async function main(argv: string[]): Promise<number> {
  try {
    const args = parseDescribeArgs(argv);
    const registry = createDefaultExperimentPluginRegistry();
    const plugin = registry.get(args.experimentId);

    if (args.json) {
      console.log(JSON.stringify(buildDescription(plugin), null, 2));
      return 0;
    }

    printDescription(plugin);
    return 0;
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(error);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    return 1;
  }
}

type ParsedDescribeArgs = {
  experimentId: string;
  json: boolean;
};

function parseDescribeArgs(argv: string[]): ParsedDescribeArgs {
  let experimentId = "";
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--experiment") {
      experimentId = argv[++index] ?? "";
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!experimentId) {
    throw new Error("Usage: --experiment <id> [--json]");
  }

  return { experimentId, json };
}

function buildDescription(plugin: ExperimentPlugin): Record<string, unknown> {
  return {
    metadata: plugin.metadata,
    purpose: describePurpose(plugin),
    supportedVariants: readSupportedVariants(plugin),
    requiredConfigFields: readConfigFields(plugin, true),
    optionalConfigFields: readConfigFields(plugin, false),
    targetBehavior: describeTargetBehavior(plugin),
    expectedReports: describeExpectedReports(plugin),
    examples: describeExamples(plugin),
  };
}

function printDescription(plugin: ExperimentPlugin): void {
  const description = buildDescription(plugin);
  console.log(`${plugin.metadata.name}`);
  console.log("");
  console.log(`ID: ${plugin.metadata.id}`);
  console.log(`Description: ${plugin.metadata.description}`);
  console.log(`Status: ${plugin.metadata.status}`);
  console.log(`Schema version: ${plugin.metadata.schemaVersion}`);
  console.log(`Supported targets: ${plugin.metadata.supportedTargets.join(", ")}`);
  console.log(`Supported outputs: ${plugin.metadata.supportedOutputs.join(", ")}`);
  console.log("");
  console.log(`Purpose: ${description.purpose}`);
  console.log(`Supported variants: ${(description.supportedVariants as string[]).join(", ") || "not declared"}`);
  console.log("");
  printConfigSection("Required config fields", description.requiredConfigFields as ExperimentConfigFieldDefinition[]);
  printConfigSection("Optional config fields", description.optionalConfigFields as ExperimentConfigFieldDefinition[]);
  console.log("");
  console.log(`Target behavior: ${description.targetBehavior}`);
  console.log(`Expected reports: ${description.expectedReports}`);
  console.log("");
  console.log("Examples:");
  for (const example of description.examples as string[]) {
    console.log(`  ${example}`);
  }
}

function printConfigSection(title: string, fields: ExperimentConfigFieldDefinition[]): void {
  console.log(`${title}:`);
  if (fields.length === 0) {
    console.log("  none");
    return;
  }
  for (const field of fields) {
    const defaultSuffix = field.defaultValue === undefined ? "" : ` default=${JSON.stringify(field.defaultValue)}`;
    const typeSuffix = field.type ? ` (${field.type})` : "";
    console.log(`  ${field.name}${typeSuffix}${defaultSuffix}${field.description ? ` - ${field.description}` : ""}`);
  }
}

function readConfigFields(plugin: ExperimentPlugin, required: boolean): ExperimentConfigFieldDefinition[] {
  return (plugin.configDefinition?.fields ?? [])
    .filter((field) => Boolean(field.required) === required)
    .map((field) => ({
      ...field,
      defaultValue: readDefaultValue(plugin.defaultConfig, field.name),
    }));
}

function readSupportedVariants(plugin: ExperimentPlugin): string[] {
  const strategies = readArrayField(plugin.defaultConfig, "strategies");
  return strategies.filter((value): value is string => typeof value === "string");
}

function readDefaultValue(config: unknown, key: string): unknown {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return undefined;
  }
  return (config as Record<string, unknown>)[key];
}

function readArrayField(value: unknown, key: string): unknown[] {
  const field = readDefaultValue(value, key);
  return Array.isArray(field) ? field : [];
}

function describePurpose(plugin: ExperimentPlugin): string {
  if (plugin.metadata.id === "context-strategy-comparison") {
    return "Compare raw full-file prompts with my-dev-kit-guided retrieval prompts using the existing controlled experiment workflow.";
  }
  return plugin.metadata.description;
}

function describeTargetBehavior(plugin: ExperimentPlugin): string {
  const supportsExternal = plugin.metadata.supportedTargets.includes("external-local");
  if (supportsExternal) {
    return "Runs against the current lab repository when --target is omitted, or against an explicit local target project when --target <path> is provided. Outputs stay under lab-controlled output directories by default.";
  }
  return "Runs against the current lab repository.";
}

function describeExpectedReports(plugin: ExperimentPlugin): string {
  if (plugin.metadata.supportedOutputs.includes("html") && plugin.metadata.supportedOutputs.includes("json")) {
    return "Writes plugin-aware JSON and HTML reports with plugin, target, variant, case, metric, artifact, warning, skip, and failure metadata.";
  }
  return `Writes supported outputs: ${plugin.metadata.supportedOutputs.join(", ")}.`;
}

function describeExamples(plugin: ExperimentPlugin): string[] {
  return [
    `npm run experiment:describe -- --experiment ${plugin.metadata.id}`,
    `npm run experiment:run -- --experiment ${plugin.metadata.id} --agents fake-agent --complexities short`,
    `npm run experiment:run -- --experiment ${plugin.metadata.id} --target "Z:\\Users\\newuser\\Projects\\my-dev-kit-v1" --agents fake-agent --complexities short --no-screenshot`,
  ];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  process.exitCode = await main(process.argv.slice(2));
}
