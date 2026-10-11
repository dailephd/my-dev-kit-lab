import type { AgentSuccessCampaignProgressReportV1 } from "./agentSuccessCampaignProgressReportModel.js";
export function renderAgentSuccessCampaignProgressText(m: AgentSuccessCampaignProgressReportV1): string {
  return [
    "Agent Success Rate Campaign Progress", `Schema: ${m.schemaVersion}`, `Campaign: ${m.campaignIdentity}`, `Execution mode: ${m.executionMode}`,
    `Checkpoint revision: ${m.checkpointGeneration} (${m.checkpointRevision})`, `State: ${m.state}`,
    `Completed evaluations: ${m.unitCounts.completed}/${m.totalTreatmentUnits} treatment units`,
    `Completed cases: ${m.caseCounts.completed}/${m.selectedCaseCount}`,
    ...Object.entries(m.unitCounts).map(([s, n]) => `Treatment state ${s}: ${n}`),
    ...Object.entries(m.caseCounts).map(([s, n]) => `Case state ${s}: ${n}`),
    `Provider limit: ${m.knownProviderLimit}; uncertainty: ${m.knownUncertainty}`,
    `Diagnostics: ${m.diagnostics.join(", ") || "none"}`,
    `Scientific results: ${m.scientificCompleteness}; validated final artifacts: ${m.finalScientificArtifactsAvailable}`,
    `Completed cases: ${m.completedCaseIds.join(", ") || "none"}`, `Unfinished cases: ${m.unfinishedCaseIds.join(", ") || "none"}`,
    ...m.cases.flatMap(c => c.treatments.flatMap(t => [
      `${c.caseId} / ${t.treatmentId}: ${t.state}; evaluated task success=${t.evaluatedTaskSuccess ?? "unavailable"}; epochs=${t.epochCount}; historical limits=${t.historicalProviderLimitCount}; diagnostics=${t.diagnostics.join(", ") || "none"}`,
      ...t.attempts.map(a => `  Attempt ${a.attemptNumber}: provider invoked=${a.providerInvoked}; Lab duration=${a.duration.durationMs ?? "unavailable"} ms (${a.duration.source}); tokens=${a.tokens.totalTokens ?? "unavailable"}; input=${a.tokens.inputTokens ?? "unavailable"}; output=${a.tokens.outputTokens ?? "unavailable"}; source=${a.tokens.source}; reliability=${a.tokens.reliability}; category=${a.tokens.evidenceLevel}; numeric availability=${a.tokens.numericAvailability}; interpretation=${a.tokenInterpretation}`)
    ])),
    "Comparisons (context-pack minus raw-full-file; descriptive matched subset means):",
    ...m.comparisons.flatMap(q => [
      `${q.quantity}: ${q.quality}; basis=${q.basis}; measurement=${q.measurementBasis}; matched=${q.matchedCaseIds.length}/${q.selectedCaseCount}; excluded=${q.excludedCaseIds.length}`,
      `  Matched: ${q.matchedCaseIds.join(", ") || "none"}; excluded: ${q.excludedCaseIds.join(", ") || "none"}`,
      `  Raw mean=${q.rawFullFileMean ?? "unavailable"}; context mean=${q.contextPackMean ?? "unavailable"}; delta=${q.meanDifference ?? "unavailable"}; unit=${q.unit}`,
      ...q.reasons.map((r, i) => `  ${r}: ${q.reasonExplanations[i]}`)
    ]), "Scientific limitations:", ...m.limitations.map(l => `- ${l}`), ""
  ].join("\n");
}
