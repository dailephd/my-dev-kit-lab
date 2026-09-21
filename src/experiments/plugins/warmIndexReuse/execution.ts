import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { runMyDevKitRetrievalFromIndex } from "../../../evaluation/runMyDevKitRetrieval.js";
import { runRawFullFileBaseline } from "../../../evaluation/runRawFullFileBaseline.js";
import type {
  EvaluationCase,
  MyDevKitIndexBuildResult,
  MyDevKitRetrievalResult,
  RawFullFileBaselineResult,
} from "../../../evaluation/types.js";
import type { ExperimentRunStatus } from "../../types.js";
import { groupWarmIndexCases, taskOutputSegment } from "./selection.js";
import {
  assertWarmIndexSessionMatchesTarget,
  prepareWarmIndexSession,
  type WarmIndexSession,
} from "./warmIndexSession.js";

export type WarmIndexExecutionError = {
  side: "raw" | "warm";
  code:
    | "raw-baseline-failed"
    | "warm-index-group-inconsistent"
    | "warm-index-setup-failed"
    | "warm-session-target-mismatch"
    | "warm-retrieval-failed";
  message: string;
};

/** In-memory task evidence. Retains full context text; persist only the bounded summary. */
export type WarmIndexTaskExecutionV1 = {
  caseId: string;
  benchmarkProject: string;
  status: ExperimentRunStatus;
  rawStatus: ExperimentRunStatus;
  warmStatus: ExperimentRunStatus;
  rawBaseline?: RawFullFileBaselineResult;
  warmRetrieval?: MyDevKitRetrievalResult;
  /** Warnings reported by the warm retrieval, preserved verbatim. */
  warnings: string[];
  errors: WarmIndexExecutionError[];
};

export type WarmIndexProjectExecutionV1 = {
  benchmarkProject: string;
  projectSegment: string;
  targetRoot: string;
  sourceRoots: readonly string[];
  indexDir: string;
  /** Present only when exactly one index was prepared successfully for this project. */
  session?: WarmIndexSession;
  /** Absent when the group was structurally invalid and no index was attempted. */
  build?: MyDevKitIndexBuildResult;
  tasks: WarmIndexTaskExecutionV1[];
  status: ExperimentRunStatus;
  warnings: string[];
  errors: string[];
};

/**
 * Runs the warm-index lifecycle for already selected cases: one index setup attempt per valid
 * benchmark-project group, then per task one raw baseline and one retrieval against that group's
 * session. Never indexes per task and never retries a failed index.
 */
export async function executeWarmIndexReuse(options: {
  cases: readonly EvaluationCase[];
  kitCommand: string;
  outputRoot: string;
}): Promise<WarmIndexProjectExecutionV1[]> {
  const projects: WarmIndexProjectExecutionV1[] = [];
  for (const group of groupWarmIndexCases(options.cases)) {
    const indexDir = resolveWithinRoot(options.outputRoot, path.join("indexes", group.projectSegment));
    const commandsDir = resolveWithinRoot(options.outputRoot, path.join("commands", group.projectSegment));
    const project: WarmIndexProjectExecutionV1 = {
      benchmarkProject: group.benchmarkProject,
      projectSegment: group.projectSegment,
      targetRoot: group.targetRoot,
      sourceRoots: group.sourceRoots,
      indexDir,
      tasks: [],
      status: "skipped",
      warnings: [],
      errors: [...group.structuralErrors],
    };

    let setupFailure: WarmIndexExecutionError | undefined;
    if (group.structuralErrors.length > 0) {
      setupFailure = {
        side: "warm",
        code: "warm-index-group-inconsistent",
        message: group.structuralErrors.join(" "),
      };
    } else {
      try {
        // requireKit: false keeps the measured index command as evidence when setup fails.
        const prepared = await prepareWarmIndexSession({
          target: { absoluteTargetRoot: group.targetRoot, sourceRoots: [...group.sourceRoots] },
          kitCommand: options.kitCommand,
          indexDir,
          commandsDir: path.join(commandsDir, "index"),
          requireKit: false,
        });
        project.build = prepared.build;
        if (prepared.ok) {
          project.session = prepared.session;
        } else {
          project.warnings.push(...prepared.warnings);
          const message = prepared.warnings.join(" ") || "my-dev-kit index setup failed.";
          project.errors.push(message);
          setupFailure = { side: "warm", code: "warm-index-setup-failed", message };
        }
      } catch (error) {
        const message = errorMessage(error);
        project.errors.push(message);
        setupFailure = { side: "warm", code: "warm-index-setup-failed", message };
      }
    }

    for (const evaluationCase of group.cases) {
      project.tasks.push(
        await executeTask({
          evaluationCase,
          kitCommand: options.kitCommand,
          session: project.session,
          setupFailure,
          commandsDir: path.join(commandsDir, taskOutputSegment(evaluationCase.id)),
        })
      );
    }
    project.status = aggregateStatus(project.tasks.map((task) => task.status));
    projects.push(project);
  }
  return projects;
}

