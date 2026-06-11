import path from "node:path";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../evaluation/index.js";
import {
  generatePromptVariants,
  parsePromptComplexityLevel,
  parsePromptStrategy,
  writePromptArtifacts
} from "../prompts/index.js";
import type { PromptComplexityLevel, PromptStrategy } from "../prompts/types.js";

export type ParsedGeneratePromptVariantsArgs = {
  casesPath: string;
  outDir: string;
  projectProfilesPath: string;
  strategy?: PromptStrategy;
  complexity?: PromptComplexityLevel;
};

export function parseGeneratePromptVariantsArgs(argv: string[]): ParsedGeneratePromptVariantsArgs {
  let casesPath = "";
  let outDir = "";
  let projectProfilesPath = "benchmarks/contracts/benchmark-project-profiles.json";
  let strategy: PromptStrategy | undefined;
  let complexity: PromptComplexityLevel | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cases") {
      casesPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--project-profiles") {
      projectProfilesPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--strategy") {
      strategy = parsePromptStrategy(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--complexity") {
      complexity = parsePromptComplexityLevel(argv[index + 1] ?? "");
      index += 1;
    }
  }

  if (!casesPath || !outDir || !projectProfilesPath) {
    throw new Error("Usage: --cases <path> --out <directory> [--project-profiles <path>] [--strategy <raw-full-file|my-dev-kit-guided>] [--complexity <short|medium|long|multi-step>]");
  }

  return { casesPath, outDir, projectProfilesPath, strategy, complexity };
}

export async function runGeneratePromptVariants(args: ParsedGeneratePromptVariantsArgs, repoRoot = process.cwd()) {
  const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, args.projectProfilesPath), repoRoot);
  const cases = await readEvaluationCases(path.resolve(repoRoot, args.casesPath), repoRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  const variants = generatePromptVariants({
    cases,
    projectProfiles,
    strategies: args.strategy ? [args.strategy] : undefined,
    complexityLevels: args.complexity ? [args.complexity] : undefined
  });
  const summary = await writePromptArtifacts({
    outDir: path.resolve(repoRoot, args.outDir),
    variants
  });
  return { cases, projectProfiles, variants, summary };
}

export async function runGeneratePromptVariantsCommand(argv: string[]): Promise<number> {
  try {
    const args = parseGeneratePromptVariantsArgs(argv);
    const result = await runGeneratePromptVariants(args);
    console.log(
      [`Cases: ${result.summary.caseCount}`, `Prompts: ${result.summary.promptCount}`, `Output: ${path.resolve(args.outDir)}`].join("\n")
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
