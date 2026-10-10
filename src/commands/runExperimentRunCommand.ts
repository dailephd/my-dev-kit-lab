import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAgentCommandTemplate } from "../agents/index.js";
import { parseAgentId } from "../agents/agentRegistry.js";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../evaluation/index.js";
import { AGENT_SUCCESS_PROJECT_PROFILES_PATH, AGENT_SUCCESS_TASK_CATALOG_PATH, assertReadAgentSuccessCorpus } from "../evaluation/agentSuccess/index.js";
import { summarizeRetrievalGroundTruthIssuesSafely, validateRetrievalPrecisionRecallCorpus } from "../evaluation/retrievalQuality/index.js";
import { loadLocalRepositorySubject } from "../evaluation/localRepositorySubject/index.js";
import type { LocalRepositorySubject } from "../evaluation/localRepositorySubject/index.js";
import {
  contextStrategyComparisonPlugin,
  contextWindowScalingPlugin,
  createDefaultExperimentPluginRegistry,
  getWarmIndexCampaignPreset,
  incrementalChangeStalenessPlugin,
  parseContextBudgetsCliValue,
  parseWarmIndexCampaignPresetId,
  resolveExperimentTarget,
  retrievalPrecisionRecallPlugin,
  retrievalQueryStrategyComparisonPlugin,
  runExperiment,
  warmIndexReusePlugin
} from "../experiments/index.js";
import type { WarmIndexCampaignPresetId } from "../experiments/index.js";
import { contextPackGenerationPlugin } from "../experiments/plugins/contextPackGeneration/index.js";
import {
  AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS,
  AGENT_SUCCESS_RATE_REAL_AGENT_IDS,
  agentSuccessRatePlugin,
  selectAgentSuccessTasks
} from "../experiments/plugins/agentSuccessRate/index.js";
import { prepareSyntheticContextWindowScalingInputs } from "../experiments/plugins/contextWindowScaling/index.js";
import {
  projectExternalLocalTarget,
  projectRunForExternalLocalPersistence,
} from "../experiments/plugins/contextWindowScaling/localSubjectPrivacy.js";
import { assertWorkRootOutsideTarget } from "../experiments/plugins/contextWindowScaling/localSubjectScratch.js";
import { buildDefaultExperimentOutputRoot } from "../experiments/outputPaths.js";
import { parsePromptComplexityLevel, parsePromptStrategy } from "../prompts/index.js";
import { writePluginExperimentReports } from "../report/index.js";
import { createLabExecutionContext, resolvePackageResource } from "../runtime/index.js";
import { runWarmIndexCampaignPresentation } from "./runWarmIndexCampaignPresentation.js";
import type { AgentCommandTemplate } from "../agents/types.js";
import type {
  ExperimentAgentId,
  ExperimentMatrixConfig,
  ExperimentStrategy
} from "../evaluation/controlledExperimentTypes.js";
import type { PromptComplexityLevel } from "../prompts/types.js";
import type { LabExecutionContext } from "../runtime/index.js";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 4 -- reusable experiment-run command owner.
//
// Extracted from scripts/experiments/runExperiment.ts. Reuses the existing
// generic runner (src/experiments/runner.ts) and the registered
// context-strategy-comparison plugin unchanged. Two things move relative to
// the source-checkout script:
//
// 1. Bundled resource lookup (the default cases/project-profiles files) goes
//    through Batch 1's resolvePackageResource() instead of a
//    process.cwd()-relative path, so it no longer depends on the checkout.
// 2. The implicit (no --out) output root, for installed execution only, is
//    rooted under workspaceRoot instead of the tool/package root -- computed
//    with the same buildDefaultExperimentOutputRoot() helper the runner
//    itself uses internally, so the plugin/target/run subdirectory shape is
//    unchanged, only the root differs. Explicit --out is pre-resolved
//    against invocationCwd so its resolution base never changes.
//
// Self-target fallback (no --target) and relative --target resolution are
// untouched -- both still go through the shared toolRoot (packageRoot),
// matching runAuditCommand.ts / runSecurityValidationCommand.ts.
// ---------------------------------------------------------------------------

const DEFAULT_CASES_RESOURCE = "examples/token-savings-cases.json";
const DEFAULT_PROJECT_PROFILES_RESOURCE = "benchmarks/contracts/benchmark-project-profiles.json";
// context-window-scaling owns one frozen bundled case catalog; its fixed project is referenced by the
// catalog's package-relative targetRoot, so both resolve from the package root, never the cwd.
const CONTEXT_WINDOW_SCALING_CASES_RESOURCE = "benchmarks/contracts/context-window-scaling-cases.json";
// Options the context-window-scaling plugin accepts; every other flag is rejected, not ignored.
const CONTEXT_WINDOW_SCALING_ALLOWED_FLAGS = [
  "--experiment",
  "--out",
  "--target",
  "--case",
  "--synthetic-config",
  "--local-subject-config",
  "--context-budgets",
  "--kit-command"
];

// retrieval-precision-recall owns one frozen bundled corpus (the warm-index benchmark cases) and its project profiles,
// both resolved from the package root, never the cwd. It accepts only these options; every other flag is rejected.
const RETRIEVAL_PRECISION_RECALL_CASES_RESOURCE = "benchmarks/contracts/warm-index-benchmark-cases.json";
const RETRIEVAL_PRECISION_RECALL_ALLOWED_FLAGS = ["--experiment", "--out", "--case", "--benchmark-project", "--kit-command"];
// External-local mode (--target with --local-subject-config) is a different subject source: the local-subject config owns
// the case set, so the bundled corpus filters are not accepted there.
const RETRIEVAL_PRECISION_RECALL_EXTERNAL_ALLOWED_FLAGS = ["--experiment", "--out", "--target", "--local-subject-config", "--kit-command"];

// retrieval-query-strategy-comparison reuses the same frozen bundled corpus. All seven strategies always run, so there
// is no strategy option. External-local mode again accepts only the local-subject source flags.
const RETRIEVAL_QUERY_STRATEGY_COMPARISON_CASES_RESOURCE = "benchmarks/contracts/warm-index-benchmark-cases.json";
const RETRIEVAL_QUERY_STRATEGY_COMPARISON_ALLOWED_FLAGS = ["--experiment", "--out", "--case", "--benchmark-project", "--kit-command"];
const RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL_ALLOWED_FLAGS = ["--experiment", "--out", "--target", "--local-subject-config", "--kit-command"];

