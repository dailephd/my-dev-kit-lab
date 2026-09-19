import { createLabExecutionContext } from "../runtime/index.js";
import type { LabExecutionContext } from "../runtime/index.js";
import {
  describeTargetIdMismatch,
  loadTutorialScenario,
  loadTutorialTargetContract,
  tutorialTargetIdsMatch
} from "../tutorial/index.js";

// ---------------------------------------------------------------------------
// v0.4.7 Batch 2 -- tutorial contract validation command owner.
//
// Read-only by construction: it loads and validates contracts and nothing else.
// No run directory is created, no prepare command runs, no process starts and
// no browser launches, so this route is safe to run anywhere and needs neither
// Chromium nor a prepared target.
// ---------------------------------------------------------------------------

export const TUTORIAL_CLI_USAGE_EXIT_CODE = 2;

export type RunTutorialValidateCommandOptions = {
  context?: LabExecutionContext;
  writers?: { stdout: (message: string) => void; stderr: (message: string) => void };
};

type ParsedValidateArgs =
  | { ok: true; scenarioPath: string; targetContractPath?: string; json: boolean }
  | { ok: false; error: string };

type ValidateReport = {
  status: "valid" | "invalid";
  scenarioPath: string;
  scenarioId?: string;
  scenarioTitle?: string;
  targetIdDeclared?: string;
  stepCount?: number;
  targetContractPath?: string;
  targetContractId?: string;
  processCount?: number;
  applicationUrl?: string;
  targetIdMatches?: boolean;
  errors: string[];
};

export async function runTutorialValidateCommandFromArgs(
  argv: string[],
  options: RunTutorialValidateCommandOptions = {}
): Promise<number> {
  const writers = options.writers ?? {
    stdout: (message: string) => console.log(message),
    stderr: (message: string) => console.error(message)
  };

  const parsed = parseValidateArgs(argv);
  if (!parsed.ok) {
    writers.stderr(parsed.error);
    return TUTORIAL_CLI_USAGE_EXIT_CODE;
  }

  const context = options.context ?? createLabExecutionContext();
  const report: ValidateReport = { status: "valid", scenarioPath: parsed.scenarioPath, errors: [] };

  const loadedScenario = await loadTutorialScenario(context.invocationCwd, parsed.scenarioPath);
  if (!loadedScenario.ok) {
    report.status = "invalid";
    report.errors.push(...loadedScenario.errors);
  } else {
    report.scenarioPath = loadedScenario.value.scenarioPath;
    report.scenarioId = loadedScenario.value.scenario.id;
    report.scenarioTitle = loadedScenario.value.scenario.title;
    report.targetIdDeclared = loadedScenario.value.scenario.targetId;
    report.stepCount = loadedScenario.value.scenario.steps.length;
  }

  if (parsed.targetContractPath !== undefined) {
    const loadedTarget = await loadTutorialTargetContract(context.invocationCwd, parsed.targetContractPath);
    if (!loadedTarget.ok) {
      report.status = "invalid";
      report.targetContractPath = parsed.targetContractPath;
      report.errors.push(...loadedTarget.errors);
    } else {
      report.targetContractPath = loadedTarget.value.targetContractPath;
      report.targetContractId = loadedTarget.value.targetContract.id;
      report.processCount = loadedTarget.value.targetContract.processes.length;
      report.applicationUrl = loadedTarget.value.targetContract.applicationUrl;

      if (loadedScenario.ok) {
        const matches = tutorialTargetIdsMatch(
          loadedScenario.value.scenario.targetId,
          loadedTarget.value.targetContract.id
        );
        report.targetIdMatches = matches;
        if (!matches) {
          report.status = "invalid";
          report.errors.push(
            describeTargetIdMismatch(
              loadedScenario.value.scenario.targetId,
              loadedTarget.value.targetContract.id
            )
          );
        }
      }
    }
  }

  if (parsed.json) {
    writers.stdout(JSON.stringify(report, null, 2));
  } else {
    writers.stdout(renderValidateSummary(report));
  }

  return report.status === "valid" ? 0 : 1;
}

function renderValidateSummary(report: ValidateReport): string {
  const lines: string[] = [];
  lines.push(`Scenario: ${report.scenarioPath}`);
  if (report.scenarioId) {
    lines.push(`Scenario ID: ${report.scenarioId}`);
    lines.push(`Title: ${report.scenarioTitle ?? ""}`);
    lines.push(`Declared target ID: ${report.targetIdDeclared ?? ""}`);
    lines.push(`Steps: ${report.stepCount ?? 0}`);
  }
  if (report.targetContractPath) {
    lines.push(`Target contract: ${report.targetContractPath}`);
  }
  if (report.targetContractId) {
    lines.push(`Target contract ID: ${report.targetContractId}`);
    lines.push(`Managed processes: ${report.processCount ?? 0}`);
    lines.push(`Application URL: ${report.applicationUrl ?? ""}`);
  }
  lines.push(`Status: ${report.status}`);
  if (report.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const error of report.errors) {
      lines.push(`  - ${error}`);
    }
  }
  return lines.join("\n");
}

function parseValidateArgs(argv: string[]): ParsedValidateArgs {
  let scenarioPath: string | undefined;
  let targetContractPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scenario") {
      const value = argv[++index];
      if (value === undefined) {
        return { ok: false, error: "Missing value for --scenario. Expected a path to a tutorial scenario JSON file." };
      }
      scenarioPath = value;
    } else if (arg === "--target-contract") {
      const value = argv[++index];
      if (value === undefined) {
        return {
          ok: false,
          error: "Missing value for --target-contract. Expected a path to a tutorial target contract JSON file."
        };
      }
      targetContractPath = value;
    } else if (arg === "--json") {
      json = true;
    } else {
      return {
        ok: false,
        error: `Unknown argument for "tutorial validate": ${arg}. Usage: my-dev-kit-lab tutorial validate --scenario <path> [--target-contract <path>] [--json]`
      };
    }
  }

  if (scenarioPath === undefined) {
    return {
      ok: false,
      error: "Missing required --scenario. Usage: my-dev-kit-lab tutorial validate --scenario <path> [--target-contract <path>] [--json]"
    };
  }

  return {
    ok: true,
    scenarioPath,
    ...(targetContractPath !== undefined ? { targetContractPath } : {}),
    json
  };
}
