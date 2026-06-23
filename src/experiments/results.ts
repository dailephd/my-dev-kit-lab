import type {
  ExperimentCase,
  ExperimentFailure,
  ExperimentRun,
  ExperimentRunStatus,
  ExperimentSummary,
  ExperimentWarning,
} from "./types.js";

export const experimentRunStatuses = [
  "completed",
  "partial",
  "failed",
  "skipped",
] as const satisfies readonly ExperimentRunStatus[];

export function summarizeExperimentRun(run: ExperimentRun): ExperimentSummary {
  const caseStatuses = run.cases.map(statusForCase);
  const completedCases = caseStatuses.filter((status) => status === "completed").length;
  const partialCases = caseStatuses.filter((status) => status === "partial").length;
  const failedCases = caseStatuses.filter((status) => status === "failed").length;
  const skippedCases = caseStatuses.filter((status) => status === "skipped").length;

  return {
    status: run.status,
    totalCases: run.cases.length,
    completedCases,
    partialCases,
    failedCases,
    skippedCases,
    metrics: [...run.metrics],
    warnings: collectWarnings(run),
    failures: collectFailures(run),
  };
}

function statusForCase(experimentCase: ExperimentCase): ExperimentRunStatus {
  if (experimentCase.outcomes.length === 0) return "skipped";
  const statuses = experimentCase.outcomes.map((outcome) => outcome.status);
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.every((status) => status === "failed")) return "failed";
  return "partial";
}

function collectWarnings(run: ExperimentRun): ExperimentWarning[] {
  return [
    ...run.warnings,
    ...run.cases.flatMap((experimentCase) =>
      experimentCase.outcomes.flatMap((outcome) => outcome.warnings)
    ),
  ];
}

function collectFailures(run: ExperimentRun): ExperimentFailure[] {
  return [
    ...run.failures,
    ...run.cases.flatMap((experimentCase) =>
      experimentCase.outcomes.flatMap((outcome) => outcome.failures)
    ),
  ];
}
