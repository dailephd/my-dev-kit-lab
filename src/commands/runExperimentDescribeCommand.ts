import { createDefaultExperimentPluginRegistry } from "../experiments/index.js";
import {
  AGENT_SUCCESS_RATE_DEFAULT_AGENT_TIMEOUT_MS,
  AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS,
  AGENT_SUCCESS_RATE_REAL_AGENT_IDS,
  AGENT_SUCCESS_RATE_REPAIR_ATTEMPT_VALUES,
  AGENT_SUCCESS_RATE_TREATMENT_IDS
} from "../experiments/plugins/agentSuccessRate/index.js";
import type { ExperimentConfigFieldDefinition, ExperimentPlugin } from "../experiments/index.js";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 4 -- reusable experiment-describe command owner.
//
// Extracted from scripts/experiments/describeExperiment.ts so both the npm
// script and the installed CLI router call the same registry-lookup and
// description-building path. Read-only: no filesystem writes.
// ---------------------------------------------------------------------------

export async function runExperimentDescribeCommandFromArgs(argv: string[]): Promise<number> {
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
    ...(plugin.metadata.id === AGENT_SUCCESS_RATE_ID ? { agentSuccessRate: describeAgentSuccessRate() } : {})
  };
}

const AGENT_SUCCESS_RATE_ID = "agent-success-rate";

/** Fixed, public description of the implemented behavior. It names no task check, fact, edit scope or reference patch. */
function describeAgentSuccessRate(): Record<string, unknown> {
  return {
    treatments: [...AGENT_SUCCESS_RATE_TREATMENT_IDS],
    corpus: "Bundled six-task implementation corpus over two canonical benchmark projects (localized, cross-module and broad-change tasks), resolved from the installed package.",
    defaultMode: "deterministic-fixture: validates the patch evaluation pipeline and the benchmark corpus; no coding agent runs and no provider is required.",
    realAgentMode: "Opt-in only: --agent <codex|claude> together with --include-real-agents. Neither flag alone enables it; real execution is never the default.",
    providers: [...AGENT_SUCCESS_RATE_REAL_AGENT_IDS],
    timeoutMs: { default: AGENT_SUCCESS_RATE_DEFAULT_AGENT_TIMEOUT_MS, maximum: AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS, scope: "each provider attempt" },
    repairAttempts: { allowed: [...AGENT_SUCCESS_RATE_REPAIR_ATTEMPT_VALUES], default: 0, maximumTotalAttemptsPerTreatment: 3, mode: "real-agent only" },
    agentContext: "Source-only: the provider sees the public task text and the treatment's source context, never tests, trusted checks or reference patches, and runs in a neutral working directory.",
    patchApplication: "Guarded: the provider returns a unified diff only. The Lab validates it against a patch policy and applies it in a fresh disposable sandbox; canonical benchmark projects are never modified.",
    taskSuccess: "Decided by trusted checks on the actual changed repository state (required behavior, no regressions, protected files intact). A provider's claim of completion is never evidence. Initial-attempt success and final success are reported separately.",
    reportOutputs: ["report.json", "report.html", "report.txt", "agent-success-rate-execution.json", "agent-success-rate-analysis.json"],
    targetPolicy: "Self-target only; external-local targets are rejected.",
    interpretation: "Descriptive matched comparison of two source-context treatments on a finite corpus: no winner, ranking, composite score, causal or statistical-significance claim."
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
  const agentSuccessRate = description.agentSuccessRate as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (agentSuccessRate) {
    console.log("");
    console.log("Agent success rate details:");
    console.log(`  Treatments: ${(agentSuccessRate.treatments as string[]).join(", ")}`);
    console.log(`  Corpus: ${agentSuccessRate.corpus}`);
    console.log(`  Default mode: ${agentSuccessRate.defaultMode}`);
    console.log(`  Real-agent mode: ${agentSuccessRate.realAgentMode}`);
    console.log(`  Providers: ${(agentSuccessRate.providers as string[]).join(", ")}`);
    console.log(`  Timeout per attempt: default ${agentSuccessRate.timeoutMs.default} ms, maximum ${agentSuccessRate.timeoutMs.maximum} ms`);
    console.log(
      `  Repair attempts: ${(agentSuccessRate.repairAttempts.allowed as number[]).join(", ")} (default ${agentSuccessRate.repairAttempts.default}; at most ${agentSuccessRate.repairAttempts.maximumTotalAttemptsPerTreatment} attempts per treatment; real-agent mode only)`
    );
    console.log(`  Agent context: ${agentSuccessRate.agentContext}`);
    console.log(`  Patch application: ${agentSuccessRate.patchApplication}`);
    console.log(`  Task success: ${agentSuccessRate.taskSuccess}`);
    console.log(`  Report outputs: ${(agentSuccessRate.reportOutputs as string[]).join(", ")}`);
    console.log(`  Target policy: ${agentSuccessRate.targetPolicy}`);
    console.log(`  Interpretation: ${agentSuccessRate.interpretation}`);
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
      defaultValue: readDefaultValue(plugin.defaultConfig, field.name)
    }));
}

