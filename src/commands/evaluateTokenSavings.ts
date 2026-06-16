import path from "node:path";
import { readEvaluationCases, runRawFullFileBaseline, runMyDevKitRetrieval, compareTokenSavings, writeTokenSavingsArtifacts } from "../evaluation/index.js";
import { captureReportScreenshot, SCREENSHOT_SKIP_WARNING } from "../screenshot/index.js";
import type { EvaluationCase, TokenSavingsCommandConfig, TokenSavingsRunRecord } from "../evaluation/types.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";

export type ParsedEvaluateTokenSavingsArgs = {
  casesPath: string;
  kitCommand: string;
  outDir: string;
  requireKit: boolean;
  noScreenshot: boolean;
};

export type TokenSavingsEvaluationResult = {
  commandConfig: TokenSavingsCommandConfig;
  cases: EvaluationCase[];
  runs: TokenSavingsRunRecord[];
  comparison: ReturnType<typeof compareTokenSavings>;
  artifacts: Awaited<ReturnType<typeof writeTokenSavingsArtifacts>>;
};

export function parseEvaluateTokenSavingsArgs(argv: string[]): ParsedEvaluateTokenSavingsArgs {
  let casesPath = "";
  let kitCommand = "";
  let outDir = "";
  let requireKit = false;
  let noScreenshot = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cases") {
      casesPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--kit-command") {
      kitCommand = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--require-kit") {
      requireKit = true;
    } else if (arg === "--no-screenshot") {
      noScreenshot = true;
    }
  }

  if (!casesPath || !kitCommand || !outDir) {
    throw new Error("Usage: --cases <path> --kit-command <command> --out <directory> [--require-kit] [--no-screenshot]");
  }

  return { casesPath, kitCommand, outDir, requireKit, noScreenshot };
}

function summarize(summary: { caseCount: number; completedCaseCount: number; skippedCaseCount: number; totalTokensSaved: number }, outDir: string): string {
  return [
    `Cases: ${summary.caseCount}`,
    `Completed: ${summary.completedCaseCount}`,
    `Skipped: ${summary.skippedCaseCount}`,
    `Total estimated tokens saved: ${summary.totalTokensSaved}`,
    `Output: ${outDir}`
  ].join("\n");
}

export async function runTokenSavingsEvaluation(args: ParsedEvaluateTokenSavingsArgs, repoRoot = process.cwd()): Promise<TokenSavingsEvaluationResult> {
  const cases = await readEvaluationCases(path.resolve(repoRoot, args.casesPath), repoRoot);
  const outputDir = path.resolve(repoRoot, args.outDir);
  const commandConfig: TokenSavingsCommandConfig = {
    casesPath: path.resolve(repoRoot, args.casesPath),
    kitCommand: args.kitCommand,
    requireKit: args.requireKit,
    noScreenshot: args.noScreenshot,
    outputDir
  };

  const evaluations: Array<{
    evaluationCase: EvaluationCase;
    rawBaseline: Awaited<ReturnType<typeof runRawFullFileBaseline>>;
    myDevKit: Awaited<ReturnType<typeof runMyDevKitRetrieval>>;
  }> = [];

  for (const evaluationCase of cases) {
    const rawBaseline = await runRawFullFileBaseline(evaluationCase);
    const myDevKit = await runMyDevKitRetrieval({
      evaluationCase,
      kitCommand: args.kitCommand,
      outputDir,
      requireKit: args.requireKit
    });
    evaluations.push({ evaluationCase, rawBaseline, myDevKit });
  }

  const comparison = compareTokenSavings(evaluations);
  let screenshot: ScreenshotCaptureResult = {
    status: "skipped",
    htmlPath: path.join(outputDir, "token-savings-report.html"),
    pngPath: path.join(outputDir, "token-savings-report.png")
  };

  const runs: TokenSavingsRunRecord[] = evaluations.map(({ evaluationCase, rawBaseline, myDevKit }, index) => ({
    case: {
      id: evaluationCase.id,
      title: evaluationCase.title,
      benchmarkProject: evaluationCase.benchmarkProject,
      targetRoot: evaluationCase.targetRoot,
      sourceRoots: evaluationCase.sourceRoots,
      query: evaluationCase.query,
      expectedFiles: evaluationCase.expectedFiles,
      expectedSymbols: evaluationCase.expectedSymbols,
      rawIncludeGlobs: evaluationCase.rawIncludeGlobs,
      notes: evaluationCase.notes
    },
    rawBaseline: {
      caseId: rawBaseline.caseId,
      targetRoot: rawBaseline.targetRoot,
      filesIncluded: rawBaseline.filesIncluded,
      totalFiles: rawBaseline.totalFiles,
      totalChars: rawBaseline.totalChars,
      totalEstimatedTokens: rawBaseline.totalEstimatedTokens,
      tokenCountMethod: rawBaseline.tokenCountMethod,
      durationMs: rawBaseline.durationMs
    },
    myDevKit: {
      caseId: myDevKit.caseId,
      skipped: myDevKit.skipped,
      warnings: myDevKit.warnings,
      totalChars: myDevKit.totalChars,
      totalEstimatedTokens: myDevKit.totalEstimatedTokens,
      tokenCountMethod: myDevKit.tokenCountMethod,
      filesRead: myDevKit.filesRead,
      commands: myDevKit.commands,
      selectedNodeId: myDevKit.selectedNodeId,
      selectedFile: myDevKit.selectedFile,
      selectedSymbol: myDevKit.selectedSymbol,
      durationMs: myDevKit.durationMs,
      commandTelemetry: myDevKit.commands.map((command) => ({
        commandId: command.commandId,
        stdoutPath: command.stdoutPath,
        stderrPath: command.stderrPath,
        telemetryPath: command.telemetryPath,
        exitCode: command.exitCode,
        ok: command.ok
      }))
    },
    comparison: comparison.cases[index]
  }));

  let artifacts = await writeTokenSavingsArtifacts({
    outDir: outputDir,
    summary: comparison.summary,
    runs,
    comparisonCases: comparison.cases,
    commandConfig,
    screenshot
  });

  if (args.noScreenshot) {
    screenshot = {
      status: "skipped",
      htmlPath: artifacts.artifactPaths.htmlPath,
      pngPath: artifacts.artifactPaths.pngPath,
      warning: "PNG screenshot skipped because --no-screenshot was provided."
    };
  } else {
    screenshot = await captureReportScreenshot(artifacts.artifactPaths.htmlPath, artifacts.artifactPaths.pngPath);
    if (screenshot.status === "skipped" && !screenshot.warning) {
      screenshot.warning = SCREENSHOT_SKIP_WARNING;
    }
  }

  artifacts = await writeTokenSavingsArtifacts({
    outDir: outputDir,
    summary: comparison.summary,
    runs,
    comparisonCases: comparison.cases,
    commandConfig,
    screenshot
  });

  return {
    commandConfig,
    cases,
    runs,
    comparison,
    artifacts
  };
}

export async function runEvaluateTokenSavingsCommand(argv: string[]): Promise<number> {
  try {
    const args = parseEvaluateTokenSavingsArgs(argv);
    const result = await runTokenSavingsEvaluation(args);
    const { artifacts } = result;
    console.log(summarize(artifacts.summary, result.commandConfig.outputDir));
    if (args.requireKit && artifacts.summary.completedCaseCount === 0) {
      return 1;
    }
    if (artifacts.screenshot.status === "failed" && args.requireKit) {
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