// context-pack-generation (v0.8.2) reuses the same frozen bundled corpus. Both treatments (raw-full-file and context-pack)
// always run, so there is no treatment or strategy option. External-local mode (--target with --local-subject-config) is a
// different subject source: the local-subject config owns the case set, so the bundled corpus filters are not accepted there.
const CONTEXT_PACK_GENERATION_CASES_RESOURCE = "benchmarks/contracts/warm-index-benchmark-cases.json";
const CONTEXT_PACK_GENERATION_ALLOWED_FLAGS = ["--experiment", "--out", "--case", "--benchmark-project", "--kit-command"];
const CONTEXT_PACK_GENERATION_EXTERNAL_ALLOWED_FLAGS = ["--experiment", "--out", "--target", "--local-subject-config", "--kit-command"];

// agent-success-rate (v0.9.0) owns the bundled six-task implementation corpus (task catalog and project profiles), both
// resolved from the package root, never the cwd. It runs against the Lab itself only and accepts exactly these options;
// every other flag is rejected, not ignored. Real providers run only with --agent together with --include-real-agents.
const AGENT_SUCCESS_RATE_ALLOWED_FLAGS = [
  "--experiment",
  "--out",
  "--case",
  "--benchmark-project",
  "--kit-command",
  "--agent",
  "--include-real-agents",
  "--timeout-ms",
  "--repair-attempts"
];

// Union of CLI-provided fields across plugins; each plugin's validateConfig narrows (and, for
// warm-index-reuse, rejects) the fields it does not support.
type ParsedExperimentRunConfig = Partial<ExperimentMatrixConfig> & {
  // agent-success-rate only: the single selected real provider and the bounded repair allowance.
  agentId?: string;
  repairAttempts?: number;
  kitCommand?: string;
  campaignPreset?: WarmIndexCampaignPresetId;
  contextBudgets?: number[];
};

type ParsedRunExperimentArgs = {
  experimentId: string;
  targetPath?: string;
  outDir?: string;
  // Command-only input-source selector for context-window-scaling; never part of the plugin's scientific config.
  syntheticConfigPath?: string;
  // Command-only input-source selector for context-window-scaling external-local mode (with --target); never part
  // of the plugin's scientific config. Resolved against the invocation directory, never the target repository.
  localSubjectConfigPath?: string;
  config: ParsedExperimentRunConfig;
};

export type RunExperimentRunCommandOptions = {
  // Used for self-target fallback (no --target) and bundled-resource
  // resolution. Defaults to a freshly discovered LabExecutionContext.
  context?: LabExecutionContext;
  // Root used only for the implicit (no --out) output default. Undefined
  // (the npm-script default) preserves the runner's own internal
  // toolRoot-relative default unchanged. The installed CLI router passes
  // context.workspaceRoot here.
  installedDefaultOutputRoot?: string;
  // v0.5.2 Batch 5 -- deterministic test seam for warm-index campaign presentation only. The
  // installed CLI always uses the real captureReportScreenshot implementation.
  presentation?: {
    captureScreenshot?: Parameters<typeof runWarmIndexCampaignPresentation>[0]["captureScreenshot"];
  };
};

export function assertAgentSuccessRateFlags(argv: string[]): void {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const unsupported = [...new Set(flags.filter((flag) => !AGENT_SUCCESS_RATE_ALLOWED_FLAGS.includes(flag)))];
  if (unsupported.length > 0) {
    throw new Error(
      `${unsupported.join(", ")} ${unsupported.length === 1 ? "is" : "are"} not supported for --experiment ${agentSuccessRatePlugin.metadata.id}; supported options: ${AGENT_SUCCESS_RATE_ALLOWED_FLAGS.join(", ")}.`
    );
  }
}

