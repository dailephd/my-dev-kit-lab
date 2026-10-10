import type { AgentSuccessRateReportV1 } from "./agentSuccessRateReportModel.js";
import { AGENT_SUCCESS_BASIS_LABEL, formatAgentSuccessMetric, formatAgentSuccessPairs, formatAgentSuccessTotal } from "./renderAgentSuccessRateText.js";

function escapeHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function table(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

/**
 * HTML rendering of the typed section. All dynamic content is escaped, artifact references are plain text (never links
 * or embedded files), and no value is recalculated here.
 */
export function renderAgentSuccessRateHtml(report: AgentSuccessRateReportV1 | null): string {
  if (!report) return "";
  const realMode = report.identity.executionMode === "real-agent";
  const m = formatAgentSuccessMetric;
  const parts: string[] = [];

  parts.push(`<section id="agent-success-rate">
    <h2>Agent Success Rate</h2>
    <h3>Experiment identity</h3>
    ${table(["Field", "Value"], [
      ["Run ID", report.identity.runId],
      ["Plugin", `${report.identity.pluginId} (schema ${report.identity.pluginSchemaVersion})`],
      ["Run status", report.identity.runStatus],
      ["Cases", String(report.identity.caseCount)],
      ["Treatments", report.identity.treatmentOrder.join(", ")],
      ["Treatment outcomes", String(report.identity.treatmentOutcomeCount)]
    ])}
    <h3>Execution mode and provider</h3>
    ${table(["Field", "Value"], [
      ["Execution mode", report.identity.executionMode],
      ["Provider", report.identity.providerId ?? "none (no coding agent was invoked)"],
      ["Provider timeout per attempt", report.identity.timeoutMs === null ? "not applicable" : `${report.identity.timeoutMs} ms`],
      ["Repair attempts allowed", report.identity.repairAttempts === null ? "not applicable" : String(report.identity.repairAttempts)],
      ["Maximum attempts per treatment", String(report.identity.maxAttemptsPerTreatment)]
    ])}
    <h3>Scientific limitations</h3>
    <p><strong>${escapeHtml(report.scientificStatement)}</strong></p>
    <ul>${report.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}</ul>
    <h3>Overall result availability</h3>
    ${table(["Field", "Value"], [
      ["Overall", report.resultAvailability.overall],
      ["Outcomes with a determinate verdict", `${report.resultAvailability.evaluableTreatmentOutcomes} of ${report.resultAvailability.totalTreatmentOutcomes}`],
      ["Outcomes without a determinate verdict", String(report.resultAvailability.unavailableTreatmentOutcomes)]
    ])}
    ${report.resultAvailability.notes.length > 0 ? `<ul>${report.resultAvailability.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
  </section>`);

  const treatmentRows = report.treatments.map((treatment) => [
    treatment.treatmentId,
    String(treatment.evaluableCases),
    String(treatment.initialSuccessfulCases),
    m(treatment.initialSuccessRate),
    String(treatment.finalSuccessfulCases),
    m(treatment.finalSuccessRate),
    treatment.repair ? String(treatment.repair.repairAttempts) : "not applicable",
    treatment.repair ? String(treatment.repair.repairedCases) : "not applicable"
  ]);
  const comparison = report.comparison;
  parts.push(`<section id="agent-success-rate-comparison">
    <h2>Treatment Comparison</h2>
    ${table(["Treatment", "Evaluable cases", "Initial successful cases", "Initial success rate", "Final successful cases", "Final success rate", "Repair attempts", "Repaired cases"], treatmentRows)}
    ${report.treatments
      .filter((treatment) => treatment.repair)
      .map(
        (treatment) =>
          `<p class="muted">${escapeHtml(treatment.treatmentId)}: repair-eligible cases ${treatment.repair!.repairEligibleCases}; cases with a repair ${treatment.repair!.repairAttemptedCases}; repair success rate ${escapeHtml(m(treatment.repair!.repairSuccessRate))}; mean attempts per evaluable case ${escapeHtml(m(treatment.repair!.meanAttemptsPerEvaluableCase))}.</p>`
      )
      .join("")}
    ${
      comparison
        ? `<h3>Matched comparison (descriptive; no winner is declared)</h3>
    ${table(["Statement", "Value"], [
      ["Comparison evaluable", comparison.comparisonEvaluable ? "yes" : "no"],
      ["Observed outcome difference between treatments", comparison.observedOutcomeDifference],
      ["Statistical or causal effect", `${comparison.statisticalEffect} (no significance or causal claim is made)`],
      ["Final matched cases", comparison.finalMatchedCaseIds.join(", ") || "none"],
      ["Final paired outcomes", formatAgentSuccessPairs(comparison.finalPairedOutcomes)],
      ["Initial-attempt matched cases", comparison.initialMatchedCaseIds ? comparison.initialMatchedCaseIds.join(", ") || "none" : "not applicable"],
      ["Initial-attempt paired outcomes", formatAgentSuccessPairs(comparison.initialPairedOutcomes)]
    ])}
    ${
      comparison.pairedDifferences.length > 0
        ? table(
            ["Measurement", "Basis", "Matched cases", "raw-full-file mean", "context-pack mean", "context-pack minus raw-full-file"],
            comparison.pairedDifferences.map((difference) => [
              difference.id,
              AGENT_SUCCESS_BASIS_LABEL[difference.basis] ?? difference.basis,
              String(difference.matchedCaseIds.length),
              m(difference.rawFullFileMean),
              m(difference.contextPackMean),
              m(difference.meanDifference)
            ])
          )
        : ""
    }`
        : `<p class="muted">Matched comparison: not applicable (deterministic-fixture mode does not compare context treatments).</p>`
    }
  </section>`);

  parts.push(`<section id="agent-success-rate-cases">
    <h2>Per-Case Results</h2>
    ${table(
      ["Case", "Project", "Locality", "Treatment", "Status", "Initial task success", "Final task success", "Attempts", "Task-check pass rate", "Regression-check pass rate", "Required-fact coverage"],
      report.cases.flatMap((entry) =>
        entry.treatments.map((treatment) => [
          entry.caseId,
          entry.benchmarkProject,
          entry.taskLocality,
          treatment.treatmentId,
          `${treatment.executionStatus} / ${treatment.evidenceAvailability}`,
          m(treatment.initialTaskSuccess),
          m(treatment.finalTaskSuccess),
          String(treatment.attemptCount),
          m(treatment.taskCheckPassRate),
          m(treatment.regressionCheckPassRate),
          m(treatment.requiredFactCoverage)
        ])
      )
    )}
  </section>`);

  parts.push(`<section id="agent-success-rate-repair-history">
    <h2>Per-Attempt Repair History</h2>
    ${
      !realMode || report.repairHistory.length === 0
        ? `<p class="muted">${realMode ? "No attempt history was recorded." : "Not applicable: deterministic-fixture mode runs a single fixture patch and no provider attempts."}</p>`
        : table(
            ["Case", "Treatment", "Attempt", "Provider status", "Patch outcome", "Verification", "Task success", "Outcome", "Duration", "Tokens", "Artifacts"],
            report.repairHistory.flatMap((history) =>
              history.attempts.map((attempt) => [
                history.caseId,
                history.treatmentId,
                String(attempt.attemptNumber),
                attempt.providerStatus,
                attempt.patchOutcome,
                attempt.verificationAvailability,
                m(attempt.taskSuccess),
                `${attempt.failureCategory}${attempt.repairEligible ? " (repair-eligible)" : ""}`,
                m(attempt.providerDurationMs),
                attempt.tokenAvailability === "available" ? m(attempt.providerTokens) : "unavailable",
                `proposed: ${attempt.proposedPatchPath ?? "none"}; applied: ${attempt.appliedPatchPath ?? "none"}; agent: ${attempt.agentArtifactDirectory ?? "none"}`
              ])
            )
          )
    }
  </section>`);

  parts.push(`<section id="agent-success-rate-edit-quality">
    <h2>Edit Quality And Blast Radius (final evaluated patch)</h2>
    ${table(
      ["Case", "Treatment", "Expected-edit coverage", "Edit-scope precision", "Unexpected changed files", "Protected mutations", "Changed files", "Total churn", "Relative churn"],
      report.cases.flatMap((entry) =>
        entry.treatments.map((treatment) => [
          entry.caseId,
          treatment.treatmentId,
          m(treatment.expectedEditCoverage),
          m(treatment.editScopePrecision),
          m(treatment.unexpectedChangedFiles),
          m(treatment.protectedMutations),
          `${m(treatment.changedFileCount)}${treatment.changedFiles ? ` [${treatment.changedFiles.items.join(", ")}${treatment.changedFiles.omittedCount > 0 ? `, +${treatment.changedFiles.omittedCount} more` : ""}]` : ""}`,
          m(treatment.totalChurn),
          m(treatment.relativeChurn)
        ])
      )
    )}
  </section>`);

  parts.push(`<section id="agent-success-rate-cost">
    <h2>Duration And Token Evidence</h2>
    ${table(
      ["Case", "Treatment", "Final-attempt provider duration", "Final-attempt provider tokens", "Total provider duration (all attempts)", "Total provider tokens (all attempts)"],
      report.cases.flatMap((entry) =>
        entry.treatments.map((treatment) => [
          entry.caseId,
          treatment.treatmentId,
          m(treatment.finalAttemptProviderDurationMs),
          m(treatment.finalAttemptProviderTokens),
          treatment.totalProviderDurationMs ? m(treatment.totalProviderDurationMs) : "not applicable",
          treatment.totalProviderTokens ? m(treatment.totalProviderTokens) : "not applicable"
        ])
      )
    )}
    ${report.treatments
      .filter((treatment) => treatment.repair)
      .flatMap((treatment) => [
        ...treatment.repair!.providerDurationMs.map((total) => `<p class="muted">${escapeHtml(treatment.treatmentId)} provider duration [${escapeHtml(AGENT_SUCCESS_BASIS_LABEL[total.basis] ?? total.basis)}]: ${escapeHtml(formatAgentSuccessTotal(total))}</p>`),
        ...treatment.repair!.providerTokens.map((total) => `<p class="muted">${escapeHtml(treatment.treatmentId)} provider tokens [${escapeHtml(AGENT_SUCCESS_BASIS_LABEL[total.basis] ?? total.basis)}]: ${escapeHtml(formatAgentSuccessTotal(total))}</p>`)
      ])
      .join("")}
  </section>`);

  const errors = report.cases.flatMap((entry) => entry.treatments.flatMap((treatment) => treatment.errors.map((error) => [entry.caseId, treatment.treatmentId, String(error.attemptNumber), error.code, error.message])));
  parts.push(`<section id="agent-success-rate-findings">
    <h2>Agent Success Rate Warnings, Failures And Artifacts</h2>
    ${report.warnings.length === 0 && errors.length === 0 ? "<p>No warnings or recorded errors.</p>" : table(["Source", "Case", "Treatment", "Attempt", "Code", "Message"], [...report.warnings.map((warning) => ["warning", "", "", "", warning.code, warning.message]), ...errors.map((error) => ["error", ...error])])}
    ${table(["Artifact", "Reference", "Case", "Treatment"], report.artifacts.map((artifact) => [artifact.id, artifact.path ?? "[reference withheld]", artifact.caseId ?? "", artifact.variantId ?? ""]))}
  </section>`);

  return parts.join("\n\n  ");
}
