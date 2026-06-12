import path from "node:path";
import { writeExperimentGalleryManifest } from "../gallery/index.js";

export type ParsedBuildGalleryArgs = {
  reportDir?: string;
  plotsDir?: string;
  visualizationsDir?: string;
  experimentDir?: string;
  outDir: string;
};

export function parseBuildGalleryArgs(argv: string[]): ParsedBuildGalleryArgs {
  let outDir = "";
  let reportDir: string | undefined;
  let plotsDir: string | undefined;
  let visualizationsDir: string | undefined;
  let experimentDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") {
      reportDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--plots") {
      plotsDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--visualizations") {
      visualizationsDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--experiment") {
      experimentDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    }
  }
  if (!outDir) throw new Error("Usage: --out <dir> [--report <dir>] [--plots <dir>] [--visualizations <dir>] [--experiment <dir>]");
  return { outDir, reportDir, plotsDir, visualizationsDir, experimentDir };
}

export async function runBuildGalleryFromArgs(args: ParsedBuildGalleryArgs, repoRoot = process.cwd()) {
  return writeExperimentGalleryManifest({
    outDir: path.resolve(repoRoot, args.outDir),
    reportDir: args.reportDir ? path.resolve(repoRoot, args.reportDir) : undefined,
    plotsDir: args.plotsDir ? path.resolve(repoRoot, args.plotsDir) : undefined,
    visualizationsDir: args.visualizationsDir ? path.resolve(repoRoot, args.visualizationsDir) : undefined,
    experimentDir: args.experimentDir ? path.resolve(repoRoot, args.experimentDir) : undefined
  });
}

export async function runBuildGalleryCommand(argv: string[]): Promise<number> {
  try {
    const args = parseBuildGalleryArgs(argv);
    const gallery = await runBuildGalleryFromArgs(args);
    console.log([`Items: ${gallery.manifest.items.length}`, `Manifest: ${gallery.manifestPath}`, `Index: ${gallery.indexPath}`].join("\n"));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
