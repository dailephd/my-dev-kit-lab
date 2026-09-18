import { createLabExecutionContext } from "../runtime/index.js";
import type { LabExecutionContext } from "../runtime/index.js";
import { runTutorial, type RunTutorialOptions, type TutorialRunResultV1 } from "../tutorial/index.js";

// ---------------------------------------------------------------------------
// v0.4.7 Batch 2 -- tutorial run command owner.
//
// A thin adapter: parse a closed option set, resolve execution roots through
// LabExecutionContext, delegate to runTutorial(), render a summary, map the run
// status to an exit code. No tutorial semantics live here.
// ---------------------------------------------------------------------------

export const TUTORIAL_CLI_USAGE_EXIT_CODE = 2;

export type RunTutorialRunCommandOptions = {
  context?: LabExecutionContext;
  writers?: { stdout: (message: string) => void; stderr: (message: string) => void };
  /**
   * Narrow injection seam so CLI tests can exercise routing, option parsing,
   * output and exit-code mapping without a real browser or a real target.
   */
  runTutorialImpl?: (options: RunTutorialOptions) => Promise<TutorialRunResultV1>;
  launchBrowser?: RunTutorialOptions["launchBrowser"];
  generateRunId?: RunTutorialOptions["generateRunId"];
};

type ParsedRunArgs =
  | { ok: true; scenarioPath: string; targetContractPath: string; outDir?: string; json: boolean }
  | { ok: false; error: string };

const RUN_USAGE =
  "Usage: my-dev-kit-lab tutorial run --scenario <path> --target-contract <path> [--out <dir>] [--json]";

export async function runTutorialRunCommandFromArgs(
  argv: string[],
  options: RunTutorialRunCommandOptions = {}
): Promise<number> {
  const writers = options.writers ?? {
    stdout: (message: string) => console.log(message),
    stderr: (message: string) => console.error(message)
  };

  const parsed = parseRunArgs(argv);
  if (!parsed.ok) {
    writers.stderr(parsed.error);
    return TUTORIAL_CLI_USAGE_EXIT_CODE;
  }

  const context = options.context ?? createLabExecutionContext();
  const execute = options.runTutorialImpl ?? runTutorial;

  const result = await execute({
    scenarioPath: parsed.scenarioPath,
    targetContractPath: parsed.targetContractPath,
    context,
    ...(parsed.outDir !== undefined ? { outDir: parsed.outDir } : {}),
    ...(options.launchBrowser ? { launchBrowser: options.launchBrowser } : {}),
    ...(options.generateRunId ? { generateRunId: options.generateRunId } : {})
  });

  if (parsed.json) {
    writers.stdout(JSON.stringify(result, null, 2));
  } else {
    writers.stdout(renderRunSummary(result));
  }

  return result.status === "passed" ? 0 : 1;
}

/**
 * Concise by design: identity, location, outcome, and the first thing that went
 * wrong. Child-process logs are written to the run's logs directory and are
 * never dumped to the terminal automatically.
 */
function renderRunSummary(result: TutorialRunResultV1): string {
  const lines: string[] = [];
  lines.push(`Scenario ID: ${result.scenarioId ?? "(not loaded)"}`);
  lines.push(`Target ID: ${result.targetId ?? "(not loaded)"}`);
  lines.push(`Run ID: ${result.runId ?? "(not started)"}`);
  lines.push(`Run root: ${result.paths?.runRoot ?? "(not created)"}`);
  lines.push(`Status: ${result.status}`);
  lines.push(`Duration: ${result.durationMs}ms`);

  const stepCounts = summarizeSteps(result);
  if (result.steps.length > 0) {
    lines.push(
      `Steps: ${result.steps.length} (passed ${stepCounts.passed}, failed ${stepCounts.failed}, not-run ${stepCounts.notRun})`
    );
  }

  const failedStep = result.steps.find((step) => step.status === "failed");
  if (failedStep) {
    lines.push(`Failed step: ${failedStep.id}`);
  }
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }
  for (const warning of result.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  for (const cleanupError of result.cleanupErrors) {
    lines.push(`Cleanup error: ${cleanupError}`);
  }
  return lines.join("\n");
}

function summarizeSteps(result: TutorialRunResultV1): {
  passed: number;
  failed: number;
  notRun: number;
} {
  let passed = 0;
  let failed = 0;
  let notRun = 0;
  for (const step of result.steps) {
    if (step.status === "passed") passed += 1;
    else if (step.status === "failed") failed += 1;
    else notRun += 1;
  }
  return { passed, failed, notRun };
}

function parseRunArgs(argv: string[]): ParsedRunArgs {
  let scenarioPath: string | undefined;
  let targetContractPath: string | undefined;
  let outDir: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scenario") {
      const value = argv[++index];
      if (value === undefined) {
        return { ok: false, error: `Missing value for --scenario. ${RUN_USAGE}` };
      }
      scenarioPath = value;
    } else if (arg === "--target-contract") {
      const value = argv[++index];
      if (value === undefined) {
        return { ok: false, error: `Missing value for --target-contract. ${RUN_USAGE}` };
      }
      targetContractPath = value;
    } else if (arg === "--out") {
      const value = argv[++index];
      if (value === undefined) {
        return { ok: false, error: `Missing value for --out. ${RUN_USAGE}` };
      }
      outDir = value;
    } else if (arg === "--json") {
      json = true;
    } else {
      return { ok: false, error: `Unknown argument for "tutorial run": ${arg}. ${RUN_USAGE}` };
    }
  }

  if (scenarioPath === undefined) {
    return { ok: false, error: `Missing required --scenario. ${RUN_USAGE}` };
  }
  if (targetContractPath === undefined) {
    return { ok: false, error: `Missing required --target-contract. ${RUN_USAGE}` };
  }

  return {
    ok: true,
    scenarioPath,
    targetContractPath,
    ...(outDir !== undefined ? { outDir } : {}),
    json
  };
}
