import path from "node:path";
import { runVisualizationDemos } from "../visualizationDemos/index.js";

export type ParsedRunVisualizationDemosArgs = {
  projectPath: string;
  kitCommand: string;
  outDir: string;
  query?: string;
  nodeId?: string;
  requireAll?: boolean;
  timeoutMs?: number;
};

export function parseRunVisualizationDemosArgs(argv: string[]): ParsedRunVisualizationDemosArgs {
  let projectPath = "";
  let kitCommand = "";
  let outDir = "";
  let query: string | undefined;
  let nodeId: string | undefined;
  let requireAll = false;
  let timeoutMs: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project") {
      projectPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--kit-command") {
      kitCommand = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--query") {
      query = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--node") {
      nodeId = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--require-all") {
      requireAll = true;
    } else if (arg === "--timeout-ms") {
      timeoutMs = Number(argv[index + 1]);
      index += 1;
    }
  }
  if (!projectPath || !kitCommand || !outDir) throw new Error("Usage: --project <dir> --kit-command <command> --out <dir>");
  return { projectPath, kitCommand, outDir, query, nodeId, requireAll, timeoutMs };
}

export async function runVisualizationDemosFromArgs(args: ParsedRunVisualizationDemosArgs, repoRoot = process.cwd()) {
  return runVisualizationDemos({
    projectPath: path.resolve(repoRoot, args.projectPath),
    kitCommand: args.kitCommand,
    outDir: path.resolve(repoRoot, args.outDir),
    query: args.query,
    nodeId: args.nodeId,
    requireAll: args.requireAll,
    timeoutMs: args.timeoutMs
  });
}

export async function runVisualizationDemosCommand(argv: string[]): Promise<number> {
  try {
    const args = parseRunVisualizationDemosArgs(argv);
    const artifacts = await runVisualizationDemosFromArgs(args);
    console.log([`Runs: ${artifacts.summary.totalRuns}`, `Completed: ${artifacts.summary.completedRuns}`, `Failed: ${artifacts.summary.failedRuns}`, `Output: ${path.resolve(args.outDir)}`].join("\n"));
    return args.requireAll && artifacts.summary.failedRuns > 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
