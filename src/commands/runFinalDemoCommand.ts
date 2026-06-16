import path from "node:path";
import { parsePromptComplexityLevel, parsePromptStrategy } from "../prompts/index.js";
import { parseAgentId } from "../agents/agentRegistry.js";
import { runControlledExperimentFromArgs } from "./runControlledExperimentCommand.js";
import { runRenderExperimentReportFromArgs } from "./renderExperimentReportCommand.js";
import { runGenerateExperimentPlotsFromArgs } from "./generateExperimentPlotsCommand.js";
import { runVisualizationDemosFromArgs } from "./runVisualizationDemosCommand.js";
import { runBuildGalleryFromArgs } from "./buildGalleryCommand.js";
import type { ExperimentAgentId } from "../evaluation/controlledExperimentTypes.js";

export type ParsedRunFinalDemoArgs = {
  casesPath: string;
  outDir: string;
  kitCommand: string;
  agents: ExperimentAgentId[];
  strategies: Array<"raw-full-file" | "my-dev-kit-guided">;
  complexities: Array<"short" | "medium" | "long" | "multi-step">;
  caseIds?: string[];
  benchmarkProjects?: string[];
  maxRuns?: number;
  screenshot: boolean;
  includeRealAgents: boolean;
  continueOnFailure: boolean;
  timeoutMs?: number;
};

export function parseRunFinalDemoArgs(argv: string[]): ParsedRunFinalDemoArgs {
  let casesPath = "";
  let outDir = "";
  let kitCommand = "";
  let agents: ExperimentAgentId[] = ["fake-agent"];
  let strategies: Array<"raw-full-file" | "my-dev-kit-guided"> = ["raw-full-file", "my-dev-kit-guided"];
  let complexities: Array<"short" | "medium" | "long" | "multi-step"> = ["short"];
  let caseIds: string[] | undefined;
  let benchmarkProjects: string[] | undefined;
  let maxRuns: number | undefined;
  let screenshot = false;
  let includeRealAgents = false;
  let continueOnFailure = true;
  let timeoutMs: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cases") { casesPath = argv[++index] ?? ""; }
    else if (arg === "--out") { outDir = argv[++index] ?? ""; }
    else if (arg === "--kit-command") { kitCommand = argv[++index] ?? ""; }
    else if (arg === "--agents") { agents = splitList(argv[++index] ?? "").map((value) => parseAgentId(value) as ExperimentAgentId); }
    else if (arg === "--strategies") { strategies = splitList(argv[++index] ?? "").map(parsePromptStrategy) as ParsedRunFinalDemoArgs["strategies"]; }
    else if (arg === "--complexities") { complexities = splitList(argv[++index] ?? "").map(parsePromptComplexityLevel) as ParsedRunFinalDemoArgs["complexities"]; }
    else if (arg === "--case") { caseIds = splitList(argv[++index] ?? ""); }
    else if (arg === "--benchmark-project") { benchmarkProjects = splitList(argv[++index] ?? ""); }
    else if (arg === "--max-runs") { maxRuns = Number(argv[++index]); }
    else if (arg === "--screenshot") { screenshot = true; }
    else if (arg === "--no-screenshot") { screenshot = false; }
    else if (arg === "--include-real-agents") { includeRealAgents = true; }
    else if (arg === "--continue-on-failure") { continueOnFailure = true; }
    else if (arg === "--no-continue-on-failure") { continueOnFailure = false; }
    else if (arg === "--timeout-ms") { timeoutMs = Number(argv[++index]); }
  }
  if (!casesPath || !outDir || !kitCommand) throw new Error("Usage: --cases <path> --out <dir> --kit-command <command>");
  return { casesPath, outDir, kitCommand, agents, strategies, complexities, caseIds, benchmarkProjects, maxRuns, screenshot, includeRealAgents, continueOnFailure, timeoutMs };
}

export async function runFinalDemoFromArgs(args: ParsedRunFinalDemoArgs, repoRoot = process.cwd()) {
  const rootOut = path.resolve(repoRoot, args.outDir);
  const experimentDir = path.join(rootOut, "controlled-experiment");
  const plotsDir = path.join(rootOut, "plots");
  const visualizationsDir = path.join(rootOut, "visualization-demos");
  const reportDir = path.join(rootOut, "experiment-report");
  const galleryDir = path.join(rootOut, "gallery");
  const experiment = await runControlledExperimentFromArgs({
    casesPath: args.casesPath,
    projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
    outDir: experimentDir,
    agents: args.agents,
    strategies: args.strategies,
    complexityLevels: args.complexities,
    caseIds: args.caseIds,
    benchmarkProjects: args.benchmarkProjects,
    maxRuns: args.maxRuns,
    includeRealAgents: args.includeRealAgents,
    continueOnFailure: args.continueOnFailure,
    timeoutMs: args.timeoutMs
  }, repoRoot);
  const plots = await runGenerateExperimentPlotsFromArgs({ experimentDir, outDir: plotsDir }, repoRoot);
  const firstProject = experiment.projectProfiles[0]?.rootPath ?? "benchmarks/projects/todo-ts";
  const visualization = await runVisualizationDemosFromArgs({ projectPath: firstProject, kitCommand: args.kitCommand, outDir: visualizationsDir, timeoutMs: args.timeoutMs }, repoRoot);
  const report = await runRenderExperimentReportFromArgs({ experimentDir, outDir: reportDir, screenshot: args.screenshot, requireScreenshot: false, plotsDir, visualizationsDir }, repoRoot);
  const gallery = await runBuildGalleryFromArgs({ experimentDir, reportDir, plotsDir, visualizationsDir, outDir: galleryDir }, repoRoot);
  return { experiment, plots, visualization, report, gallery, outDir: rootOut };
}

export async function runFinalDemoCommand(argv: string[]): Promise<number> {
  try {
    const args = parseRunFinalDemoArgs(argv);
    const result = await runFinalDemoFromArgs(args);
    console.log([
      `Experiment runs: ${result.experiment.artifacts.summary.totalRuns}`,
      `Charts: ${result.plots.summary.chartCount}`,
      `Visualization runs: ${result.visualization.summary.totalRuns}`,
      `Gallery manifest: ${result.gallery.manifestPath}`,
      `Output: ${result.outDir}`
    ].join("\n"));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