async function executeTask(args: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  session?: WarmIndexSession;
  setupFailure?: WarmIndexExecutionError;
  commandsDir: string;
}): Promise<WarmIndexTaskExecutionV1> {
  const { evaluationCase } = args;
  const errors: WarmIndexExecutionError[] = [];
  const warnings: string[] = [];

  let rawBaseline: RawFullFileBaselineResult | undefined;
  let rawStatus: ExperimentRunStatus;
  try {
    rawBaseline = await runRawFullFileBaseline(evaluationCase);
    rawStatus = "completed";
  } catch (error) {
    rawStatus = "failed";
    errors.push({ side: "raw", code: "raw-baseline-failed", message: errorMessage(error) });
  }

  let warmRetrieval: MyDevKitRetrievalResult | undefined;
  let warmStatus: ExperimentRunStatus = "failed";
  if (!args.session) {
    errors.push(args.setupFailure ?? { side: "warm", code: "warm-index-setup-failed", message: "No warm index session." });
  } else {
    try {
      assertWarmIndexSessionMatchesTarget(args.session, evaluationCase);
    } catch (error) {
      errors.push({ side: "warm", code: "warm-session-target-mismatch", message: errorMessage(error) });
    }
    if (!errors.some((error) => error.side === "warm")) {
      try {
        // requireKit: false retains subordinate command evidence; a skipped result caused by a
        // failed command is classified as failed below rather than as an honest skip.
        warmRetrieval = await runMyDevKitRetrievalFromIndex({
          evaluationCase,
          kitCommand: args.kitCommand,
          indexDir: args.session.indexDir,
          commandsDir: args.commandsDir,
          requireKit: false,
        });
        warnings.push(...warmRetrieval.warnings);
        warmStatus = classifyWarmRetrieval(warmRetrieval);
        if (warmStatus === "failed") {
          errors.push({
            side: "warm",
            code: "warm-retrieval-failed",
            message: warmRetrieval.warnings.join(" ") || "my-dev-kit retrieval command failed.",
          });
        }
      } catch (error) {
        errors.push({ side: "warm", code: "warm-retrieval-failed", message: errorMessage(error) });
      }
    }
  }

  return {
    caseId: evaluationCase.id,
    benchmarkProject: evaluationCase.benchmarkProject,
    status: aggregateStatus([rawStatus, warmStatus]),
    rawStatus,
    warmStatus,
    rawBaseline,
    warmRetrieval,
    warnings,
    errors,
  };
}

function classifyWarmRetrieval(result: MyDevKitRetrievalResult): ExperimentRunStatus {
  if (!result.skipped) return "completed";
  return result.commands.some((command) => !command.ok) ? "failed" : "skipped";
}

/** Same aggregation rule as the generic per-case summary: uniform statuses win, mixed is partial. */
export function aggregateStatus(statuses: readonly ExperimentRunStatus[]): ExperimentRunStatus {
  if (statuses.length === 0) return "skipped";
  for (const status of ["completed", "skipped", "failed"] as const) {
    if (statuses.every((value) => value === status)) return status;
  }
  return "partial";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
