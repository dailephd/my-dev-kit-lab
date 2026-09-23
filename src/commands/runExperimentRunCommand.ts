import path from "node:path";
import { parseAgentCommandTemplate } from "../agents/index.js";
import { parseAgentId } from "../agents/agentRegistry.js";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../evaluation/index.js";
import {
  contextStrategyComparisonPlugin,
  createDefaultExperimentPluginRegistry,
  getWarmIndexCampaignPreset,
  parseWarmIndexCampaignPresetId,
  resolveExperimentTarget,
  runExperiment,
  warmIndexReusePlugin
} from "../experiments/index.js";
import type { WarmIndexCampaignPresetId } from "../experiments/index.js";
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

// Union of CLI-provided fields across plugins; each plugin's validateConfig narrows (and, for
// warm-index-reuse, rejects) the fields it does not support.
type ParsedExperimentRunConfig = Partial<ExperimentMatrixConfig> & {
  kitCommand?: string;
  campaignPreset?: WarmIndexCampaignPresetId;
};

type ParsedRunExperimentArgs = {
  experimentId: string;
  targetPath?: string;
  outDir?: string;
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

export async function runExperimentRunCommandFromArgs(
  argv: string[],
  options: RunExperimentRunCommandOptions = {}
): Promise<number> {
  try {
    const args = parseRunExperimentArgs(argv);
    const context = options.context ?? createLabExecutionContext();
    const toolRoot = context.packageRoot;
    const registry = createDefaultExperimentPluginRegistry();
    const inputs = await loadPluginInputs(args, toolRoot, context);
    const runId = generateExperimentRunId(args.experimentId);
    const outputRoot = resolveOutputRoot(args, {
      toolRoot,
      invocationCwd: context.invocationCwd,
      installedDefaultOutputRoot: options.installedDefaultOutputRoot,
      experimentId: args.experimentId,
      runId
    });
    const result = await runExperiment({
      pluginId: args.experimentId,
      registry,
      targetPath: args.targetPath,
      outputRoot,
      config: args.config,
      inputs,
      toolRoot,
      runId
    });
    const reports = await writePluginExperimentReports({
      run: result,
      plugin: registry.describe(result.pluginId),
      outputRoot: String(result.metadata?.outputRoot ?? "")
    });
    const outputLines = [
      `Experiment: ${result.pluginId}`,
      `Run ID: ${result.runId}`,
      `Status: ${result.status}`,
      `Mode: ${result.target.isSelf ? "self" : "external target"}`,
      `Tool root: ${result.target.toolRoot}`,
      `Target root: ${result.target.targetRoot}`,
      `Output: ${String(result.metadata?.outputRoot ?? "")}`,
      `Report JSON: ${reports.outputPaths.jsonPath}`,
      `Report HTML: ${reports.outputPaths.htmlPath}`
    ];

    // Automatic presentation (report already produced above) applies only to warm-index-reuse
    // campaign runs; legacy fake-agent warm-index runs and context-strategy-comparison stay
    // report-only, unchanged.
    let screenshotFailed = false;
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
        screenshotFailed = true;
      }
      outputLines.push(`Gallery manifest: ${presentation.gallery.manifestPath}`);
      outputLines.push(`Gallery index: ${presentation.gallery.indexPath}`);
    }

    console.log(outputLines.join("\n"));
    if (result.status === "failed") return 1;
    if (screenshotFailed) return 1;
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
  const commandTemplates: Partial<Record<"codex" | "claude", AgentCommandTemplate>> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    } else if (arg === "--case") {
      caseIds.push(...splitList(readRequiredValue(argv, ++index, "--case")));
    } else if (arg === "--benchmark-project") {
      benchmarkProjects.push(...splitList(readRequiredValue(argv, ++index, "--benchmark-project")));
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
  if (kitCommand !== undefined && experimentId !== warmIndexReusePlugin.metadata.id) {
    throw new Error(`--kit-command is only supported for --experiment ${warmIndexReusePlugin.metadata.id}.`);
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
      kitCommand,
      campaignPreset
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
  context: LabExecutionContext
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
  return undefined;
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

function parsePositiveInteger(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function readMetadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}