export async function runExperimentRunCommandFromArgs(
  argv: string[],
  options: RunExperimentRunCommandOptions = {}
): Promise<number> {
  try {
    const args = parseRunExperimentArgs(argv);
    const context = options.context ?? createLabExecutionContext();
    const toolRoot = context.packageRoot;
    const registry = createDefaultExperimentPluginRegistry();
    const runId = generateExperimentRunId(args.experimentId);
    let outputRoot = resolveOutputRoot(args, {
      toolRoot,
      invocationCwd: context.invocationCwd,
      installedDefaultOutputRoot: options.installedDefaultOutputRoot,
      experimentId: args.experimentId,
      runId
    });
    if ((args.syntheticConfigPath !== undefined || args.localSubjectConfigPath !== undefined) && outputRoot === undefined) {
      // Synthetic generation and external-local runs need the concrete root before the runner runs; use the exact default the
      // runner itself would compute for this self-targeted invocation.
      outputRoot = buildDefaultExperimentOutputRoot({
        toolRoot,
        pluginId: args.experimentId,
        target: resolveExperimentTarget(args.targetPath, toolRoot),
        runId
      });
    }
    const inputs = await loadPluginInputs(args, toolRoot, context, outputRoot);
    const result = await runExperiment({
      pluginId: args.experimentId,
      registry,
      targetPath: args.targetPath,
      outputRoot,
      config: pluginConfigFor(args),
      inputs,
      toolRoot,
      runId
    });
    const localSubject = readLoadedLocalSubject(inputs);
    // External-local runs persist only a projected run: no target, tool, or output machine-local paths.
    const persistedRun = localSubject
      ? projectRunForExternalLocalPersistence(result, projectExternalLocalTarget(localSubject.manifest))
      : result;
    if (localSubject && result.status === "failed") {
      // A failed local run has no execution evidence, so no report is produced and none could be mistaken for a
      // completed experiment. The safe failure description (codes and kinds only) is the whole outcome.
      console.log(
        [
          `Experiment: ${result.pluginId}`,
          `Run ID: ${result.runId}`,
          "Status: failed",
          "Mode: external-local repository subject",
          `Subject: ${localSubject.subjectId}`,
          ...result.failures.map((failure) => `Failure: ${failure.message}`)
        ].join("\n")
      );
      return 1;
    }
    const reports = await writePluginExperimentReports({
      run: persistedRun,
      plugin: registry.describe(result.pluginId),
      outputRoot: String(result.metadata?.outputRoot ?? ""),
      redactOutputRoot: localSubject !== undefined
    });
    const outputLines = localSubject
      ? [
          `Experiment: ${result.pluginId}`,
          `Run ID: ${result.runId}`,
          `Status: ${result.status}`,
          "Mode: external-local repository subject",
          `Subject: ${localSubject.subjectId}`,
          `Output: ${String(result.metadata?.outputRoot ?? "")}`,
          `Report JSON: ${reports.outputPaths.jsonPath}`,
          `Report HTML: ${reports.outputPaths.htmlPath}`,
          ...result.failures.map((failure) => `Failure: ${failure.message}`)
        ]
      : [
          `Experiment: ${result.pluginId}`,
          `Run ID: ${result.runId}`,
          `Status: ${result.status}`,
          `Mode: ${result.target.isSelf ? "self" : "external target"}`,
          `Tool root: ${result.target.toolRoot}`,
          `Target root: ${result.target.targetRoot}`,
          `Output: ${String(result.metadata?.outputRoot ?? "")}`,
          `Report JSON: ${reports.outputPaths.jsonPath}`,
          `Report HTML: ${reports.outputPaths.htmlPath}`,
          ...(args.experimentId === agentSuccessRatePlugin.metadata.id ? agentSuccessRateSummaryLines(result, reports.outputPaths.textPath) : [])
        ];

    // Automatic presentation (report already produced above) applies only to warm-index-reuse
    // campaign runs; legacy fake-agent warm-index runs and context-strategy-comparison stay
    // report-only, unchanged.
    if (args.experimentId === warmIndexReusePlugin.metadata.id && args.config.campaignPreset) {
      const executionArtifactPath = readMetadataString(result.metadata?.executionArtifactPath);
      const campaignAgentId = readMetadataString(result.metadata?.campaignAgentId);
      if (!executionArtifactPath) {
        throw new Error("Warm-index campaign presentation requires an execution artifact path on the completed run.");
      }
      if (campaignAgentId !== "codex" && campaignAgentId !== "claude") {
        throw new Error(
          `Warm-index campaign presentation requires a codex or claude campaign agent id on the completed run; received ${String(campaignAgentId)}.`
        );
      }
      const presentation = await runWarmIndexCampaignPresentation({
        outputRoot: String(result.metadata?.outputRoot ?? ""),
        reportPaths: reports.outputPaths,
        executionArtifactPath,
        campaignPreset: args.config.campaignPreset,
        agentId: campaignAgentId,
        captureScreenshot: options.presentation?.captureScreenshot
      });
      outputLines.push(`Plots: ${presentation.plots.artifactPaths.summaryPath}`);
      if (presentation.screenshot.status === "captured") {
        outputLines.push(`Screenshot: ${presentation.screenshot.pngPath}`);
      } else if (presentation.screenshot.status === "skipped") {
        outputLines.push("Screenshot: skipped");
        if (presentation.screenshot.warning) outputLines.push(presentation.screenshot.warning);
      } else {
        outputLines.push("Screenshot: failed");
        outputLines.push(presentation.screenshot.error ?? "Screenshot capture failed.");
      }
      outputLines.push(`Gallery manifest: ${presentation.gallery.manifestPath}`);
      outputLines.push(`Gallery index: ${presentation.gallery.indexPath}`);
    }

    console.log(outputLines.join("\n"));
    if (result.status === "failed") return 1;
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

export function parseRunExperimentArgs(argv: string[]): ParsedRunExperimentArgs {
  let experimentId = "";
  let targetPath: string | undefined;
  let outDir: string | undefined;
  let casesPath: string | undefined;
  let projectProfilesPath: string | undefined;
  const caseIds: string[] = [];
  const benchmarkProjects: string[] = [];
  let agents: ExperimentAgentId[] | undefined;
  let strategies: ExperimentStrategy[] | undefined;
  let complexityLevels: PromptComplexityLevel[] | undefined;
  let timeoutMs: number | undefined;
  let maxRuns: number | undefined;
  let continueOnFailure: boolean | undefined;
  let requireAgents: boolean | undefined;
  let includeRealAgents: boolean | undefined;
  let kitCommand: string | undefined;
  let campaignPreset: WarmIndexCampaignPresetId | undefined;
  let contextBudgets: number[] | undefined;
  let syntheticConfigPath: string | undefined;
  let localSubjectConfigPath: string | undefined;
  const agentFlagValues: string[] = [];
  let repairAttempts: number | undefined;
  const seenFlags: string[] = [];
  const commandTemplates: Partial<Record<"codex" | "claude", AgentCommandTemplate>> = {};

  // The flag whitelist runs before any value is interpreted so an unsupported flag is reported as such.
  const preScanIndex = argv.indexOf("--experiment");
  if (preScanIndex >= 0 && argv[preScanIndex + 1] === agentSuccessRatePlugin.metadata.id) assertAgentSuccessRateFlags(argv);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== undefined && arg.startsWith("--")) seenFlags.push(arg);
    if (arg === "--experiment") {
      experimentId = readRequiredValue(argv, ++index, "--experiment");
    } else if (arg === "--target") {
      targetPath = readRequiredValue(argv, ++index, "--target");
    } else if (arg === "--out") {
      outDir = readRequiredValue(argv, ++index, "--out");
    } else if (arg === "--cases") {
      casesPath = readRequiredValue(argv, ++index, "--cases");
    } else if (arg === "--project-profiles") {
      projectProfilesPath = readRequiredValue(argv, ++index, "--project-profiles");
    } else if (arg === "--synthetic-config") {
      if (syntheticConfigPath !== undefined) {
        throw new Error("--synthetic-config may be supplied only once.");
      }
      syntheticConfigPath = readRequiredValue(argv, ++index, "--synthetic-config");
    } else if (arg === "--local-subject-config") {
      if (localSubjectConfigPath !== undefined) {
        throw new Error("--local-subject-config may be supplied only once.");
      }
      localSubjectConfigPath = readRequiredValue(argv, ++index, "--local-subject-config");
    } else if (arg === "--case") {
      caseIds.push(...splitList(readRequiredValue(argv, ++index, "--case")));
    } else if (arg === "--benchmark-project") {
      benchmarkProjects.push(...splitList(readRequiredValue(argv, ++index, "--benchmark-project")));
    } else if (arg === "--agent") {
      agentFlagValues.push(readRequiredValue(argv, ++index, "--agent"));
    } else if (arg === "--repair-attempts") {
      repairAttempts = parseRepairAttempts(readRequiredValue(argv, ++index, "--repair-attempts"));
    } else if (arg === "--agents") {
      agents = splitList(readRequiredValue(argv, ++index, "--agents")).map((value) => parseAgentId(value) as ExperimentAgentId);
    } else if (arg === "--strategies") {
      strategies = splitList(readRequiredValue(argv, ++index, "--strategies")).map(parsePromptStrategy);
    } else if (arg === "--complexities") {
      complexityLevels = splitList(readRequiredValue(argv, ++index, "--complexities")).map(parsePromptComplexityLevel);
    } else if (arg === "--timeout-ms") {
      timeoutMs = parsePositiveInteger("--timeout-ms", readRequiredValue(argv, ++index, "--timeout-ms"));
    } else if (arg === "--max-runs") {
      maxRuns = parsePositiveInteger("--max-runs", readRequiredValue(argv, ++index, "--max-runs"));
    } else if (arg === "--continue-on-failure") {
      continueOnFailure = true;
    } else if (arg === "--no-continue-on-failure") {
      continueOnFailure = false;
    } else if (arg === "--require-agents") {
      requireAgents = true;
    } else if (arg === "--include-real-agents") {
      includeRealAgents = true;
    } else if (arg === "--command-template-codex") {
      commandTemplates.codex = parseAgentCommandTemplate(readRequiredValue(argv, ++index, "--command-template-codex"));
    } else if (arg === "--command-template-claude") {
      commandTemplates.claude = parseAgentCommandTemplate(readRequiredValue(argv, ++index, "--command-template-claude"));
    } else if (arg === "--kit-command") {
      kitCommand = readRequiredValue(argv, ++index, "--kit-command");
    } else if (arg === "--context-budgets") {
      contextBudgets = parseContextBudgetsCliValue(readRequiredValue(argv, ++index, "--context-budgets"));
    } else if (arg === "--campaign") {
      campaignPreset = parseWarmIndexCampaignPresetId(readRequiredValue(argv, ++index, "--campaign"));
    } else if (arg === "--no-screenshot") {
      // The plugin-aware report path does not capture screenshots yet; accept this
      // flag so smoke commands can share the legacy demo option set.
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!experimentId) {
    throw new Error("Usage: --experiment <id> [--target <path>] [--out <directory>]");
  }
  const KIT_COMMAND_PLUGIN_IDS = [
    warmIndexReusePlugin.metadata.id,
    incrementalChangeStalenessPlugin.metadata.id,
    contextWindowScalingPlugin.metadata.id,
    retrievalPrecisionRecallPlugin.metadata.id,
    retrievalQueryStrategyComparisonPlugin.metadata.id,
    contextPackGenerationPlugin.metadata.id
  ];
  if (experimentId === retrievalPrecisionRecallPlugin.metadata.id) {
    // Mode matrix, no precedence rules: neither flag = bundled; both = external-local; exactly one is rejected.
    if (targetPath !== undefined && localSubjectConfigPath === undefined) {
      throw new Error(`External ${experimentId} targets require --local-subject-config.`);
    }
    if (localSubjectConfigPath !== undefined && targetPath === undefined) {
      throw new Error(`--local-subject-config requires an external --target for ${experimentId}.`);
    }
    const externalMode = targetPath !== undefined;
    if (externalMode && (seenFlags.includes("--case") || seenFlags.includes("--benchmark-project"))) {
      throw new Error("--case and --benchmark-project cannot be combined with --local-subject-config; the local subject config owns the case set.");
    }
    const allowedFlags = externalMode ? RETRIEVAL_PRECISION_RECALL_EXTERNAL_ALLOWED_FLAGS : RETRIEVAL_PRECISION_RECALL_ALLOWED_FLAGS;
    const unsupported = [...new Set(seenFlags.filter((flag) => !allowedFlags.includes(flag)))];
    if (unsupported.length > 0) {
      throw new Error(
        `${unsupported.join(", ")} ${unsupported.length === 1 ? "is" : "are"} not supported for --experiment ${experimentId}${externalMode ? " in external-local mode" : ""}; supported options: ${allowedFlags.join(", ")}.`
      );
    }
    if (seenFlags.includes("--case") && caseIds.length === 0) {
      throw new Error("--case must list at least one case id.");
    }
    if (seenFlags.includes("--benchmark-project") && benchmarkProjects.length === 0) {
      throw new Error("--benchmark-project must list at least one benchmark project id.");
    }
  }
  if (experimentId === retrievalQueryStrategyComparisonPlugin.metadata.id) {
    // Mode matrix, no precedence rules: neither flag = bundled; both = external-local; exactly one is rejected.
    if (targetPath !== undefined && localSubjectConfigPath === undefined) {
      throw new Error(`External ${experimentId} targets require --local-subject-config.`);
    }
    if (localSubjectConfigPath !== undefined && targetPath === undefined) {
      throw new Error(`--local-subject-config requires an external --target for ${experimentId}.`);
    }
    const externalMode = targetPath !== undefined;
    if (externalMode && (seenFlags.includes("--case") || seenFlags.includes("--benchmark-project"))) {
      throw new Error("--case and --benchmark-project cannot be combined with --local-subject-config; the local subject config owns the case set.");
    }
    const allowedFlags = externalMode
      ? RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL_ALLOWED_FLAGS
      : RETRIEVAL_QUERY_STRATEGY_COMPARISON_ALLOWED_FLAGS;
    const unsupported = [...new Set(seenFlags.filter((flag) => !allowedFlags.includes(flag)))];
    if (unsupported.length > 0) {
      throw new Error(
        `${unsupported.join(", ")} ${unsupported.length === 1 ? "is" : "are"} not supported for --experiment ${experimentId}${externalMode ? " in external-local mode" : ""}; supported options: ${allowedFlags.join(", ")}.`
      );
    }
    if (seenFlags.includes("--case") && caseIds.length === 0) {
      throw new Error("--case must list at least one case id.");
    }
    if (seenFlags.includes("--benchmark-project") && benchmarkProjects.length === 0) {
      throw new Error("--benchmark-project must list at least one benchmark project id.");
    }
  }
  if (experimentId === contextPackGenerationPlugin.metadata.id) {
    // Mode matrix, no precedence rules: neither flag = bundled; both = external-local; exactly one is rejected.
    if (targetPath !== undefined && localSubjectConfigPath === undefined) {
      throw new Error(`External ${experimentId} targets require --local-subject-config.`);
    }
    if (localSubjectConfigPath !== undefined && targetPath === undefined) {
      throw new Error(`--local-subject-config requires an external --target for ${experimentId}.`);
    }
    const externalMode = targetPath !== undefined;
    if (externalMode && (seenFlags.includes("--case") || seenFlags.includes("--benchmark-project"))) {
      throw new Error("--case and --benchmark-project cannot be combined with --local-subject-config; the local subject config owns the case set.");
    }
    const allowedFlags = externalMode ? CONTEXT_PACK_GENERATION_EXTERNAL_ALLOWED_FLAGS : CONTEXT_PACK_GENERATION_ALLOWED_FLAGS;
    const unsupported = [...new Set(seenFlags.filter((flag) => !allowedFlags.includes(flag)))];
    if (unsupported.length > 0) {
      throw new Error(
        `${unsupported.join(", ")} ${unsupported.length === 1 ? "is" : "are"} not supported for --experiment ${experimentId}${externalMode ? " in external-local mode" : ""}; supported options: ${allowedFlags.join(", ")}.`
      );
    }
    if (seenFlags.includes("--case") && caseIds.length === 0) {
      throw new Error("--case must list at least one case id.");
    }
    if (seenFlags.includes("--benchmark-project") && benchmarkProjects.length === 0) {
      throw new Error("--benchmark-project must list at least one benchmark project id.");
    }
  }
  if (experimentId === agentSuccessRatePlugin.metadata.id) {
    // Mode matrix: no flags = deterministic-fixture (default); --agent together with --include-real-agents = real-agent mode.
    // Everything else is rejected, never coerced: a provider needs both flags, and real-agent options need a provider.
    if (agentFlagValues.length > 1) {
      throw new Error("--agent may be supplied only once; agent-success-rate runs exactly one provider.");
    }
    const agentId = agentFlagValues[0];
    if (agentId !== undefined && !(AGENT_SUCCESS_RATE_REAL_AGENT_IDS as readonly string[]).includes(agentId)) {
      throw new Error(`--agent must be exactly one of: ${AGENT_SUCCESS_RATE_REAL_AGENT_IDS.join(", ")}.`);
    }
    if (agentId !== undefined && includeRealAgents !== true) {
      throw new Error("--agent requires --include-real-agents; real providers are invoked only with explicit authorization.");
    }
    if (agentId === undefined && includeRealAgents === true) {
      throw new Error("--include-real-agents requires --agent <codex|claude> for agent-success-rate.");
    }
    if (agentId === undefined && timeoutMs !== undefined) {
      throw new Error("--timeout-ms is only supported together with --agent and --include-real-agents (real-agent mode).");
    }
    if (agentId === undefined && kitCommand !== undefined) {
      throw new Error("--kit-command is only supported together with --agent and --include-real-agents (real-agent mode).");
    }
    if (agentId === undefined && repairAttempts !== undefined && repairAttempts > 0) {
      throw new Error("--repair-attempts greater than 0 requires --agent and --include-real-agents (real-agent mode).");
    }
    if (timeoutMs !== undefined && timeoutMs > AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS) {
      throw new Error(`--timeout-ms must be a positive integer no greater than ${AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS}.`);
    }
    if (seenFlags.includes("--case") && caseIds.length === 0) {
      throw new Error("--case must list at least one case id.");
    }
    if (seenFlags.includes("--benchmark-project") && benchmarkProjects.length === 0) {
      throw new Error("--benchmark-project must list at least one benchmark project id.");
    }
  } else {
    if (agentFlagValues.length > 0) {
      throw new Error(`--agent is only supported for --experiment ${agentSuccessRatePlugin.metadata.id}.`);
    }
    if (repairAttempts !== undefined) {
      throw new Error(`--repair-attempts is only supported for --experiment ${agentSuccessRatePlugin.metadata.id}.`);
    }
  }
  if (contextBudgets !== undefined && experimentId !== contextWindowScalingPlugin.metadata.id) {
    throw new Error(`--context-budgets is only supported for --experiment ${contextWindowScalingPlugin.metadata.id}.`);
  }
  if (syntheticConfigPath !== undefined && experimentId !== contextWindowScalingPlugin.metadata.id) {
    throw new Error(`--synthetic-config is only supported for --experiment ${contextWindowScalingPlugin.metadata.id}.`);
  }
  if (
    localSubjectConfigPath !== undefined &&
    experimentId !== contextWindowScalingPlugin.metadata.id &&
    experimentId !== retrievalPrecisionRecallPlugin.metadata.id &&
    experimentId !== retrievalQueryStrategyComparisonPlugin.metadata.id &&
    experimentId !== contextPackGenerationPlugin.metadata.id
  ) {
    throw new Error(
      `--local-subject-config is only supported for --experiment ${contextWindowScalingPlugin.metadata.id}, ${retrievalPrecisionRecallPlugin.metadata.id}, ${retrievalQueryStrategyComparisonPlugin.metadata.id}, or ${contextPackGenerationPlugin.metadata.id}.`
    );
  }
  if (experimentId === contextWindowScalingPlugin.metadata.id) {
    const unsupported = [...new Set(seenFlags.filter((flag) => !CONTEXT_WINDOW_SCALING_ALLOWED_FLAGS.includes(flag)))];
    if (unsupported.length > 0) {
      throw new Error(
        `${unsupported.join(", ")} ${unsupported.length === 1 ? "is" : "are"} not supported for --experiment ${experimentId}; supported options: ${CONTEXT_WINDOW_SCALING_ALLOWED_FLAGS.join(", ")}.`
      );
    }
    if (seenFlags.includes("--case") && caseIds.length === 0) {
      throw new Error("--case must list at least one case id.");
    }
    if (syntheticConfigPath !== undefined && seenFlags.includes("--case")) {
      throw new Error("--case and --synthetic-config are mutually exclusive; the synthetic config owns the generated case set.");
    }
    // Subject-mode matrix: bundled (no source flags), synthetic (--synthetic-config), external-local
    // (--target with --local-subject-config). Every other combination is rejected, never given a precedence.
    if (localSubjectConfigPath !== undefined && syntheticConfigPath !== undefined) {
      throw new Error("--synthetic-config and --local-subject-config are mutually exclusive; choose one subject source.");
    }
    if (localSubjectConfigPath !== undefined && seenFlags.includes("--case")) {
      throw new Error("--case cannot be combined with --local-subject-config; the local subject config owns the case set.");
    }
    if (localSubjectConfigPath !== undefined && targetPath === undefined) {
      throw new Error(`--local-subject-config requires an external --target for ${experimentId}.`);
    }
    if (syntheticConfigPath !== undefined && targetPath !== undefined) {
      throw new Error("--synthetic-config cannot be combined with --target; synthetic subjects are generated beneath the experiment output directory.");
    }
    if (targetPath !== undefined && localSubjectConfigPath === undefined) {
      throw new Error(`External ${experimentId} targets require --local-subject-config.`);
    }
  }
  // agent-success-rate accepts --kit-command in real-agent mode; its own validation above owns that rule and message.
  if (kitCommand !== undefined && experimentId !== agentSuccessRatePlugin.metadata.id && !KIT_COMMAND_PLUGIN_IDS.includes(experimentId)) {
    throw new Error(`--kit-command is only supported for --experiment ${KIT_COMMAND_PLUGIN_IDS.join(" or ")}.`);
  }
  if (campaignPreset !== undefined) {
    if (experimentId !== warmIndexReusePlugin.metadata.id) {
      throw new Error(`--campaign is only supported for --experiment ${warmIndexReusePlugin.metadata.id}.`);
    }
    if (targetPath !== undefined) {
      throw new Error("--campaign cannot be combined with --target; campaigns run only against bundled synthetic benchmark projects.");
    }
    if (casesPath !== undefined) {
      throw new Error("--campaign cannot be combined with --cases; the selected preset owns the production corpus.");
    }
    if (projectProfilesPath !== undefined) {
      throw new Error("--campaign cannot be combined with --project-profiles; the selected preset owns the project profiles.");
    }
  }

  return {
    experimentId,
    targetPath,
    outDir,
    syntheticConfigPath,
    localSubjectConfigPath,
    config: withoutUndefined({
      casesPath,
      projectProfilesPath,
      caseIds: caseIds.length > 0 ? caseIds : undefined,
      benchmarkProjects: benchmarkProjects.length > 0 ? benchmarkProjects : undefined,
      agents,
      strategies,
      complexityLevels,
      timeoutMs,
      maxRuns,
      continueOnFailure,
      requireAgents,
      includeRealAgents,
      commandTemplates: Object.keys(commandTemplates).length > 0 ? commandTemplates : undefined,
      agentId: agentFlagValues[0],
      repairAttempts,
      kitCommand,
      campaignPreset,
      contextBudgets
    })
  };
}

function resolveOutputRoot(
  args: ParsedRunExperimentArgs,
  params: {
    toolRoot: string;
    invocationCwd: string;
    installedDefaultOutputRoot?: string;
    experimentId: string;
    runId: string;
  }
): string | undefined {
  if (args.outDir) {
    // Pre-resolve to an absolute path against invocationCwd so its
    // resolution base never depends on toolRoot/packageRoot.
    return path.resolve(params.invocationCwd, args.outDir);
  }
  if (!params.installedDefaultOutputRoot) {
    // Preserve the runner's own internal toolRoot-relative default.
    return undefined;
  }
  const target = resolveExperimentTarget(args.targetPath, params.toolRoot);
  return buildDefaultExperimentOutputRoot({
    toolRoot: params.installedDefaultOutputRoot,
    pluginId: params.experimentId,
    target,
    runId: params.runId
  });
}

function generateExperimentRunId(pluginId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${pluginId}-${timestamp}`;
}

async function loadPluginInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext,
  outputRoot: string | undefined
): Promise<Record<string, unknown> | undefined> {
  if (args.experimentId === contextStrategyComparisonPlugin.metadata.id) {
    const validation = contextStrategyComparisonPlugin.validateConfig(args.config);
    if (!validation.valid || !validation.config) {
      throw new Error(`Invalid context strategy comparison config: ${validation.errors.join("; ")}`);
    }
    return loadCasesAndProjectProfiles(args, toolRoot, context);
  }
  if (args.experimentId === warmIndexReusePlugin.metadata.id) {
    const validation = warmIndexReusePlugin.validateConfig(args.config);
    if (!validation.valid || !validation.config) {
      throw new Error(`Invalid warm index reuse config: ${validation.errors.join("; ")}`);
    }
    if (args.config.campaignPreset) {
      return loadCampaignCasesAndProjectProfiles(args.config.campaignPreset, toolRoot, context);
    }
    return loadCasesAndProjectProfiles(args, toolRoot, context);
  }
  if (args.experimentId === contextWindowScalingPlugin.metadata.id) {
    return loadContextWindowScalingInputs(args, toolRoot, context, outputRoot);
  }
  if (args.experimentId === retrievalPrecisionRecallPlugin.metadata.id) {
    return args.localSubjectConfigPath !== undefined
      ? loadRetrievalPrecisionRecallLocalSubjectInputs(args, toolRoot, context, outputRoot)
      : loadRetrievalPrecisionRecallInputs(args, toolRoot, context);
  }
  if (args.experimentId === contextPackGenerationPlugin.metadata.id) {
    return args.localSubjectConfigPath !== undefined
      ? loadContextPackGenerationLocalSubjectInputs(args, toolRoot, context, outputRoot)
      : loadContextPackGenerationInputs(args, toolRoot, context);
  }
  if (args.experimentId === retrievalQueryStrategyComparisonPlugin.metadata.id) {
    return args.localSubjectConfigPath !== undefined
      ? loadRetrievalQueryStrategyComparisonLocalSubjectInputs(args, toolRoot, context, outputRoot)
      : loadRetrievalQueryStrategyComparisonInputs(args, toolRoot, context);
  }
  if (args.experimentId === agentSuccessRatePlugin.metadata.id) {
    return loadAgentSuccessRateInputs(args, context);
  }
  return undefined;
}

// agent-success-rate: the bundled task catalog and project profiles are located through the established package-resource
// resolver (never the cwd) and validated by the corpus reader, which also checks the canonical projects on disk. The
// validated tasks reach the plugin through its existing programmatic input; the plugin applies --case/--benchmark-project
// selection in catalog order and owns execution, repair, science and artifacts. No task file is accepted from the CLI.
async function loadAgentSuccessRateInputs(args: ParsedRunExperimentArgs, context: LabExecutionContext): Promise<Record<string, unknown>> {
  const validation = agentSuccessRatePlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid agent success rate config: ${validation.errors.join("; ")}`);
  }
  resolvePackageResource(context, AGENT_SUCCESS_TASK_CATALOG_PATH);
  resolvePackageResource(context, AGENT_SUCCESS_PROJECT_PROFILES_PATH);
  const corpus = assertReadAgentSuccessCorpus(context.resourceRoot);
  // Fail on unknown case or project ids before any output directory exists.
  selectAgentSuccessTasks(corpus.tasks, validation.config);
  return { agentSuccessTasks: corpus.tasks };
}

