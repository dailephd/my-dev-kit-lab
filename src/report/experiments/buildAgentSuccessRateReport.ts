import type { ExperimentRun } from "../../experiments/index.js";
import type { AgentSuccessMeasurementTotalV1, AgentSuccessPairedDifferenceV1 } from "../../experiments/plugins/agentSuccessRate/analysisTypes.js";
import { attemptEvidenceOf } from "../../experiments/plugins/agentSuccessRate/attemptEvidence.js";
import type { AgentSuccessTreatmentEvidenceV1 } from "../../experiments/plugins/agentSuccessRate/executionTypes.js";
import {
  AGENT_SUCCESS_RATE_PLUGIN_ID,
  AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE,
  AGENT_SUCCESS_RATE_TREATMENT_IDS
} from "../../experiments/plugins/agentSuccessRate/metadata.js";
import type { AgentSuccessRateRun } from "../../experiments/plugins/agentSuccessRate/plugin.js";
import type { AgentSuccessMetricV1 } from "../../experiments/plugins/agentSuccessRate/types.js";
import {
  AGENT_SUCCESS_RATE_REPORT_SCHEMA_VERSION,
  type AgentSuccessRateReportV1,
  type AgentSuccessReportAttemptV1,
  type AgentSuccessReportCaseTreatmentV1,
  type AgentSuccessReportMeasurementTotalV1,
  type AgentSuccessReportMetricV1,
  type AgentSuccessReportPairedDifferenceV1
} from "./agentSuccessRateReportModel.js";

export const AGENT_SUCCESS_RATE_DETERMINISTIC_STATEMENT =
  "The fixture validates the patch evaluation pipeline and benchmark corpus. It does not measure a coding agent or the effect of context selection.";
export const AGENT_SUCCESS_RATE_REAL_AGENT_STATEMENT =
  "The observed outcomes are a descriptive matched comparison of two source-context treatments under the selected provider.";

const MAX_TEXT = 300;
const MAX_CHANGED_FILES = 20;

const bound = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_TEXT ? `${normalized.slice(0, MAX_TEXT)}...` : normalized;
};

/** Copies a plugin metric. Availability, value and reason are carried through untouched. */
function copyMetric(metric: AgentSuccessMetricV1 | undefined, fallbackUnit: AgentSuccessReportMetricV1["unit"] = "count"): AgentSuccessReportMetricV1 {
  if (!metric) return { availability: "unavailable", value: null, unit: fallbackUnit, reason: "the measurement was not recorded." };
  return { availability: metric.availability, value: metric.value, unit: metric.unit, reason: metric.reason === null ? null : bound(metric.reason) };
}

function copyTotal(total: AgentSuccessMeasurementTotalV1): AgentSuccessReportMeasurementTotalV1 {
  return {
    basis: total.basis,
    contributingCaseCount: total.contributingCaseCount,
    availableCaseCount: total.availableCaseCount,
    unavailableCaseCount: total.unavailableCaseCount,
    sumOfAvailable: total.sumOfAvailable,
    total: copyMetric(total.total)
  };
}

function copyDifference(entry: AgentSuccessPairedDifferenceV1): AgentSuccessReportPairedDifferenceV1 {
  return {
    id: entry.id,
    basis: entry.basis,
    matchedCaseIds: [...entry.matchedCaseIds],
    rawFullFileMean: copyMetric(entry.rawFullFileMean),
    contextPackMean: copyMetric(entry.contextPackMean),
    meanDifference: copyMetric(entry.meanDifference)
  };
}

/**
 * A relative, forward-slash artifact reference with no traversal, drive, scheme or absolute form. Anything else is
 * withheld rather than rendered, so a report can never point outside the experiment output directory.
 */
export function safeAgentSuccessArtifactReference(reference: string | null | undefined): string | null {
  if (typeof reference !== "string" || reference.length === 0 || reference.length > 400) return null;
  if (reference.includes("\\") || reference.includes("\0") || reference.startsWith("/") || /^[A-Za-z]:/.test(reference) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)) return null;
  const segments = reference.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return reference;
}

function patchOutcome(evidence: AgentSuccessTreatmentEvidenceV1): string {
  return evidence.patch.outcome ?? (evidence.patch.attempted ? "unrecorded" : "not-attempted");
}

