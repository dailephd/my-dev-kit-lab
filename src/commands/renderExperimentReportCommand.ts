import { access } from "node:fs/promises";
import path from "node:path";
import { captureReportScreenshot, SCREENSHOT_SKIP_WARNING } from "../screenshot/index.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";
import {
  buildExperimentReportInput,
  getExperimentReportArtifactPaths,
  writeExperimentReportArtifacts
} from "../report/index.js";

export type ParsedRenderExperimentReportArgs = {
  experimentDir: string;
  outDir: string;
  title?: string;
  subtitle?: string;
  screenshot: boolean;
  requireScreenshot: boolean;
  maxPromptChars?: number;
  maxFileTreeEntries?: number;
  plotsDir?: string;
  visualizationsDir?: string;
};

export type RenderExperimentReportCommandDependencies = {
  captureScreenshot?: typeof captureReportScreenshot;
};

export function parseRenderExperimentReportArgs(argv: string[]): ParsedRenderExperimentReportArgs {
  let experimentDir = "";
  let outDir = "";
  let title: string | undefined;
  let subtitle: string | undefined;
  let screenshot = false;
  let requireScreenshot = false;
  let maxPromptChars: number | undefined;
  let maxFileTreeEntries: number | undefined;
  let plotsDir: string | undefined;
  let visualizationsDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--experiment") {
      experimentDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--title") {
      title = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--subtitle") {
      subtitle = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--screenshot") {
      screenshot = true;
    } else if (arg === "--no-screenshot") {
      screenshot = false;
    } else if (arg === "--require-screenshot") {
      requireScreenshot = true;
      screenshot = true;
    } else if (arg === "--max-prompt-chars") {
      maxPromptChars = parsePositiveInteger("--max-prompt-chars", argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--max-file-tree-entries") {
      maxFileTreeEntries = parsePositiveInteger("--max-file-tree-entries", argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--plots") {
      plotsDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--visualizations") {
      visualizationsDir = argv[index + 1] ?? "";
      index += 1;
    }
  }

  if (!experimentDir || !outDir) {
    throw new Error(
      [
        "Usage: --experiment <controlled-experiment-dir> --out <directory>",
        "[--title <title>] [--subtitle <subtitle>] [--screenshot|--no-screenshot]",
        "[--require-screenshot] [--max-prompt-chars <n>] [--max-file-tree-entries <n>]",
        "[--plots <dir>] [--visualizations <dir>]"
      ].join(" ")
    );
  }

  return { experimentDir, outDir, title, subtitle, screenshot, requireScreenshot, maxPromptChars, maxFileTreeEntries, plotsDir, visualizationsDir };
}

export async function runRenderExperimentReportFromArgs(
  args: ParsedRenderExperimentReportArgs,
  repoRoot = process.cwd(),
  dependencies: RenderExperimentReportCommandDependencies = {}
) {
  const experimentDir = path.resolve(repoRoot, args.experimentDir);
  await access(experimentDir).catch(() => {
    throw new Error(`Experiment directory not found: ${args.experimentDir}`);
  });
  const outDir = path.resolve(repoRoot, args.outDir);
  const outputPaths = getExperimentReportArtifactPaths(outDir);
  const report = await buildExperimentReportInput({
    experimentDir,
    repoRoot,
    title: args.title,
    subtitle: args.subtitle,
    maxPromptChars: args.maxPromptChars,
    maxFileTreeEntries: args.maxFileTreeEntries,
    plotsDir: args.plotsDir,
    visualizationsDir: args.visualizationsDir
  });

  let screenshot: ScreenshotCaptureResult = {
    status: "skipped",
    htmlPath: outputPaths.htmlPath,
    pngPath: outputPaths.pngPath,
    warning: "PNG screenshot skipped because --screenshot was not provided."
  };
  let result = await writeExperimentReportArtifacts({ outDir, report, screenshot });

  if (args.screenshot) {
    const captureScreenshot = dependencies.captureScreenshot ?? captureReportScreenshot;
    screenshot = await captureScreenshot(outputPaths.htmlPath, outputPaths.pngPath);
    if (screenshot.status === "skipped" && !screenshot.warning) {
      screenshot.warning = SCREENSHOT_SKIP_WARNING;
    }
    result = await writeExperimentReportArtifacts({ outDir, report, screenshot });
  }

  if (args.requireScreenshot && result.screenshot.status !== "captured") {
    throw new Error(result.screenshot.error ?? result.screenshot.warning ?? "Required screenshot was not captured.");
  }

  return result;
}

export async function runRenderExperimentReportCommand(argv: string[]): Promise<number> {
  try {
    const args = parseRenderExperimentReportArgs(argv);
    const result = await runRenderExperimentReportFromArgs(args);
    console.log(
      [
        `Report: ${result.outputPaths.htmlPath}`,
        `JSON: ${result.outputPaths.jsonPath}`,
        `Screenshot: ${result.screenshot.status}`,
        `Output: ${result.outputPaths.outDir}`
      ].join("\n")
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parsePositiveInteger(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}
