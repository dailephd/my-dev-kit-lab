import type {
  AgentSuccessRateReportV1,
  AgentSuccessReportMeasurementTotalV1,
  AgentSuccessReportMetricV1,
  AgentSuccessReportPairedOutcomesV1
} from "./agentSuccessRateReportModel.js";

/** One display form for every metric: an absent value is labelled, never rendered as zero. */
export function formatAgentSuccessMetric(metric: AgentSuccessReportMetricV1 | null | undefined): string {
  if (!metric) return "unavailable (not recorded)";
  if (metric.availability === "unavailable") return `unavailable (${metric.reason ?? "no reason recorded"})`;
  if (metric.availability === "not-applicable") return `not applicable (${metric.reason ?? "no reason recorded"})`;
  const value = metric.value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value !== "number") return "unavailable (no value)";
  switch (metric.unit) {
    case "ratio":
      return value.toFixed(4);
    case "ms":
      return `${Math.round(value)} ms`;
    case "tokens":
      return `${Math.round(value)} tokens`;
    case "lines":
      return `${Math.round(value)} lines`;
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
}

export function formatAgentSuccessTotal(total: AgentSuccessReportMeasurementTotalV1): string {
  const base = `${formatAgentSuccessMetric(total.total)}; contributing cases=${total.contributingCaseCount}, measured=${total.availableCaseCount}, unmeasured=${total.unavailableCaseCount}`;
  return total.unavailableCaseCount > 0 && total.sumOfAvailable !== null ? `${base}; sum of measured cases only=${total.sumOfAvailable} (not a complete total)` : base;
}

export function formatAgentSuccessPairs(pairs: AgentSuccessReportPairedOutcomesV1 | null): string {
  if (!pairs) return "not recorded";
  return `both succeeded=${pairs.bothSucceeded}, only raw-full-file=${pairs.onlyRawFullFileSucceeded}, only context-pack=${pairs.onlyContextPackSucceeded}, neither=${pairs.neitherSucceeded}`;
}

export const AGENT_SUCCESS_BASIS_LABEL: Record<string, string> = {
  "first-attempt": "first attempt",
  "final-attempt": "final attempt",
  "total-across-attempts": "total across attempts"
};

const sanitize = (value: unknown): string => String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();

