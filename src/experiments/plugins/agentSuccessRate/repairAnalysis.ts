import type {
  AgentSuccessCaseAnalysisV1,
  AgentSuccessMeasurementBasis,
  AgentSuccessMeasurementTotalV1,
  AgentSuccessPairedDifferenceId,
  AgentSuccessPairedDifferenceV1,
  AgentSuccessPairedOutcomesV1,
  AgentSuccessRepairAggregateV1,
  AgentSuccessRepairComparisonV1,
  AgentSuccessRepairAnalysisV1,
  AgentSuccessTreatmentAnalysisV1
} from "./analysisTypes.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS } from "./metadata.js";
import { availableMetric, notApplicableMetric, unavailableMetric } from "./metrics.js";
import type { AgentSuccessMetricUnit, AgentSuccessMetricV1 } from "./types.js";

/**
 * Repair-aware aggregation over already-calculated per-case analysis. It never reads execution evidence, never rescored
 * anything and never converts an unavailable measurement to zero: every total states how many cases contributed.
 */

const numberOf = (metric: AgentSuccessMetricV1 | undefined): number | null =>
  metric !== undefined && metric.availability === "available" && typeof metric.value === "number" ? metric.value : null;

const booleanOf = (metric: AgentSuccessMetricV1 | undefined): boolean | null =>
  metric !== undefined && metric.availability === "available" && typeof metric.value === "boolean" ? metric.value : null;

function repairOf(entry: AgentSuccessTreatmentAnalysisV1): AgentSuccessRepairAnalysisV1 | undefined {
  return entry.repair;
}

function measurementTotal(
  id: string,
  unit: AgentSuccessMetricUnit,
  basis: AgentSuccessMeasurementBasis,
  noun: string,
  samples: ReadonlyArray<{ contributes: boolean; value: number | null }>
): AgentSuccessMeasurementTotalV1 {
  const contributing = samples.filter((sample) => sample.contributes);
  const available = contributing.filter((sample) => sample.value !== null);
  const unavailableCount = contributing.length - available.length;
  const sum = available.reduce((total, sample) => total + (sample.value as number), 0);
  const total =
    contributing.length === 0
      ? unavailableMetric(id, unit, `no provider attempt ran, so no ${noun} exists.`)
      : unavailableCount > 0
        ? unavailableMetric(id, unit, `${unavailableCount} of ${contributing.length} contributing case(s) have no ${noun}; a complete total is not available.`)
        : availableMetric(id, sum, unit);
  return {
    basis,
    contributingCaseCount: contributing.length,
    availableCaseCount: available.length,
    unavailableCaseCount: unavailableCount,
    sumOfAvailable: available.length > 0 ? sum : null,
    total
  };
}