// context-pack-generation (bundled/self): the frozen warm-index corpus through the established resource resolver, profile
// and corpus validation. The plugin applies --case/--benchmark-project selection and owns execution, science and artifacts.
async function loadContextPackGenerationInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext
): Promise<Record<string, unknown>> {
  const validation = contextPackGenerationPlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid context pack generation config: ${validation.errors.join("; ")}`);
  }
  const projectProfiles = await readBenchmarkProjectProfiles(resolvePackageResource(context, DEFAULT_PROJECT_PROFILES_RESOURCE), toolRoot);
  const cases = await readEvaluationCases(resolvePackageResource(context, CONTEXT_PACK_GENERATION_CASES_RESOURCE), toolRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  const corpusErrors = validateRetrievalPrecisionRecallCorpus(cases);
  if (corpusErrors.length > 0) {
    throw new Error(`Invalid context-pack-generation corpus: ${corpusErrors.join(" ")}`);
  }
  return { cases };
}

// External-local context-pack-generation: same loader and safety order as the other external-local retrieval experiments,
// with the plugin's own config validation. Ground-truth issues carry logical case ids and counts only.
async function loadContextPackGenerationLocalSubjectInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext,
  outputRoot: string | undefined
): Promise<Record<string, unknown>> {
  const validation = contextPackGenerationPlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid context pack generation config: ${validation.errors.join("; ")}`);
  }
  if (outputRoot === undefined || args.localSubjectConfigPath === undefined) {
    throw new Error("Internal error: external-local runs require a resolved experiment output root and config path.");
  }
  const target = resolveExperimentTarget(args.targetPath, toolRoot);
  if (target.isSelf || target.kind !== "external-local") {
    throw new Error("Local-repository subject mode requires an external-local target; --target must not be the Lab repository.");
  }
  try {
    await assertWorkRootOutsideTarget(outputRoot, target.targetRoot);
  } catch {
    throw new Error("Experiment output root must not be inside the external target project.");
  }
  const configPath = path.resolve(context.invocationCwd, args.localSubjectConfigPath);
  const localSubjectConfig = await readJsonConfigFile("--local-subject-config", configPath, args.localSubjectConfigPath);
  const localSubject = await loadLocalRepositorySubject({ config: localSubjectConfig, repositoryPath: target.targetRoot });
  const groundTruthIssues = summarizeRetrievalGroundTruthIssuesSafely(localSubject.evaluationCases);
  if (groundTruthIssues.length > 0) {
    throw new Error(
      `Invalid context-pack-generation ground truth for the local subject (${groundTruthIssues
        .map((issue) => `case ${issue.caseId}: ${issue.issueCount} issue${issue.issueCount === 1 ? "" : "s"}`)
        .join("; ")}); details withheld.`
    );
  }
  return { cases: localSubject.evaluationCases, localSubject, env: process.env };
}