/** Text rendering of the typed section. It formats already-calculated values and recalculates none of them. */
export function renderAgentSuccessRateTextLines(report: AgentSuccessRateReportV1): string[] {
  const realMode = report.identity.executionMode === "real-agent";
  const lines: string[] = [];
  const section = (title: string): void => {
    lines.push("", title, "-".repeat(title.length));
  };

  lines.push("", "AGENT SUCCESS RATE", "==================");

  section("A. Experiment identity");
  lines.push(
    `Run ID: ${sanitize(report.identity.runId)}`,
    `Plugin: ${sanitize(report.identity.pluginId)} (schema ${sanitize(report.identity.pluginSchemaVersion)})`,
    `Run status: ${sanitize(report.identity.runStatus)}`,
    `Cases: ${report.identity.caseCount}; treatments: ${report.identity.treatmentOrder.join(", ")}; treatment outcomes: ${report.identity.treatmentOutcomeCount}`
  );

  section("B. Execution mode and provider");
  lines.push(
    `Execution mode: ${sanitize(report.identity.executionMode)}`,
    `Provider: ${report.identity.providerId ?? "none (no coding agent was invoked)"}`,
    `Provider timeout per attempt: ${report.identity.timeoutMs === null ? "not applicable" : `${report.identity.timeoutMs} ms`}`,
    `Repair attempts allowed: ${report.identity.repairAttempts === null ? "not applicable" : report.identity.repairAttempts}; maximum attempts per treatment: ${report.identity.maxAttemptsPerTreatment}`
  );

  section("C. Scientific limitations");
  lines.push(sanitize(report.scientificStatement));
  for (const limitation of report.limitations) lines.push(`- ${sanitize(limitation)}`);

  section("D. Overall result availability");
  const availability = report.resultAvailability;
  lines.push(
    `Overall: ${availability.overall}`,
    `Treatment outcomes with a determinate task-success verdict: ${availability.evaluableTreatmentOutcomes} of ${availability.totalTreatmentOutcomes}; without: ${availability.unavailableTreatmentOutcomes}`
  );
  for (const note of availability.notes) lines.push(`- ${sanitize(note)}`);

  section("E. Treatment comparison");
  for (const treatment of report.treatments) {
    lines.push(
      `Treatment ${treatment.treatmentId}:`,
      `  evaluable cases: ${treatment.evaluableCases}`,
      `  initial-attempt successful cases: ${treatment.initialSuccessfulCases}; initial success rate: ${formatAgentSuccessMetric(treatment.initialSuccessRate)}`,
      `  final successful cases: ${treatment.finalSuccessfulCases}; final success rate: ${formatAgentSuccessMetric(treatment.finalSuccessRate)}`
    );
    if (treatment.repair) {
      lines.push(
        `  repair-eligible cases: ${treatment.repair.repairEligibleCases}; repair attempts executed: ${treatment.repair.repairAttempts}; cases with a repair: ${treatment.repair.repairAttemptedCases}; repaired cases: ${treatment.repair.repairedCases}`,
        `  repair success rate: ${formatAgentSuccessMetric(treatment.repair.repairSuccessRate)}; mean attempts per evaluable case: ${formatAgentSuccessMetric(treatment.repair.meanAttemptsPerEvaluableCase)}`
      );
    } else {
      lines.push("  repair: not applicable (deterministic-fixture mode; the single fixture attempt is both initial and final)");
    }
  }
  if (report.comparison) {
    const comparison = report.comparison;
    lines.push(
      "Matched comparison (descriptive; no winner is declared):",
      `  comparison evaluable: ${comparison.comparisonEvaluable ? "yes" : "no"}`,
      `  observed outcome difference between treatments: ${comparison.observedOutcomeDifference}`,
      `  statistical or causal effect: ${comparison.statisticalEffect} (no significance or causal claim is made)`,
      `  final matched cases: ${comparison.finalMatchedCaseIds.length > 0 ? comparison.finalMatchedCaseIds.join(", ") : "none"}`,
      `  final paired outcomes: ${formatAgentSuccessPairs(comparison.finalPairedOutcomes)}`
    );
    if (comparison.initialMatchedCaseIds) {
      lines.push(
        `  initial-attempt matched cases: ${comparison.initialMatchedCaseIds.length > 0 ? comparison.initialMatchedCaseIds.join(", ") : "none"}`,
        `  initial-attempt paired outcomes: ${formatAgentSuccessPairs(comparison.initialPairedOutcomes)}`
      );
    }
    for (const incomplete of comparison.finalIncompleteCases) lines.push(`  excluded from final matched metrics: ${incomplete.caseId} (no determinate verdict for ${incomplete.unavailableTreatmentIds.join(", ")})`);
    for (const difference of comparison.pairedDifferences) {
      lines.push(
        `  paired difference ${difference.id} [${AGENT_SUCCESS_BASIS_LABEL[difference.basis] ?? difference.basis}] over ${difference.matchedCaseIds.length} matched case(s): raw-full-file ${formatAgentSuccessMetric(difference.rawFullFileMean)}; context-pack ${formatAgentSuccessMetric(difference.contextPackMean)}; context-pack minus raw-full-file ${formatAgentSuccessMetric(difference.meanDifference)}`
      );
    }
  } else {
    lines.push("Matched comparison: not applicable (deterministic-fixture mode does not compare context treatments).");
  }

  section("F. Per-case results");
  for (const entry of report.cases) {
    lines.push(`Case ${entry.caseId} (${sanitize(entry.caseName)}) project=${entry.benchmarkProject} locality=${entry.taskLocality}`);
    for (const treatment of entry.treatments) {
      lines.push(
        `  ${treatment.treatmentId}: status=${treatment.executionStatus} evidence=${treatment.evidenceAvailability}`,
        `    initial task success: ${formatAgentSuccessMetric(treatment.initialTaskSuccess)}; final task success: ${formatAgentSuccessMetric(treatment.finalTaskSuccess)}; attempts=${treatment.attemptCount}; repair attempts=${treatment.repairAttemptCount}; repair succeeded: ${formatAgentSuccessMetric(treatment.repairSucceeded)}`,
        `    task-check pass rate: ${formatAgentSuccessMetric(treatment.taskCheckPassRate)}; regression-check pass rate: ${formatAgentSuccessMetric(treatment.regressionCheckPassRate)}; required-fact coverage: ${formatAgentSuccessMetric(treatment.requiredFactCoverage)}`
      );
    }
  }

  section("G. Per-attempt repair history");
  if (!realMode || report.repairHistory.length === 0) {
    lines.push(realMode ? "No attempt history was recorded." : "Not applicable: deterministic-fixture mode runs a single fixture patch and no provider attempts.");
  }
  for (const history of report.repairHistory) {
    lines.push(`Case ${history.caseId} / ${history.treatmentId}: ${history.attempts.length} attempt(s)`);
    for (const attempt of history.attempts) {
      lines.push(
        `  attempt ${attempt.attemptNumber}: provider=${attempt.providerStatus}; patch=${attempt.patchOutcome}; verification=${attempt.verificationAvailability}; task success=${formatAgentSuccessMetric(attempt.taskSuccess)}; outcome=${attempt.failureCategory}${attempt.repairEligible ? " (repair-eligible)" : ""}`,
        `    duration: ${formatAgentSuccessMetric(attempt.providerDurationMs)}; tokens: ${attempt.tokenAvailability === "available" ? formatAgentSuccessMetric(attempt.providerTokens) : "unavailable"}`,
        `    artifacts: proposed patch=${attempt.proposedPatchPath ?? "none"}; applied patch=${attempt.appliedPatchPath ?? "none"}; agent files=${attempt.agentArtifactDirectory ?? "none"}`
      );
    }
  }

  section("H. Edit-quality and blast-radius measurements (final evaluated patch)");
  for (const entry of report.cases) {
    for (const treatment of entry.treatments) {
      lines.push(
        `${entry.caseId} / ${treatment.treatmentId}: expected-edit coverage=${formatAgentSuccessMetric(treatment.expectedEditCoverage)}; edit-scope precision=${formatAgentSuccessMetric(treatment.editScopePrecision)}; unexpected changed files=${formatAgentSuccessMetric(treatment.unexpectedChangedFiles)}; protected mutations=${formatAgentSuccessMetric(treatment.protectedMutations)}`,
        `  changed files=${formatAgentSuccessMetric(treatment.changedFileCount)}${treatment.changedFiles ? ` [${treatment.changedFiles.items.join(", ")}${treatment.changedFiles.omittedCount > 0 ? `, +${treatment.changedFiles.omittedCount} more` : ""}]` : ""}; total churn=${formatAgentSuccessMetric(treatment.totalChurn)}; relative churn=${formatAgentSuccessMetric(treatment.relativeChurn)}`
      );
    }
  }

  section("I. Duration and token evidence");
  for (const entry of report.cases) {
    for (const treatment of entry.treatments) {
      lines.push(
        `${entry.caseId} / ${treatment.treatmentId}: final-attempt provider duration=${formatAgentSuccessMetric(treatment.finalAttemptProviderDurationMs)}; final-attempt provider tokens=${formatAgentSuccessMetric(treatment.finalAttemptProviderTokens)}` +
          (treatment.totalProviderDurationMs
            ? `; total provider duration across attempts=${formatAgentSuccessMetric(treatment.totalProviderDurationMs)}; total provider tokens across attempts=${formatAgentSuccessMetric(treatment.totalProviderTokens)}`
            : "")
      );
    }
  }
  for (const treatment of report.treatments) {
    if (!treatment.repair) continue;
    for (const total of treatment.repair.providerDurationMs) lines.push(`${treatment.treatmentId} provider duration [${AGENT_SUCCESS_BASIS_LABEL[total.basis] ?? total.basis}]: ${formatAgentSuccessTotal(total)}`);
    for (const total of treatment.repair.providerTokens) lines.push(`${treatment.treatmentId} provider tokens [${AGENT_SUCCESS_BASIS_LABEL[total.basis] ?? total.basis}]: ${formatAgentSuccessTotal(total)}`);
  }

  section("J. Warnings, failures and artifact references");
  const errors = report.cases.flatMap((entry) => entry.treatments.flatMap((treatment) => treatment.errors.map((error) => ({ caseId: entry.caseId, treatmentId: treatment.treatmentId, ...error }))));
  if (report.warnings.length === 0 && errors.length === 0) lines.push("No warnings or recorded errors.");
  for (const warning of report.warnings) lines.push(`warning ${sanitize(warning.code)}: ${sanitize(warning.message)}`);
  for (const error of errors) lines.push(`error ${error.caseId} / ${error.treatmentId} attempt ${error.attemptNumber} ${sanitize(error.code)}: ${sanitize(error.message)}`);
  for (const artifact of report.artifacts) lines.push(`artifact ${sanitize(artifact.id)}: ${artifact.path ?? "[reference withheld]"}`);
  return lines;
}