/** Per-treatment repair aggregate over the cases of ONE treatment. Cases without a repair block are ignored upstream. */
export function aggregateRepair(entries: readonly AgentSuccessTreatmentAnalysisV1[]): AgentSuccessRepairAggregateV1 | undefined {
  const repairs = entries.map(repairOf).filter((repair): repair is AgentSuccessRepairAnalysisV1 => repair !== undefined);
  if (repairs.length === 0) return undefined;

  const initialEvaluable = repairs.filter((repair) => booleanOf(repair.initialAttemptTaskSuccess) !== null);
  const initialSuccessful = initialEvaluable.filter((repair) => booleanOf(repair.initialAttemptTaskSuccess) === true);
  const finalEvaluable = repairs.filter((repair) => booleanOf(repair.finalTaskSuccess) !== null);
  const finalSuccessful = finalEvaluable.filter((repair) => booleanOf(repair.finalTaskSuccess) === true);
  const attempted = repairs.filter((repair) => repair.repairAttemptCount > 0);
  const attemptedEvaluable = attempted.filter((repair) => booleanOf(repair.repairSucceeded) !== null);
  const repaired = attemptedEvaluable.filter((repair) => booleanOf(repair.repairSucceeded) === true);

  const rate = (id: string, numerator: number, denominator: number, reason: string): AgentSuccessMetricV1 =>
    denominator === 0 ? unavailableMetric(id, "ratio", reason) : availableMetric(id, numerator / denominator, "ratio");

  const invoked = (repair: AgentSuccessRepairAnalysisV1): boolean => repair.providerAttemptCount > 0;
  const durationSamples = (pick: (repair: AgentSuccessRepairAnalysisV1) => AgentSuccessMetricV1): Array<{ contributes: boolean; value: number | null }> =>
    repairs.map((repair) => ({ contributes: invoked(repair), value: numberOf(pick(repair)) }));

  return {
    initialAttemptEvaluableCount: initialEvaluable.length,
    initialAttemptSuccessfulCount: initialSuccessful.length,
    initialAttemptSuccessRate: rate("initialAttemptSuccessRate", initialSuccessful.length, initialEvaluable.length, "no case has a determinate initial-attempt task-success verdict for this treatment."),
    finalEvaluableCount: finalEvaluable.length,
    finalSuccessfulCount: finalSuccessful.length,
    finalTaskSuccessRate: rate("finalTaskSuccessRate", finalSuccessful.length, finalEvaluable.length, "no case has a determinate final task-success verdict for this treatment."),
    repairEligibleCaseCount: repairs.filter((repair) => repair.initialAttemptRepairEligible).length,
    repairAttemptedCaseCount: attempted.length,
    repairAttemptedEvaluableCaseCount: attemptedEvaluable.length,
    repairedCaseCount: repaired.length,
    repairSuccessRate:
      attempted.length === 0
        ? notApplicableMetric("repairSuccessRate", "ratio", "no repair attempt was executed for this treatment.")
        : rate("repairSuccessRate", repaired.length, attemptedEvaluable.length, "no repair-attempted case has a determinate repair verdict."),
    totalAttemptCount: repairs.reduce((total, repair) => total + repair.attemptCount, 0),
    totalRepairAttemptCount: repairs.reduce((total, repair) => total + repair.repairAttemptCount, 0),
    meanAttemptsPerEvaluableCase:
      finalEvaluable.length === 0
        ? unavailableMetric("meanAttemptsPerEvaluableCase", "count", "no case has a determinate final task-success verdict for this treatment.")
        : availableMetric("meanAttemptsPerEvaluableCase", finalEvaluable.reduce((total, repair) => total + repair.attemptCount, 0) / finalEvaluable.length, "count"),
    providerDurationMs: [
      measurementTotal("firstAttemptProviderDurationMs", "ms", "first-attempt", "first-attempt provider duration", durationSamples((r) => r.firstAttemptProviderDurationMs)),
      measurementTotal("finalAttemptProviderDurationMs", "ms", "final-attempt", "final-attempt provider duration", durationSamples((r) => r.finalAttemptProviderDurationMs)),
      measurementTotal("totalProviderDurationMs", "ms", "total-across-attempts", "total provider duration", durationSamples((r) => r.totalProviderDurationMs))
    ],
    providerTokens: [
      measurementTotal("firstAttemptProviderTokens", "tokens", "first-attempt", "first-attempt provider token total", durationSamples((r) => r.firstAttemptProviderTokens)),
      measurementTotal("finalAttemptProviderTokens", "tokens", "final-attempt", "final-attempt provider token total", durationSamples((r) => r.finalAttemptProviderTokens)),
      measurementTotal("totalProviderTokens", "tokens", "total-across-attempts", "total provider token total", durationSamples((r) => r.totalProviderTokens))
    ]
  };
}

function emptyPairs(): AgentSuccessPairedOutcomesV1 {
  return { bothSucceeded: 0, onlyRawFullFileSucceeded: 0, onlyContextPackSucceeded: 0, neitherSucceeded: 0 };
}

function countPair(pairs: AgentSuccessPairedOutcomesV1, raw: boolean, pack: boolean): void {
  if (raw && pack) pairs.bothSucceeded += 1;
  else if (raw) pairs.onlyRawFullFileSucceeded += 1;
  else if (pack) pairs.onlyContextPackSucceeded += 1;
  else pairs.neitherSucceeded += 1;
}

type PairedSpec = {
  id: AgentSuccessPairedDifferenceId;
  basis: AgentSuccessMeasurementBasis;
  unit: AgentSuccessMetricUnit;
  value(entry: AgentSuccessTreatmentAnalysisV1): number | null;
};

const asNumber = (flag: boolean | null): number | null => (flag === null ? null : flag ? 1 : 0);

