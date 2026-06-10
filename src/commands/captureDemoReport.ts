import { readFile } from "node:fs/promises";
import path from "node:path";
import { captureReportScreenshot, SCREENSHOT_SKIP_WARNING } from "../screenshot/index.js";
import type { LabReportInput } from "../report/index.js";
import { getReportArtifactPaths, normalizeLabReport, writeReportArtifacts } from "../report/index.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";

type FileReadError = Error & { code?: string };

type ParsedArgs = {
  inputPath: string;
  outDir: string;
  noScreenshot: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let inputPath = "";
  let outDir = "";
  let noScreenshot = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      inputPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--no-screenshot") {
      noScreenshot = true;
    }
  }

  if (!inputPath || !outDir) {
    throw new Error("Usage: --input <path> --out <directory> [--no-screenshot]");
  }

  return { inputPath, outDir, noScreenshot };
}

function validateReportInput(value: unknown): asserts value is LabReportInput {
  if (!value || typeof value !== "object") {
    throw new Error("Report input must be a JSON object.");
  }

  const report = value as Record<string, unknown>;
  const requiredStringFields = ["reportId", "title", "projectName", "benchmarkProject", "workflowName", "summary"];
  for (const field of requiredStringFields) {
    if (typeof report[field] !== "string" || report[field] === "") {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const requiredArrayFields = ["steps", "metrics", "artifacts", "warnings"];
  for (const field of requiredArrayFields) {
    if (!Array.isArray(report[field])) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

function summarizeResult(result: Awaited<ReturnType<typeof writeReportArtifacts>>): string {
  const lines = [
    `Report ID: ${result.report.reportId}`,
    `HTML: ${result.outputPaths.htmlPath}`,
    `JSON: ${result.outputPaths.jsonPath}`
  ];
  if (result.screenshot.status === "captured") {
    lines.push(`PNG: ${result.outputPaths.pngPath}`);
  }
  if (result.screenshot.status === "skipped" && result.screenshot.warning) {
    lines.push(result.screenshot.warning);
  }
  if (result.screenshot.status === "failed" && result.screenshot.error) {
    lines.push(`PNG screenshot failed: ${result.screenshot.error}`);
  }
  return lines.join("\n");
}

export async function runCaptureDemoReportCommand(argv: string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    const rawInput = await readFile(path.resolve(args.inputPath), "utf8").catch((error: unknown) => {
      const fileError = error as FileReadError;
      if (fileError.code === "ENOENT") {
        throw new Error(`Input file not found: ${args.inputPath}`);
      }
      throw error;
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawInput);
    } catch (error) {
      throw new Error(`Invalid JSON input: ${(error as Error).message}`);
    }

    validateReportInput(parsed);
    const report = normalizeLabReport(parsed);
    const outDir = path.resolve(args.outDir);
    const outputPaths = getReportArtifactPaths(outDir, report.reportId);

    let screenshot: ScreenshotCaptureResult;
    if (args.noScreenshot) {
      screenshot = {
        status: "skipped",
        htmlPath: outputPaths.htmlPath,
        pngPath: outputPaths.pngPath,
        warning: "PNG screenshot skipped because --no-screenshot was provided."
      };
    } else {
      await writeReportArtifacts({
        report,
        outDir,
        screenshot: {
          status: "skipped",
          htmlPath: outputPaths.htmlPath,
          pngPath: outputPaths.pngPath
        }
      });
      screenshot = await captureReportScreenshot(outputPaths.htmlPath, outputPaths.pngPath);
      if (screenshot.status === "skipped" && !screenshot.warning) {
        screenshot.warning = SCREENSHOT_SKIP_WARNING;
      }
    }

    const result = await writeReportArtifacts({ report, outDir, screenshot });
    console.log(summarizeResult(result));
    return screenshot.status === "failed" ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