function readSupportedVariants(plugin: ExperimentPlugin): string[] {
  if (plugin.supportedVariants) {
    return [...plugin.supportedVariants];
  }
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
  if (plugin.metadata.id === AGENT_SUCCESS_RATE_ID) {
    return "Measure whether implementation patches resolve benchmark tasks under two source-context treatments (raw-full-file and context-pack) using trusted checks on disposable benchmark copies. Deterministic-fixture mode (default) validates the evaluation pipeline only; real-agent mode (opt-in) evaluates the patches a selected provider returns, with optional bounded repair.";
  }
  if (plugin.metadata.id === "context-strategy-comparison") {
    return "Compare raw full-file prompts with my-dev-kit-guided retrieval prompts using the existing controlled experiment workflow.";
  }
  return plugin.metadata.description;
}

function describeTargetBehavior(plugin: ExperimentPlugin): string {
  if (plugin.metadata.id === AGENT_SUCCESS_RATE_ID) {
    return "Self-target only: the bundled corpus is evaluated against the Lab itself and an explicit --target is rejected. Sandboxes and artifacts are written beneath the output directory (beneath the workspace when installed), never into the installed package or the canonical benchmark projects. Accepted options: --out, --case, --benchmark-project, --kit-command, --agent, --include-real-agents, --timeout-ms and --repair-attempts; every other option is rejected.";
  }
  const supportsExternal = plugin.metadata.supportedTargets.includes("external-local");
  if (plugin.metadata.id === "context-window-scaling") {
    return "Three subject modes. Bundled (default): the bundled fixed scaling corpus against the Lab itself. Synthetic: caller-supplied deterministic synthetic repositories via --synthetic-config <path> (a SyntheticRepositoryConfigV1 JSON file, mutually exclusive with --case) written beneath the experiment output directory. External local repository: an explicitly selected local Git worktree via --target <path> together with --local-subject-config <path> (a LocalRepositorySubjectConfigV1 JSON file); the repository is never modified, the output directory must be outside it, and durable output omits the repository path, source text, and file names. Operational context-fit measurement only; no retrieval precision, recall, or ranking quality is measured.";
  }
  if (plugin.metadata.id === "retrieval-precision-recall") {
    return "Two subject modes. Bundled (default): the frozen bundled 12-case warm-index corpus against the Lab itself, filterable with --case and --benchmark-project. External local repository: an explicitly selected local Git worktree via --target <path> together with --local-subject-config <path> (a LocalRepositorySubjectConfigV1 JSON file whose cases carry a complete retrieval answer key with explicit fact-to-context mappings); the repository is never modified, the output directory must be outside it, one private index is built per configured case, and durable output withholds the repository path, source text, and file, symbol and fact identities. Bundled filters are not accepted in external mode.";
  }
  if (plugin.metadata.id === "retrieval-query-strategy-comparison") {
    return "Two subject modes. Bundled (default): the frozen 12-case warm-index corpus compares all seven retrieval query strategies and may be narrowed with --case and --benchmark-project. External local repository: an explicitly selected local Git worktree via --target <path> together with --local-subject-config <path>; the local-subject config owns the case set, one private base index is built per configured case, core strategies share that base, semantic strategies use isolated copies, the repository is never modified, and durable output withholds private file, symbol, fact, semantic-node, warning and case-title identities while preserving numeric scientific results. Bundled filters are not accepted in external-local mode.";
  }
  if (plugin.metadata.id === "context-pack-generation") {
    return "Two subject modes. Bundled (default): the frozen 12-case warm-index corpus against the Lab itself, narrowable with --case and --benchmark-project. External local repository: an explicitly selected local Git worktree via --target <path> together with --local-subject-config <path>; the local-subject config owns the case set, the repository is never modified, the output directory must be outside it, one private base index is built per configured case, and durable output withholds private file, symbol, fact, semantic-node, call-relationship, test, source-text, warning, task and case-title identities while preserving numeric scientific results; no context-pack body is written externally. Bundled filters are not accepted in external-local mode. Both treatments (raw-full-file and context-pack) always run for every case; there is no treatment, strategy, or selection-policy option.";
  }
  if (supportsExternal) {
    return "Runs against the current lab repository when --target is omitted, or against an explicit local target project when --target <path> is provided. Outputs stay under lab-controlled output directories by default.";
  }
  if (plugin.metadata.id === "context-window-scaling") {
    return "Self-targeted. Uses the bundled fixed scaling corpus by default, or caller-supplied deterministic synthetic repositories when --synthetic-config <path> (a SyntheticRepositoryConfigV1 JSON file, mutually exclusive with --case) is provided; generated repositories are written beneath the experiment output directory.";
  }
  return "Runs against the current lab repository.";
}