function verificationAvailability(evidence: AgentSuccessTreatmentEvidenceV1): "available" | "unavailable" {
  return evidence.postEditVerification !== null ? "available" : "unavailable";
}

export function buildAgentSuccessRateReport(run: ExperimentRun): AgentSuccessRateReportV1 | null {
  if (run.pluginId !== AGENT_SUCCESS_RATE_PLUGIN_ID) return null;

  const candidate = run as Partial<AgentSuccessRateRun>;
  const analysis = candidate.analysis;
  const execution = candidate.caseExecutionEvidence;
  if (!analysis || !execution) {
    // A run that failed before analysis exists still gets the generic failure report.
    if (run.status === "failed") return null;
    throw new Error("Invalid agent-success-rate report source: execution evidence and analysis are required.");
  }
  const inconsistent =
    analysis.cases.length !== execution.length ||
    analysis.cases.some(
      (entry, index) =>
        entry.caseId !== execution[index]!.caseId ||
        entry.treatments.length !== AGENT_SUCCESS_RATE_TREATMENT_IDS.length ||
        entry.treatments.some((treatment, position) => treatment.treatmentId !== AGENT_SUCCESS_RATE_TREATMENT_IDS[position])
    );
  if (inconsistent) {
    throw new Error("Invalid agent-success-rate report source: execution evidence and analysis are inconsistent.");
  }

  const realMode = analysis.executionMode === AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE;
  const metadata = (run.metadata ?? {}) as Record<string, unknown>;
  const repairAttempts = realMode && typeof metadata.repairAttempts === "number" ? metadata.repairAttempts : realMode ? 0 : null;
  const timeoutMs = realMode && typeof metadata.timeoutMs === "number" ? metadata.timeoutMs : null;

  const cases = analysis.cases.map((entry, caseIndex) => {
    const evidence = execution[caseIndex]!;
    return {
      caseId: entry.caseId,
      caseName: bound(evidence.caseName),
      benchmarkProject: entry.benchmarkProject,
      taskLocality: evidence.taskLocality,
      treatments: entry.treatments.map((treatment, treatmentIndex): AgentSuccessReportCaseTreatmentV1 => {
        const treatmentEvidence = evidence.treatments[treatmentIndex]!;
        const repair = treatment.repair;
        const changed = treatmentEvidence.change?.changedFiles.map((file) => file.relativePath).filter((file) => safeAgentSuccessArtifactReference(file) !== null) ?? null;
        const errors = attemptEvidenceOf(treatmentEvidence).flatMap((attempt, index) =>
          attempt.errors.slice(0, 10).map((error) => ({ attemptNumber: index + 1, code: bound(error.code), message: bound(error.message) }))
        );
        return {
          treatmentId: treatment.treatmentId,
          executionStatus: treatment.executionStatus,
          evidenceAvailability: treatment.evidenceAvailability,
          initialTaskSuccess: copyMetric(repair ? repair.initialAttemptTaskSuccess : treatment.metrics.taskSuccess, "boolean"),
          finalTaskSuccess: copyMetric(treatment.metrics.taskSuccess, "boolean"),
          attemptCount: repair ? repair.attemptCount : 1,
          repairAttemptCount: repair ? repair.repairAttemptCount : 0,
          repairSucceeded: repair
            ? copyMetric(repair.repairSucceeded, "boolean")
            : { availability: "not-applicable", value: null, unit: "boolean", reason: "deterministic-fixture mode has no repair." },
          taskCheckPassRate: copyMetric(treatment.metrics.taskCheckPassRate, "ratio"),
          regressionCheckPassRate: copyMetric(treatment.metrics.regressionCheckPassRate, "ratio"),
          requiredFactCoverage: copyMetric(treatment.metrics.requiredFactCoverage, "ratio"),
          expectedEditCoverage: copyMetric(treatment.metrics.expectedEditCoverage, "ratio"),
          editScopePrecision: copyMetric(treatment.metrics.editScopePrecision, "ratio"),
          unexpectedChangedFiles: copyMetric(treatment.metrics.unexpectedChangedFileCount, "count"),
          protectedMutations: copyMetric(treatment.metrics.protectedMutationCount, "count"),
          changedFileCount: copyMetric(treatment.metrics.changedFileCount, "count"),
          changedFiles:
            changed === null || treatment.metrics.changedFileCount.availability !== "available"
              ? null
              : { items: changed.slice(0, MAX_CHANGED_FILES), totalCount: changed.length, omittedCount: Math.max(0, changed.length - MAX_CHANGED_FILES) },
          totalChurn: copyMetric(treatment.metrics.totalChurn, "lines"),
          relativeChurn: copyMetric(treatment.metrics.relativeChurn, "ratio"),
          finalAttemptProviderDurationMs: copyMetric(treatment.metrics.agentDurationMs, "ms"),
          finalAttemptProviderTokens: copyMetric(treatment.metrics.agentTotalTokens, "tokens"),
          totalProviderDurationMs: repair ? copyMetric(repair.totalProviderDurationMs, "ms") : null,
          totalProviderTokens: repair ? copyMetric(repair.totalProviderTokens, "tokens") : null,
          errors: errors.slice(0, 20)
        };
      })
    };
  });

  const treatments = analysis.aggregates.map((aggregate) => {
    const repair = aggregate.repair;
    return {
      treatmentId: aggregate.treatmentId,
      evaluableCases: repair ? repair.finalEvaluableCount : aggregate.evaluableCaseCount,
      initialSuccessfulCases: repair ? repair.initialAttemptSuccessfulCount : aggregate.successfulCaseCount,
      initialSuccessRate: copyMetric(aggregate.initialAttemptSuccessRate, "ratio"),
      finalSuccessfulCases: repair ? repair.finalSuccessfulCount : aggregate.successfulCaseCount,
      finalSuccessRate: copyMetric(repair ? repair.finalTaskSuccessRate : aggregate.taskSuccessRate, "ratio"),
      repair: repair
        ? {
            repairEligibleCases: repair.repairEligibleCaseCount,
            repairAttemptedCases: repair.repairAttemptedCaseCount,
            repairAttempts: repair.totalRepairAttemptCount,
            repairedCases: repair.repairedCaseCount,
            repairSuccessRate: copyMetric(repair.repairSuccessRate, "ratio"),
            meanAttemptsPerEvaluableCase: copyMetric(repair.meanAttemptsPerEvaluableCase, "count"),
            providerDurationMs: repair.providerDurationMs.map(copyTotal),
            providerTokens: repair.providerTokens.map(copyTotal)
          }
        : null
    };
  });

  const repairHistory = realMode
    ? analysis.cases.flatMap((entry, caseIndex) =>
        entry.treatments.flatMap((treatment, treatmentIndex) => {
          const repair = treatment.repair;
          const evidence = execution[caseIndex]!.treatments[treatmentIndex]!;
          if (!repair || !evidence.attempts) return [];
          return [
            {
              caseId: entry.caseId,
              treatmentId: treatment.treatmentId,
              attempts: repair.attempts.map((attempt, index): AgentSuccessReportAttemptV1 => {
                const attemptEvidence = evidence.attempts![index]!;
                const inner = attemptEvidence.evidence;
                return {
                  attemptNumber: attempt.attemptNumber,
                  providerStatus: attempt.providerStatus,
                  patchOutcome: patchOutcome(inner),
                  verificationAvailability: verificationAvailability(inner),
                  taskSuccess: copyMetric(attempt.metrics.taskSuccess, "boolean"),
                  failureCategory: attempt.failureCategory,
                  repairEligible: attempt.repairEligible,
                  providerDurationMs: copyMetric(attempt.metrics.agentDurationMs, "ms"),
                  providerTokens: copyMetric(attempt.metrics.agentTotalTokens, "tokens"),
                  tokenAvailability: attempt.metrics.agentTotalTokens.availability === "available" ? "available" : "unavailable",
                  proposedPatchPath: safeAgentSuccessArtifactReference(inner.proposedPatchPath),
                  appliedPatchPath: safeAgentSuccessArtifactReference(inner.appliedPatchPath),
                  agentArtifactDirectory: safeAgentSuccessArtifactReference(inner.realAgent?.agentArtifactDirectory ?? null)
                };
              })
            }
          ];
        })
      )
    : [];

  const outcomeAvailability = analysis.cases.flatMap((entry) => entry.treatments.map((treatment) => treatment.metrics.taskSuccess.availability));
  const evaluable = outcomeAvailability.filter((availability) => availability === "available").length;
  const total = outcomeAvailability.length;
  const unavailable = total - evaluable;
  const notes: string[] = [];
  if (unavailable > 0) notes.push(`${unavailable} of ${total} treatment outcome(s) have no determinate task-success verdict; they are excluded from rates and never counted as failures.`);
  if (realMode && analysis.comparison && analysis.comparison.incompleteCases.length > 0) {
    notes.push(`${analysis.comparison.incompleteCases.length} case(s) are excluded from matched comparisons because a treatment verdict is unavailable.`);
  }

  const comparison = analysis.comparison
    ? (() => {
        const repairComparison = analysis.repairComparison;
        const finalMatched = analysis.comparison.matchedCaseIds.length;
        const evaluableComparison = repairComparison ? repairComparison.interpretation.evaluable : finalMatched > 0;
        const finalPairs = analysis.comparison.pairedOutcomes;
        const differs = finalPairs.onlyRawFullFileSucceeded + finalPairs.onlyContextPackSucceeded > 0;
        return {
          comparisonEvaluable: evaluableComparison,
          observedOutcomeDifference: repairComparison ? repairComparison.interpretation.observedOutcomeDifference : !evaluableComparison ? ("not-evaluable" as const) : differs ? ("observed" as const) : ("not-observed" as const),
          statisticalEffect: "not-assessed" as const,
          finalMatchedCaseIds: [...analysis.comparison.matchedCaseIds],
          finalIncompleteCases: analysis.comparison.incompleteCases.map((entry) => ({ caseId: entry.caseId, unavailableTreatmentIds: [...entry.unavailableTreatmentIds] })),
          finalPairedOutcomes: { ...finalPairs },
          initialMatchedCaseIds: repairComparison ? [...repairComparison.initialAttempt.matchedCaseIds] : null,
          initialIncompleteCases: repairComparison ? repairComparison.initialAttempt.incompleteCases.map((entry) => ({ caseId: entry.caseId, unavailableTreatmentIds: [...entry.unavailableTreatmentIds] })) : null,
          initialPairedOutcomes: repairComparison ? { ...repairComparison.initialAttempt.pairedOutcomes } : null,
          pairedDifferences: repairComparison ? repairComparison.pairedDifferences.map(copyDifference) : []
        };
      })()
    : null;

  const overall: AgentSuccessRateReportV1["resultAvailability"]["overall"] = total === 0 || evaluable === 0 ? "unavailable" : unavailable === 0 ? "complete" : "partial";

  return {
    schemaVersion: AGENT_SUCCESS_RATE_REPORT_SCHEMA_VERSION,
    identity: {
      runId: run.runId,
      pluginId: run.pluginId,
      pluginSchemaVersion: "1.0.0",
      runStatus: run.status,
      executionMode: analysis.executionMode,
      providerId: typeof metadata.providerId === "string" ? metadata.providerId : null,
      timeoutMs,
      repairAttempts,
      maxAttemptsPerTreatment: repairAttempts === null ? 1 : 1 + repairAttempts,
      treatmentOrder: [...analysis.treatmentOrder],
      caseCount: analysis.caseCount,
      treatmentOutcomeCount: total
    },
    scientificStatement: realMode ? AGENT_SUCCESS_RATE_REAL_AGENT_STATEMENT : AGENT_SUCCESS_RATE_DETERMINISTIC_STATEMENT,
    limitations: [
      ...analysis.limitations.map(bound),
      ...(realMode
        ? [
            "The corpus is finite and a single run supports no generalization.",
            "Provider output can vary between runs, and provider usage or availability can differ between treatments.",
            "No causal or statistical-significance claim is made; no weighted composite score and no automatic best treatment exist."
          ]
        : [])
    ],
    resultAvailability: { overall, evaluableTreatmentOutcomes: evaluable, unavailableTreatmentOutcomes: unavailable, totalTreatmentOutcomes: total, notes },
    treatments,
    comparison,
    cases,
    repairHistory,
    warnings: run.warnings.map((warning) => ({ code: bound(warning.code), message: bound(warning.message) })),
    artifacts: run.artifacts.map((artifact) => ({
      id: bound(artifact.id),
      label: bound(artifact.label),
      path: safeAgentSuccessArtifactReference(artifact.path),
      caseId: artifact.caseId ?? null,
      variantId: artifact.variantId ?? null
    }))
  };
}