const PAIRED_SPECS: readonly PairedSpec[] = [
  { id: "initialAttemptSuccess", basis: "first-attempt", unit: "ratio", value: (e) => asNumber(booleanOf(repairOf(e)?.initialAttemptTaskSuccess)) },
  { id: "finalSuccess", basis: "final-attempt", unit: "ratio", value: (e) => asNumber(booleanOf(e.metrics.taskSuccess)) },
  { id: "repairAttempts", basis: "total-across-attempts", unit: "count", value: (e) => (repairOf(e) ? repairOf(e)!.repairAttemptCount : null) },
  { id: "editScopePrecision", basis: "final-attempt", unit: "ratio", value: (e) => numberOf(e.metrics.editScopePrecision) },
  { id: "expectedEditCoverage", basis: "final-attempt", unit: "ratio", value: (e) => numberOf(e.metrics.expectedEditCoverage) },
  { id: "unexpectedChangedFiles", basis: "final-attempt", unit: "count", value: (e) => numberOf(e.metrics.unexpectedChangedFileCount) },
  { id: "totalChurn", basis: "final-attempt", unit: "lines", value: (e) => numberOf(e.metrics.totalChurn) },
  { id: "providerDurationMs", basis: "total-across-attempts", unit: "ms", value: (e) => numberOf(repairOf(e)?.totalProviderDurationMs) },
  { id: "providerTokens", basis: "total-across-attempts", unit: "tokens", value: (e) => numberOf(repairOf(e)?.totalProviderTokens) }
];

function pairedDifference(spec: PairedSpec, cases: readonly AgentSuccessCaseAnalysisV1[]): AgentSuccessPairedDifferenceV1 {
  const matched: Array<{ caseId: string; raw: number; pack: number }> = [];
  for (const entry of cases) {
    const raw = spec.value(entry.treatments[0]!);
    const pack = spec.value(entry.treatments[1]!);
    if (raw !== null && pack !== null) matched.push({ caseId: entry.caseId, raw, pack });
  }
  const mean = (id: string, values: readonly number[]): AgentSuccessMetricV1 =>
    values.length === 0
      ? unavailableMetric(id, spec.unit, "no case has a determinate value for both treatments.")
      : availableMetric(id, values.reduce((total, value) => total + value, 0) / values.length, spec.unit);
  return {
    id: spec.id,
    basis: spec.basis,
    matchedCaseIds: matched.map((entry) => entry.caseId),
    rawFullFileMean: mean(`${spec.id}.rawFullFileMean`, matched.map((entry) => entry.raw)),
    contextPackMean: mean(`${spec.id}.contextPackMean`, matched.map((entry) => entry.pack)),
    meanDifference: mean(`${spec.id}.meanDifference`, matched.map((entry) => entry.pack - entry.raw))
  };
}

/** Initial-attempt matched accounting plus descriptive paired differences. No winner, rank or significance test. */
export function buildRepairComparison(cases: readonly AgentSuccessCaseAnalysisV1[], finalPairs: AgentSuccessPairedOutcomesV1): AgentSuccessRepairComparisonV1 {
  const matchedCaseIds: string[] = [];
  const incompleteCases: Array<{ caseId: string; unavailableTreatmentIds: (typeof AGENT_SUCCESS_RATE_TREATMENT_IDS)[number][] }> = [];
  const pairedOutcomes = emptyPairs();
  for (const entry of cases) {
    const values = entry.treatments.map((treatment) => booleanOf(repairOf(treatment)?.initialAttemptTaskSuccess));
    const unavailableTreatmentIds = entry.treatments.filter((_, index) => values[index] === null).map((treatment) => treatment.treatmentId);
    if (unavailableTreatmentIds.length > 0) {
      incompleteCases.push({ caseId: entry.caseId, unavailableTreatmentIds });
      continue;
    }
    matchedCaseIds.push(entry.caseId);
    countPair(pairedOutcomes, values[0] === true, values[1] === true);
  }
  const differs = (pairs: AgentSuccessPairedOutcomesV1): boolean => pairs.onlyRawFullFileSucceeded + pairs.onlyContextPackSucceeded > 0;
  const finalMatched = finalPairs.bothSucceeded + finalPairs.onlyRawFullFileSucceeded + finalPairs.onlyContextPackSucceeded + finalPairs.neitherSucceeded;
  const evaluable = finalMatched > 0 || matchedCaseIds.length > 0;
  return {
    initialAttempt: { matchedCaseIds, incompleteCases, pairedOutcomes },
    pairedDifferences: PAIRED_SPECS.map((spec) => pairedDifference(spec, cases)),
    interpretation: {
      evaluable,
      observedOutcomeDifference: !evaluable ? ("not-evaluable" as const) : differs(finalPairs) || differs(pairedOutcomes) ? ("observed" as const) : ("not-observed" as const),
      statisticalEffect: "not-assessed" as const
    }
  };
}
