import path from "node:path";
import { writePlotArtifacts } from "../plots/index.js";

export type ParsedGenerateExperimentPlotsArgs = {
  experimentDir: string;
  outDir: string;
};

export function parseGenerateExperimentPlotsArgs(argv: string[]): ParsedGenerateExperimentPlotsArgs {
  let experimentDir = "";
  let outDir = "";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--experiment") {
      experimentDir = argv[index + 1] ?? "";
      index += 1;
    } else if (argv[index] === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    }
  }
  if (!experimentDir || !outDir) throw new Error("Usage: --experiment <dir> --out <dir>");
  return { experimentDir, outDir };
}

export async function runGenerateExperimentPlotsFromArgs(args: ParsedGenerateExperimentPlotsArgs, repoRoot = process.cwd()) {
  return writePlotArtifacts({
    experimentDir: path.resolve(repoRoot, args.experimentDir),
    outDir: path.resolve(repoRoot, args.outDir),
    repoRoot
  });
}

export async function runGenerateExperimentPlotsCommand(argv: string[]): Promise<number> {
  try {
    const args = parseGenerateExperimentPlotsArgs(argv);
    const artifacts = await runGenerateExperimentPlotsFromArgs(args);
    console.log([`Charts: ${artifacts.summary.chartCount}`, `Skipped points: ${artifacts.summary.skippedPointCount}`, `Output: ${path.resolve(args.outDir)}`].join("\n"));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
