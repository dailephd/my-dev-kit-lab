import path from "node:path";
import { writeExperimentGalleryManifest } from "../gallery/index.js";
import { looksLikeUrl } from "../gallery/galleryPathSafety.js";

export type ParsedBuildGalleryArgs = {
  reportDir?: string;
  plotsDir?: string;
  visualizationsDir?: string;
  experimentDir?: string;
  /** Repeatable explicit artifact roots/manifests (v0.9.3). */
  sources?: string[];
  outDir: string;
};

export function parseBuildGalleryArgs(argv: string[]): ParsedBuildGalleryArgs {
  let outDir = "";
  let reportDir: string | undefined;
  let plotsDir: string | undefined;
  let visualizationsDir: string | undefined;
  let experimentDir: string | undefined;
  const sources: string[] = [];
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
    } else if (arg === "--source") {
      const value = argv[index + 1];
      if (value === undefined || value.trim() === "" || value.startsWith("--")) {
        throw new Error("--source requires a non-empty artifact root or supported manifest path.");
      }
      if (looksLikeUrl(value)) throw new Error(`Gallery source ${value}: URLs are not supported; supply a local path.`);
      sources.push(value);
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    }
  }
  if (!outDir) throw new Error("Usage: --out <dir> [--report <dir>] [--plots <dir>] [--visualizations <dir>] [--experiment <dir>] [--source <artifact-root-or-manifest>]...");
  return { outDir, reportDir, plotsDir, visualizationsDir, experimentDir, ...(sources.length > 0 ? { sources } : {}) };
}

export async function runBuildGalleryFromArgs(args: ParsedBuildGalleryArgs, repoRoot = process.cwd()) {
  return writeExperimentGalleryManifest({
    outDir: path.resolve(repoRoot, args.outDir),
    reportDir: args.reportDir ? path.resolve(repoRoot, args.reportDir) : undefined,
    plotsDir: args.plotsDir ? path.resolve(repoRoot, args.plotsDir) : undefined,
    visualizationsDir: args.visualizationsDir ? path.resolve(repoRoot, args.visualizationsDir) : undefined,
    experimentDir: args.experimentDir ? path.resolve(repoRoot, args.experimentDir) : undefined,
    sources: args.sources?.map((source) => path.resolve(repoRoot, source))
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
