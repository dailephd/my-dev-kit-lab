import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../core/pathSafety.js";
import type { ExperimentPluginMetadata, ExperimentRun } from "../../experiments/index.js";
import { buildPluginExperimentReport } from "./buildPluginExperimentReport.js";
import { renderPluginExperimentReportHtml } from "./renderPluginExperimentReportHtml.js";
import { renderPluginExperimentReportText } from "./renderPluginExperimentReportText.js";
import type { PluginExperimentReport } from "./experimentReportModel.js";

export type PluginExperimentReportPaths = {
  outDir: string;
  jsonPath: string;
  htmlPath: string;
  textPath: string;
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
  /**
   * External-local privacy: files are still written under `outputRoot`, but the serialized report and its
   * `outputPaths` carry a redacted marker and bare file names instead of the machine-local output directory.
   */
  redactOutputRoot?: boolean;
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
    textPath: resolveWithinRoot(outDir, "report.txt"),
  };
  await mkdir(outputPaths.outDir, { recursive: true });
  const builtReport = buildPluginExperimentReport({
    run: args.run,
    plugin: args.plugin,
    outputRoot: outputPaths.outDir,
    generatedAt: args.generatedAt,
  });
  const report: PluginExperimentReport = args.redactOutputRoot
    ? { ...builtReport, metadata: { ...builtReport.metadata, outputRoot: "[redacted]" } }
    : builtReport;
  const serializedPaths: PluginExperimentReportPaths = args.redactOutputRoot
    ? { outDir: "[redacted]", jsonPath: "report.json", htmlPath: "report.html", textPath: "report.txt" }
    : outputPaths;
  await writeFile(
    outputPaths.jsonPath,
    `${JSON.stringify({ report, outputPaths: serializedPaths }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(outputPaths.htmlPath, renderPluginExperimentReportHtml(report), "utf8");
  await writeFile(outputPaths.textPath, renderPluginExperimentReportText(report), "utf8");
  return { report, outputPaths };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