function describeExpectedReports(plugin: ExperimentPlugin): string {
  if (plugin.metadata.id === AGENT_SUCCESS_RATE_ID) {
    return "Writes plugin-aware report.json, report.html and report.txt with a typed agent-success-rate section (initial-attempt and final success, repair history, edit quality, provider duration and tokens, scientific limitations), plus the separate agent-success-rate-execution.json and agent-success-rate-analysis.json artifacts.";
  }
  if (plugin.metadata.supportedOutputs.includes("html") && plugin.metadata.supportedOutputs.includes("json")) {
    return "Writes plugin-aware JSON and HTML reports with plugin, target, variant, case, metric, artifact, warning, skip, and failure metadata.";
  }
  return `Writes supported outputs: ${plugin.metadata.supportedOutputs.join(", ")}.`;
}

function describeExamples(plugin: ExperimentPlugin): string[] {
  // Only advertise agent-matrix options for plugins that declare them.
  const agentOptions = hasConfigField(plugin, "agents") ? " --agents fake-agent --complexities short" : "";
  const screenshotOption = hasConfigField(plugin, "agents") ? " --no-screenshot" : "";
  const examples = [
    `my-dev-kit-lab experiment describe --experiment ${plugin.metadata.id}`,
    `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id}${agentOptions}`
  ];
  // Only advertise an explicit --target example for plugins that support external targets.
  if (
    plugin.metadata.supportedTargets.includes("external-local") &&
    plugin.metadata.id !== "context-window-scaling" &&
    plugin.metadata.id !== "retrieval-precision-recall" &&
    plugin.metadata.id !== "retrieval-query-strategy-comparison" &&
    plugin.metadata.id !== "context-pack-generation"
  ) {
    examples.push(
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --target "Z:\\Users\\newuser\\Projects\\my-dev-kit-v1"${agentOptions}${screenshotOption}`
    );
  }
  // Only advertise campaign examples for plugins that declare the campaignPreset config field.
  if (hasConfigField(plugin, "campaignPreset")) {
    examples.push(
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --campaign codex-full --include-real-agents --out <dir>`,
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --campaign claude-full --include-real-agents --case warm-medium-complete-idempotent --out <dir>`
    );
  }
  if (plugin.metadata.id === "retrieval-precision-recall") {
    examples.push(
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --case <case-id> --out <run-dir>`,
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --target <local-git-repository> --local-subject-config <path-to-local-subject-config.json> --out <run-dir-outside-the-repository>`
    );
  }
  if (plugin.metadata.id === "retrieval-query-strategy-comparison") {
    examples.push(
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --case <case-id> --out <run-dir>`,
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --target <local-git-repository> --local-subject-config <path-to-local-subject-config.json> --out <run-dir-outside-the-repository>`
    );
  }
  if (plugin.metadata.id === "context-pack-generation") {
    examples.push(
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --case <case-id> --out <run-dir>`,
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --target <local-git-repository> --local-subject-config <path-to-local-subject-config.json> --out <run-dir-outside-the-repository>`
    );
  }
  if (plugin.metadata.id === AGENT_SUCCESS_RATE_ID) {
    examples.push(
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --case <case-id> --out <run-dir>`,
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --agent codex --include-real-agents --repair-attempts 2 --out <run-dir>`
    );
  }
  if (plugin.metadata.id === "context-window-scaling") {
    examples.push(
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --synthetic-config <path-to-config.json> --out <run-dir>`,
      `my-dev-kit-lab experiment run --experiment ${plugin.metadata.id} --target <local-git-repository> --local-subject-config <path-to-local-subject-config.json> --out <run-dir-outside-the-repository>`
    );
  }
  return examples;
}

function hasConfigField(plugin: ExperimentPlugin, name: string): boolean {
  return (plugin.configDefinition?.fields ?? []).some((field) => field.name === name);
}
