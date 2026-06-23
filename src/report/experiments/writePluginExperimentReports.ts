import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../core/pathSafety.js";
import type { ExperimentPluginMetadata, ExperimentRun } from "../../experiments/index.js";
import { buildPluginExperimentReport } from "./buildPluginExperimentReport.js";
import { renderPluginExperimentReportHtml } from "./renderPluginExperimentReportHtml.js";
import type { PluginExperimentReport } from "./experimentReportModel.js";

export type PluginExperimentReportPaths = {
  outDir: string;
  jsonPath: string;
  htmlPath: string;
};

export type WritePluginExperimentReportsResult = {
  report: PluginExperimentReport;
  outputPaths: PluginExperimentReportPaths;
};

export async function writePluginExperimentReports(args: {
  run: ExperimentRun;
  plugin: ExperimentPluginMetadata;
  outputRoot?: string;
  generatedAt?: string;
}): Promise<WritePluginExperimentReportsResult> {
  const rawOutDir = args.outputRoot ?? readString(args.run.metadata?.outputRoot);
  if (!rawOutDir) {
    throw new Error("Plugin experiment report output root is required.");
  }
  const outDir = path.resolve(rawOutDir);
  const outputPaths = {
    outDir,
    jsonPath: resolveWithinRoot(outDir, "report.json"),
    htmlPath: resolveWithinRoot(outDir, "report.html"),
  };
  await mkdir(outputPaths.outDir, { recursive: true });
  const report = buildPluginExperimentReport({
    run: args.run,
    plugin: args.plugin,
    outputRoot: outputPaths.outDir,
    generatedAt: args.generatedAt,
  });
  await writeFile(
    outputPaths.jsonPath,
    `${JSON.stringify({ report, outputPaths }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(outputPaths.htmlPath, renderPluginExperimentReportHtml(report), "utf8");
  return { report, outputPaths };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
