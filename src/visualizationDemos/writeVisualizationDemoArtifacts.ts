import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../core/pathSafety.js";
import type { VisualizationDemoArtifacts, VisualizationDemoRun, VisualizationDemoSummary } from "./types.js";

export async function writeVisualizationDemoArtifacts(options: {
  outDir: string;
  projectPath: string;
  kitCommand: string;
  runs: VisualizationDemoRun[];
  warnings: string[];
  generatedAt?: string;
}): Promise<VisualizationDemoArtifacts> {
  const outDir = path.resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const artifactPaths = {
    summaryPath: resolveWithinRoot(outDir, "visualization-demo-summary.json"),
    runsPath: resolveWithinRoot(outDir, "visualization-demo-runs.json"),
    commandsDir: resolveWithinRoot(outDir, "commands"),
    artifactsDir: resolveWithinRoot(outDir, "artifacts")
  };
  const summary: VisualizationDemoSummary = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    projectPath: path.resolve(options.projectPath),
    kitCommand: options.kitCommand,
    totalRuns: options.runs.length,
    completedRuns: options.runs.filter((run) => run.ok).length,
    failedRuns: options.runs.filter((run) => !run.ok).length,
    warnings: options.warnings
  };
  await writeFile(artifactPaths.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(artifactPaths.runsPath, `${JSON.stringify({ generatedAt: summary.generatedAt, runs: options.runs }, null, 2)}\n`, "utf8");
  return { summary, runs: options.runs, artifactPaths, warnings: options.warnings };
}