// External-local retrieval-query-strategy-comparison: same loader and safety order as retrieval-precision-recall, with
// the plugin's own config validation. Ground-truth issues carry logical case ids and counts only.
async function loadRetrievalQueryStrategyComparisonLocalSubjectInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext,
  outputRoot: string | undefined
): Promise<Record<string, unknown>> {
  const validation = retrievalQueryStrategyComparisonPlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid retrieval query strategy comparison config: ${validation.errors.join("; ")}`);
  }
  if (outputRoot === undefined || args.localSubjectConfigPath === undefined) {
    throw new Error("Internal error: external-local runs require a resolved experiment output root and config path.");
  }
  const target = resolveExperimentTarget(args.targetPath, toolRoot);
  if (target.isSelf || target.kind !== "external-local") {
    throw new Error("Local-repository subject mode requires an external-local target; --target must not be the Lab repository.");
  }
  try {
    await assertWorkRootOutsideTarget(outputRoot, target.targetRoot);
  } catch {
    throw new Error("Experiment output root must not be inside the external target project.");
  }
  const configPath = path.resolve(context.invocationCwd, args.localSubjectConfigPath);
  const localSubjectConfig = await readJsonConfigFile("--local-subject-config", configPath, args.localSubjectConfigPath);
  const localSubject = await loadLocalRepositorySubject({ config: localSubjectConfig, repositoryPath: target.targetRoot });
  const groundTruthIssues = summarizeRetrievalGroundTruthIssuesSafely(localSubject.evaluationCases);
  if (groundTruthIssues.length > 0) {
    throw new Error(
      `Invalid retrieval-query-strategy-comparison ground truth for the local subject (${groundTruthIssues
        .map((issue) => `case ${issue.caseId}: ${issue.issueCount} issue${issue.issueCount === 1 ? "" : "s"}`)
        .join("; ")}); details withheld.`
    );
  }
  return { cases: localSubject.evaluationCases, localSubject, env: process.env };
}

// The frozen bundled corpus is the same warm-index corpus and must satisfy the same complete ground-truth contract.
async function loadRetrievalQueryStrategyComparisonInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext
): Promise<Record<string, unknown>> {
  const validation = retrievalQueryStrategyComparisonPlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid retrieval query strategy comparison config: ${validation.errors.join("; ")}`);
  }
  const projectProfiles = await readBenchmarkProjectProfiles(resolvePackageResource(context, DEFAULT_PROJECT_PROFILES_RESOURCE), toolRoot);
  const cases = await readEvaluationCases(resolvePackageResource(context, RETRIEVAL_QUERY_STRATEGY_COMPARISON_CASES_RESOURCE), toolRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  const corpusErrors = validateRetrievalPrecisionRecallCorpus(cases);
  if (corpusErrors.length > 0) {
    throw new Error(`Invalid retrieval-query-strategy-comparison corpus: ${corpusErrors.join(" ")}`);
  }
  return { cases };
}

