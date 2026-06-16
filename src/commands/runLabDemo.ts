import path from "node:path";
import { validateBenchmarks } from "../../scripts/verify-benchmarks.js";
import { runTokenSavingsEvaluation, parseEvaluateTokenSavingsArgs, type ParsedEvaluateTokenSavingsArgs } from "./evaluateTokenSavings.js";
import { writeGalleryManifest } from "../gallery/index.js";

export type ParsedRunLabDemoArgs = ParsedEvaluateTokenSavingsArgs & {
  skipBenchmarkValidation: boolean;
};

export type RunLabDemoResult = {
  benchmarkValidation: {
    skipped: boolean;
    ok: boolean;
    checks: string[];
    errors: string[];
  };
  evaluation: Awaited<ReturnType<typeof runTokenSavingsEvaluation>>;
  gallery: Awaited<ReturnType<typeof writeGalleryManifest>>;
  warnings: string[];
};

export function parseRunLabDemoArgs(argv: string[]): ParsedRunLabDemoArgs {
  const evaluationArgs = parseEvaluateTokenSavingsArgs(argv);
  return {
    ...evaluationArgs,
    skipBenchmarkValidation: argv.includes("--skip-benchmark-validation")
  };
}

function summarize(result: RunLabDemoResult, outDir: string): string {
  return [
    `Benchmark validation: ${result.benchmarkValidation.skipped ? "skipped" : result.benchmarkValidation.ok ? "passed" : "failed"}`,
    `Cases: ${result.evaluation.artifacts.summary.caseCount}`,
    `Completed: ${result.evaluation.artifacts.summary.completedCaseCount}`,
    `Skipped: ${result.evaluation.artifacts.summary.skippedCaseCount}`,
    `Gallery manifest: ${result.gallery.manifestPath}`,
    `Output: ${outDir}`
  ].join("\n");
}

export async function runLabDemo(args: ParsedRunLabDemoArgs, repoRoot = process.cwd()): Promise<RunLabDemoResult> {
  const warnings: string[] = [];
  const benchmarkValidation = args.skipBenchmarkValidation
    ? { skipped: true, ok: true, checks: [] as string[], errors: [] as string[] }
    : { skipped: false, ...validateBenchmarks(repoRoot) };

  if (!args.skipBenchmarkValidation && !benchmarkValidation.ok) {
    throw new Error(`Benchmark validation failed:\n${benchmarkValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  if (args.skipBenchmarkValidation) {
    warnings.push("Benchmark validation skipped because --skip-benchmark-validation was provided.");
  }

  const evaluation = await runTokenSavingsEvaluation(args, repoRoot);
  const gallery = await writeGalleryManifest({
    outDir: path.resolve(repoRoot, args.outDir),
    summary: evaluation.artifacts.summary,
    artifactPaths: evaluation.artifacts.artifactPaths,
    screenshot: evaluation.artifacts.screenshot,
    warnings: [...warnings, ...evaluation.artifacts.warnings]
  });

  return {
    benchmarkValidation,
    evaluation,
    gallery,
    warnings: gallery.manifest.warnings
  };
}

export async function runLabDemoCommand(argv: string[]): Promise<number> {
  try {
    const args = parseRunLabDemoArgs(argv);
    const result = await runLabDemo(args);
    console.log(summarize(result, path.resolve(args.outDir)));

    if (args.requireKit && result.evaluation.artifacts.summary.completedCaseCount === 0) {
      return 1;
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