// External-local retrieval-precision-recall: the existing local-subject loader owns the repository, inventory and case
// adapter. The only additions are the physical output-root check before anything is created and a ground-truth gate
// whose message carries logical case ids and counts only (an external subject may have private fact ids and names).
async function loadRetrievalPrecisionRecallLocalSubjectInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext,
  outputRoot: string | undefined
): Promise<Record<string, unknown>> {
  const validation = retrievalPrecisionRecallPlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid retrieval precision/recall config: ${validation.errors.join("; ")}`);
  }
  if (outputRoot === undefined || args.localSubjectConfigPath === undefined) {
    throw new Error("Internal error: external-local runs require a resolved experiment output root and config path.");
  }
  const target = resolveExperimentTarget(args.targetPath, toolRoot);
  if (target.isSelf || target.kind !== "external-local") {
    throw new Error("Local-repository subject mode requires an external-local target; --target must not be the Lab repository.");
  }
  // Fail closed before anything is created: the output root (and the private scratch beneath it) must be physically outside the target.
  try {
    await assertWorkRootOutsideTarget(outputRoot, target.targetRoot);
  } catch {
    throw new Error("Experiment output root must not be inside the external target project.");
  }
  const configPath = path.resolve(context.invocationCwd, args.localSubjectConfigPath);
  const localSubjectConfig = await readJsonConfigFile("--local-subject-config", configPath, args.localSubjectConfigPath);
  const localSubject = await loadLocalRepositorySubject({ config: localSubjectConfig, repositoryPath: target.targetRoot });
  const groundTruthIssues = summarizeRetrievalGroundTruthIssuesSafely(localSubject.evaluationCases);
  if (groundTruthIssues.length > 0) {
    throw new Error(
      `Invalid retrieval-precision-recall ground truth for the local subject (${groundTruthIssues
        .map((issue) => `case ${issue.caseId}: ${issue.issueCount} issue${issue.issueCount === 1 ? "" : "s"}`)
        .join("; ")}); details withheld.`
    );
  }
  return { cases: localSubject.evaluationCases, localSubject, env: process.env };
}

// The frozen bundled corpus is read through the established resource resolver and validation path, then must satisfy
// the retrieval-precision-recall ground-truth completeness rules. Selection filters are applied by the plugin.
async function loadRetrievalPrecisionRecallInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext
): Promise<Record<string, unknown>> {
  const validation = retrievalPrecisionRecallPlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid retrieval precision/recall config: ${validation.errors.join("; ")}`);
  }
  const projectProfiles = await readBenchmarkProjectProfiles(resolvePackageResource(context, DEFAULT_PROJECT_PROFILES_RESOURCE), toolRoot);
  const cases = await readEvaluationCases(resolvePackageResource(context, RETRIEVAL_PRECISION_RECALL_CASES_RESOURCE), toolRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  const corpusErrors = validateRetrievalPrecisionRecallCorpus(cases);
  if (corpusErrors.length > 0) {
    throw new Error(`Invalid retrieval-precision-recall corpus: ${corpusErrors.join(" ")}`);
  }
  return { cases };
}

// --case is a selection over the frozen bundled catalog (catalog order, not argument order);
// the rest of the CLI config is the plugin's own ContextWindowScalingConfig.
function pluginConfigFor(args: ParsedRunExperimentArgs): ParsedExperimentRunConfig {
  if (args.experimentId !== contextWindowScalingPlugin.metadata.id) return args.config;
  const { caseIds: _caseIds, ...config } = args.config;
  return config;
}

async function loadContextWindowScalingInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext,
  outputRoot: string | undefined
): Promise<Record<string, unknown>> {
  const validation = contextWindowScalingPlugin.validateConfig(pluginConfigFor(args));
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid context window scaling config: ${validation.errors.join("; ")}`);
  }
  if (args.localSubjectConfigPath !== undefined) {
    if (outputRoot === undefined) {
      throw new Error("Internal error: external-local runs require a resolved experiment output root.");
    }
    const target = resolveExperimentTarget(args.targetPath, toolRoot);
    if (target.isSelf || target.kind !== "external-local") {
      throw new Error("Local-repository subject mode requires an external-local target; --target must not be the Lab repository.");
    }
    // Fail closed before anything is created: the output root (and the private scratch beneath it) must be outside the target.
    try {
      await assertWorkRootOutsideTarget(outputRoot, target.targetRoot);
    } catch {
      throw new Error("Experiment output root must not be inside the external target project.");
    }
    const configPath = path.resolve(context.invocationCwd, args.localSubjectConfigPath);
    const localSubjectConfig = await readJsonConfigFile("--local-subject-config", configPath, args.localSubjectConfigPath);
    // The selected --target is the physical root handed to the Batch 1 loader; the config carries no path.
    const localSubject = await loadLocalRepositorySubject({ config: localSubjectConfig, repositoryPath: target.targetRoot });
    return { cases: localSubject.evaluationCases, localSubject, env: process.env };
  }
  if (args.syntheticConfigPath !== undefined) {
    if (outputRoot === undefined) {
      throw new Error("Internal error: synthetic generation requires a resolved experiment output root.");
    }
    const configPath = path.resolve(context.invocationCwd, args.syntheticConfigPath);
    const syntheticRepositoryConfig = await readSyntheticConfigJson(configPath, args.syntheticConfigPath);
    const prepared = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig, outputRoot });
    return { cases: prepared.cases, projectProfiles: prepared.projectProfiles, env: process.env };
  }
  const catalog = await readEvaluationCases(resolvePackageResource(context, CONTEXT_WINDOW_SCALING_CASES_RESOURCE), toolRoot);
  const requested = args.config.caseIds;
  if (requested === undefined) return { cases: catalog, env: process.env };
  const duplicates = [...new Set(requested.filter((id, position) => requested.indexOf(id) !== position))];
  if (duplicates.length > 0) {
    throw new Error(`--case contains duplicate case id(s): ${duplicates.join(", ")}.`);
  }
  const known = new Set(catalog.map((evaluationCase) => evaluationCase.id));
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `--case contains unknown case id(s): ${unknown.join(", ")}. Expected one of ${catalog.map((evaluationCase) => evaluationCase.id).join(", ")}.`
    );
  }
  return { cases: catalog.filter((evaluationCase) => requested.includes(evaluationCase.id)), env: process.env };
}

// The command only reads and parses the caller-supplied file; schema validation belongs to the synthetic planner.
async function readSyntheticConfigJson(resolvedPath: string, displayPath: string): Promise<unknown> {
  return readJsonConfigFile("--synthetic-config", resolvedPath, displayPath);
}

async function readJsonConfigFile(flag: string, resolvedPath: string, displayPath: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${flag} ${displayPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${flag} ${displayPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readLoadedLocalSubject(inputs: Record<string, unknown> | undefined): LocalRepositorySubject | undefined {
  const value = inputs?.localSubject;
  return value && typeof value === "object" ? (value as LocalRepositorySubject) : undefined;
}

// Shared by both registered plugins: explicit paths resolve against toolRoot, defaults come from
// bundled package resources so they do not depend on the invocation cwd.
async function loadCasesAndProjectProfiles(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext
): Promise<Record<string, unknown>> {
  const projectProfilesPath = args.config.projectProfilesPath
    ? path.resolve(toolRoot, args.config.projectProfilesPath)
    : resolvePackageResource(context, DEFAULT_PROJECT_PROFILES_RESOURCE);
  const casesPath = args.config.casesPath
    ? path.resolve(toolRoot, args.config.casesPath)
    : resolvePackageResource(context, DEFAULT_CASES_RESOURCE);
  const projectProfiles = await readBenchmarkProjectProfiles(projectProfilesPath, toolRoot);
  const cases = await readEvaluationCases(casesPath, toolRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  return { cases, projectProfiles, env: process.env };
}

// Campaign resource resolution (v0.5.2 Batch 1): the preset owns both bundled resource paths;
// explicit --cases/--project-profiles are already rejected for campaign mode by argument parsing.
async function loadCampaignCasesAndProjectProfiles(
  campaignPresetId: WarmIndexCampaignPresetId,
  toolRoot: string,
  context: LabExecutionContext
): Promise<Record<string, unknown>> {
  const preset = getWarmIndexCampaignPreset(campaignPresetId);
  const projectProfilesPath = resolvePackageResource(context, preset.projectProfilesResourcePath);
  const casesPath = resolvePackageResource(context, preset.casesResourcePath);
  const projectProfiles = await readBenchmarkProjectProfiles(projectProfilesPath, toolRoot);
  const cases = await readEvaluationCases(casesPath, toolRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  return { cases, projectProfiles, env: process.env };
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRequiredValue(argv: string[], index: number, label: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${label} requires a value.`);
  }
  return value;
}

function parseRepairAttempts(value: string): number {
  if (!/^[0-2]$/.test(value)) {
    throw new Error("--repair-attempts must be 0, 1 or 2.");
  }
  return Number(value);
}

function parsePositiveInteger(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function agentSuccessRateSummaryLines(result: { metadata?: Record<string, unknown> }, textPath: string): string[] {
  const mode = readMetadataString(result.metadata?.executionMode) ?? "deterministic-fixture";
  const provider = readMetadataString(result.metadata?.providerId);
  return [
    `Report Text: ${textPath}`,
    `Execution mode: ${mode}`,
    ...(provider ? [`Provider: ${provider} (invoked by explicit --include-real-agents authorization)`] : ["Provider: none (deterministic-fixture; no coding agent was invoked)"])
  ];
}

function readMetadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}
