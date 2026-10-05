import type { PluginExperimentReport } from "./experimentReportModel.js";
import type {
  ContextStrategyComparisonV043ReportV1,
  ContextStrategyComparisonV043StrategyReportV1,
  V043BoundedReportListV1,
  V043ReportCountMetricV1,
  V043ReportRatioMetricV1,
} from "./contextStrategyComparisonV043ReportModel.js";
import type { WarmIndexNumberMetricV1 } from "../../experiments/plugins/warmIndexReuse/metrics.js";
import type {
  WarmIndexReuseReportAffectedNeighborhoodV1,
  WarmIndexReuseReportAgentV1,
  WarmIndexReuseReportBoundedListV1,
  WarmIndexReuseReportCampaignV1,
  WarmIndexReuseReportFreshnessV1,
  WarmIndexReuseReportV1,
} from "./warmIndexReuseReportModel.js";
import type {
  IncrementalChangeStalenessReportScenarioV1,
  IncrementalChangeStalenessReportTreatmentV1,
  IncrementalChangeStalenessReportV1
} from "./incrementalChangeStalenessReportModel.js";
import { STALE_RISK_CLASSIFICATION_EXPLANATIONS } from "./buildIncrementalChangeStalenessReport.js";
import type { IncrementalChangeStalenessReportV2 } from "./incrementalChangeStalenessReportModelV2.js";
import { isV2ReportSection } from "./buildIncrementalChangeStalenessReportV2.js";
import { renderIncrementalChangeStalenessSectionV2 } from "./renderIncrementalChangeStalenessTextV2.js";
import { REINDEX_RECOMMENDATION_EXPLANATIONS } from "./buildWarmIndexReuseReport.js";
import { renderContextWindowScalingTextLines } from "./renderContextWindowScalingText.js";
import { renderRetrievalPrecisionRecallTextLines } from "./renderRetrievalPrecisionRecallText.js";

function sanitizeScalar(value: unknown): string {
  const text = String(value);
  let result = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 13 || code === 10 || code === 9) {
      result += " ";
      continue;
    }
    if (code <= 8) continue;
    if (code === 11 || code === 12) continue;
    if (code >= 14 && code <= 31) continue;
    if (code === 127) continue;
    result += ch;
  }
  return result;
}

function fieldLine(label: string, value: unknown): string {
  if (value === null || value === undefined) return `${label}: unavailable`;
  return `${label}: ${sanitizeScalar(value)}`;
}

function pushSection(lines: string[], title: string): void {
  lines.push(title);
}

function pushDashList(lines: string[], items: string[]): void {
  if (items.length === 0) {
    lines.push("- none");
    return;
  }
  for (const item of items) {
    lines.push(`- ${sanitizeScalar(item)}`);
  }
}

function pushBoundedList<T>(lines: string[], list: V043BoundedReportListV1<T>, renderItem: (item: T) => string): void {
  lines.push(`Displayed: ${list.displayedCount} of ${list.totalCount}`);
  lines.push(`Omitted: ${list.omittedCount}`);
  if (list.totalCount === 0) {
    lines.push("- none");
    return;
  }
  for (const item of list.items) {
    lines.push(`- ${sanitizeScalar(renderItem(item))}`);
  }
}

function pushRatioMetric(lines: string[], label: string, metric: V043ReportRatioMetricV1): void {
  lines.push(label);
  lines.push(`Availability: ${metric.availability}`);
  if (metric.availability === "available") {
    lines.push(`Numerator: ${metric.numerator}`);
    lines.push(`Denominator: ${metric.denominator}`);
    lines.push(`Rate: ${metric.rate}`);
    lines.push(`Percentage: ${String((metric.rate as number) * 100)}%`);
  } else {
    lines.push(`Reason: ${sanitizeScalar(metric.reason ?? "")}`);
  }
  lines.push("Matched Expectation IDs:");
  pushBoundedList(lines, metric.matchedExpectationIds, (id) => id);
  lines.push("Missing Expectation IDs:");
  pushBoundedList(lines, metric.missingExpectationIds, (id) => id);
}

function pushCountMetric(lines: string[], label: string, metric: V043ReportCountMetricV1): void {
  lines.push(label);
  lines.push(`Availability: ${metric.availability}`);
  if (metric.availability === "available") {
    lines.push(`Count: ${metric.count}`);
  } else {
    lines.push(`Reason: ${sanitizeScalar(metric.reason ?? "")}`);
  }
  lines.push("Evidence Keys:");
  pushBoundedList(lines, metric.evidenceKeys, (key) => key);
}

function renderStrategy(lines: string[], strategy: ContextStrategyComparisonV043StrategyReportV1, index: number): void {
  pushSection(lines, `Strategy ${index + 1}: ${strategy.strategyId}`);

  pushSection(lines, "Artifacts");
  pushBoundedList(lines, strategy.artifacts, (artifact) =>
    `${artifact.sourceInstance} [${artifact.artifactKind}] path=${artifact.sourcePath} schema=${artifact.schemaVersion}`
  );

  pushSection(lines, "Execution");
  lines.push(fieldLine("Status", strategy.execution.status));
  lines.push("Issues:");
  pushBoundedList(lines, strategy.execution.issues, (issue) => `${issue.code} ${issue.fieldPath ?? ""} ${issue.message}`);

  pushSection(lines, "Evaluation Metrics");
  lines.push(fieldLine("Status", strategy.evaluation.status));
  lines.push(fieldLine("Reason", strategy.evaluation.reason));
  lines.push("Warnings:");
  pushBoundedList(lines, strategy.evaluation.warnings, (warning) => warning);
  if (strategy.evaluation.metrics) {
    const metrics = strategy.evaluation.metrics;
    pushRatioMetric(lines, "Required Evidence Recall", metrics.requiredEvidenceRecall);
    pushRatioMetric(lines, "Allowed Evidence Coverage", metrics.allowedEvidenceCoverage);
    pushRatioMetric(lines, "Forbidden Evidence Inclusion", metrics.forbiddenEvidenceInclusion);
    pushCountMetric(lines, "Irrelevant File Inclusion", metrics.irrelevantFileInclusion);
    pushCountMetric(lines, "Irrelevant Instruction Inclusion", metrics.irrelevantInstructionInclusion);
    pushRatioMetric(lines, "Required Provenance Recall", metrics.requiredProvenanceRecall);
    pushCountMetric(lines, "Considered But Unselected Reads", metrics.consideredButUnselectedReads);
    pushCountMetric(lines, "Unnecessary Reads", metrics.unnecessaryReads);
    pushCountMetric(lines, "Target Immutability (Evaluation)", metrics.targetImmutability);
  }

  pushSection(lines, "Expectation Matches");
  pushBoundedList(lines, strategy.evaluation.expectationMatches, (match) =>
    `${match.expectationId} inclusion=${match.inclusion} outcome=${match.outcome} sourceArtifact=${match.sourceArtifact} targetKey=${match.targetKey}`
  );

  pushSection(lines, "Observed Evidence");
  pushBoundedList(lines, strategy.evaluation.observedEvidence, (evidence) =>
    `${evidence.sourceArtifact}.${evidence.sourceInstance} category=${evidence.category} targetKey=${evidence.targetKey} field=${evidence.sourceFieldPath}`
  );

  pushSection(lines, "State Comparisons");
  if (strategy.evaluation.metrics) {
    pushBoundedList(lines, strategy.evaluation.metrics.stateComparisons, (comparison) =>
      `${comparison.sourceArtifact}.${comparison.sourceInstance} expectationFieldPath=${comparison.expectationFieldPath} artifactFieldPath=${comparison.artifactFieldPath ?? "null"} availability=${comparison.availability} expected=${JSON.stringify(comparison.expected)} actual=${JSON.stringify(comparison.actual)} matched=${comparison.matched}`
    );
  } else {
    lines.push("Displayed: 0 of 0");
    lines.push("Omitted: 0");
    lines.push("- none");
  }

  pushSection(lines, "Responsibility Mapping");
  if (strategy.evaluation.metrics) {
    pushBoundedList(lines, strategy.evaluation.metrics.responsibilityMappingCompleteness, (mapping) =>
      `${mapping.sourceArtifact}.${mapping.sourceInstance} requested=${mapping.requested} operational=${mapping.operational} mapped=${mapping.mappedCount} partiallyMapped=${mapping.partiallyMappedCount} unmapped=${mapping.unmappedCount} notApplicable=${mapping.notApplicableCount} denominator=${mapping.denominator} mappedRate=${mapping.mappedRate}`
    );
  } else {
    lines.push("Displayed: 0 of 0");
    lines.push("Omitted: 0");
    lines.push("- none");
  }

  pushSection(lines, "Context Size");
  if (strategy.evaluation.metrics) {
    const size = strategy.evaluation.metrics.contextSize;
    lines.push(fieldLine("Total Character Count", size.totalCharacterCount));
    lines.push(fieldLine("Total Estimated Token Count (estimate)", size.totalEstimatedTokenCount));
    lines.push(fieldLine("Token Estimate Formula", size.tokenEstimateFormula));
    pushBoundedList(lines, size.sources, (source) =>
      `${source.sourceInstance} kind=${source.sourceKind} characters=${source.characterCount} estimatedTokens=${source.estimatedTokenCount}`
    );
  } else {
    lines.push("Displayed: 0 of 0");
    lines.push("Omitted: 0");
    lines.push("- none");
  }

  pushSection(lines, "Target Immutability");
  pushBoundedList(lines, strategy.assurance.runRecords, (record) => {
    if (record.targetImmutabilityAvailability === "unavailable") {
      return `run=${record.runNumber} availability=unavailable reason=${record.targetImmutabilityReason ?? ""}`;
    }
    return `run=${record.runNumber} availability=available status=${record.targetImmutabilityStatus} newMutationCount=${record.newMutationCount} mutations=${record.mutations.totalCount}`;
  });

  pushSection(lines, "Repeated-Run Determinism");
  const determinism = strategy.assurance.determinism;
  lines.push(fieldLine("Availability", determinism.availability));
  lines.push(fieldLine("Repeat Count", determinism.repeatCount));
  if (determinism.availability === "available") {
    lines.push(fieldLine("Deterministic", determinism.deterministic));
    lines.push(fieldLine("Baseline SHA-256", determinism.baselineSha256));
    lines.push("Run Digests:");
    pushBoundedList(lines, determinism.runDigests, (digest) => `run=${digest.runNumber} sha256=${digest.sha256}`);
    lines.push(`Mismatch Run Numbers: ${determinism.mismatchRunNumbers.join(", ") || "none"}`);
  } else {
    lines.push(fieldLine("Reason", determinism.reason));
  }

  pushSection(lines, "Run Assurance");
  lines.push(fieldLine("Status", strategy.assurance.status));
  lines.push(fieldLine("Repeat Count", strategy.assurance.repeatCount));
  lines.push("Issues:");
  pushBoundedList(lines, strategy.assurance.issues, (issue) =>
    `${issue.code} run=${issue.runNumber ?? ""} field=${issue.fieldPath ?? ""} ${issue.message}`
  );

  if (strategy.producerReadinessBridge) {
    renderProducerReadinessBridge(lines, strategy.producerReadinessBridge);
  }
}

function renderProducerReadinessSide(lines: string[], label: string, side: NonNullable<ContextStrategyComparisonV043StrategyReportV1["producerReadinessBridge"]>["implementation"]): void {
  pushSection(lines, `Producer-Readiness Bridge: ${label}`);
  if (side === null) {
    lines.push("- not supplied");
    return;
  }
  pushRatioMetric(lines, "Expected Owner Present", side.ownerEvaluation.expectedOwnerPresent);
  pushRatioMetric(lines, "Forbidden Owner Present", side.ownerEvaluation.forbiddenOwnerPresent);
  pushCountMetric(lines, "Owner False Positives", side.ownerEvaluation.falsePositiveCount);
  pushCountMetric(lines, "Owner False Negatives", side.ownerEvaluation.falseNegativeCount);

  pushSection(lines, "Truncation Classification");
  pushBoundedList(lines, side.truncationEvaluation, (t) => `group=${t.groupId} cause=${t.cause} availability=${t.availability} limit=${t.limit} used=${t.used}`);

  for (const [agreementLabel, agreement] of [
    ["Packet/Raw Agreement", side.packetAgreement],
    ["Report/Raw Agreement", side.reportAgreement],
  ] as const) {
    pushSection(lines, agreementLabel);
    if (agreement === null) {
      lines.push("- unavailable");
      continue;
    }
    lines.push(`Producer Parity Preserved: ${agreement.upstreamProducerParityPreserved === null ? "unavailable" : agreement.upstreamProducerParityPreserved}`);
    lines.push("Contradictions:");
    pushDashList(
      lines,
      agreement.contradictions.map((c) => `${c.field}: raw=${sanitizeScalar(c.rawValue)} supplemental=${sanitizeScalar(c.supplementalValue)}`)
    );
  }
}

function renderProducerReadinessBridge(
  lines: string[],
  bridge: NonNullable<ContextStrategyComparisonV043StrategyReportV1["producerReadinessBridge"]>
): void {
  pushSection(lines, "Producer-Readiness Bridge");
  lines.push(fieldLine("Status", bridge.status));
  if (bridge.status === "not-applicable") {
    lines.push(fieldLine("Reason", bridge.reason));
    return;
  }

  renderProducerReadinessSide(lines, "Implementation", bridge.implementation);
  renderProducerReadinessSide(lines, "Test", bridge.testImplementation);

  pushSection(lines, "Readiness Agreement");
  if (bridge.readinessAgreement === null) {
    lines.push("- not supplied");
  } else {
    const decision = bridge.readinessAgreement.decisionAgreement;
    lines.push(fieldLine("Observed Decision", decision.observedDecision));
    lines.push(fieldLine("Decision Agreement", decision.decisionAgreement));
    lines.push(fieldLine("Issue-Code Agreement", decision.issueCodesAgreement));
    lines.push("Observed Issue Codes:");
    pushDashList(lines, decision.observedIssueCodes);
    lines.push(fieldLine("Invalid Ready", bridge.readinessAgreement.invalidReady.invalidReady));
    lines.push(fieldLine("Valid Blocked", bridge.readinessAgreement.validBlocked.validBlocked));
    lines.push(fieldLine("Valid Refresh-Required", bridge.readinessAgreement.validBlocked.validRefreshRequired));
  }

  pushSection(lines, "Criticality Evaluation");
  if (bridge.criticalityEvaluation === null) {
    lines.push("- not supplied");
  } else {
    pushRatioMetric(lines, "Mapped Critical Completeness", bridge.criticalityEvaluation.mappedCriticalCompleteness);
    lines.push(`Fully Mapped: ${bridge.criticalityEvaluation.fullyMappedCriticalIds.join(", ") || "none"}`);
    lines.push(`Partially Mapped: ${bridge.criticalityEvaluation.partiallyMappedCriticalIds.join(", ") || "none"}`);
    lines.push(`Unmapped: ${bridge.criticalityEvaluation.unmappedCriticalIds.join(", ") || "none"}`);
    lines.push(`Conflicting: ${bridge.criticalityEvaluation.conflictingCriticalityResponsibilityIds.join(", ") || "none"}`);
  }

  pushSection(lines, "Producer-Readiness Bridge Warnings");
  pushBoundedList(lines, bridge.warnings, (w) => w);
}

function renderV043Section(lines: string[], section: ContextStrategyComparisonV043ReportV1 | null): void {
  if (section === null) {
    lines.push("Not applicable to this plugin.");
    return;
  }
  if (section.summary.strategyCount === 0) {
    lines.push("No v0.4.3 stage-context strategies were selected.");
    return;
  }
  lines.push(fieldLine("Strategy Count", section.summary.strategyCount));
  lines.push(fieldLine("Completed Executions", section.summary.completedExecutionCount));
  lines.push(fieldLine("Invalid-Input Executions", section.summary.invalidInputExecutionCount));
  lines.push(fieldLine("Failed Executions", section.summary.failedExecutionCount));
  lines.push(fieldLine("Completed Evaluations", section.summary.completedEvaluationCount));
  lines.push(fieldLine("Not-Applicable Evaluations", section.summary.notApplicableEvaluationCount));
  lines.push(fieldLine("Failed Evaluations", section.summary.failedEvaluationCount));
  lines.push(fieldLine("Passed Assurance", section.summary.passedAssuranceCount));
  lines.push(fieldLine("Failed Assurance", section.summary.failedAssuranceCount));
  lines.push(fieldLine("Not-Applicable Assurance", section.summary.notApplicableAssuranceCount));
  lines.push(fieldLine("Interpretation Summary", section.interpretation.summary));
  lines.push("Limitations:");
  pushDashList(lines, section.interpretation.limitations);
  for (let index = 0; index < section.strategies.length; index += 1) {
    renderStrategy(lines, section.strategies[index], index);
  }
}

function formatWarmMetric(metric: WarmIndexNumberMetricV1): string {
  const method = metric.tokenCountMethod ? `, method ${metric.tokenCountMethod}` : "";
  if (metric.availability === "available") {
    return `${metric.value} ${metric.unit} (${metric.source}${method})`;
  }
  return `${metric.availability} (${metric.reason ?? ""})`;
}

function formatWarmAgent(agent: WarmIndexReuseReportAgentV1 | null): string {
  if (agent === null) return "not run (no usable context evidence for this side)";
  const passed = agent.passed === null ? "unavailable" : String(agent.passed);
  const issues = [...agent.errors, ...agent.warnings].slice(0, 3).join("; ");
  return `agent ${agent.agentId}, status ${agent.status}, passed ${passed}, token source ${agent.tokenUsageSource}, reliability ${agent.tokenUsageReliability}${issues ? `, notes: ${issues}` : ""}`;
}

function renderCampaignSection(lines: string[], campaign: WarmIndexReuseReportCampaignV1): void {
  pushSection(lines, "Real-Agent Campaign");
  lines.push(fieldLine("Campaign Preset", campaign.presetId));
  lines.push(fieldLine("Agent ID", campaign.agentId));
  lines.push(fieldLine("Campaign Timeout", `${campaign.timeoutMs} ms`));
  lines.push(fieldLine("Scheduled Agent Sides", campaign.scheduledSideCount));
  lines.push(fieldLine("Executed Agent Sides", campaign.executedSideCount));
  lines.push(fieldLine("Not Run For Missing Context", campaign.notRunForMissingContextCount));
  lines.push(fieldLine("Agent Evidence Status", campaign.agentEvidenceStatus));
  lines.push(fieldLine("Token Evidence Status", campaign.tokenEvidenceStatus));
  lines.push(fieldLine("Completed Agent Sides", campaign.outcomeCounts.completed));
  lines.push(fieldLine("Failed Agent Sides", campaign.outcomeCounts.failed));
  lines.push(fieldLine("Timeout Agent Sides", campaign.outcomeCounts.timeout));
  lines.push(fieldLine("Invalid-Output Agent Sides", campaign.outcomeCounts.invalidOutput));
  lines.push(fieldLine("Agent-Unavailable Sides", campaign.outcomeCounts.agentUnavailable));
  lines.push(fieldLine("Agent-Limit-Reached Sides", campaign.outcomeCounts.agentLimitReached));
  lines.push(fieldLine("Skipped Agent Sides", campaign.outcomeCounts.skipped));
}

function renderWarmIndexReuseSection(lines: string[], section: WarmIndexReuseReportV1 | null): void {
  if (section === null) {
    lines.push("Not applicable to this plugin.");
    return;
  }
  lines.push(fieldLine("Project Count", section.summary.projectCount));
  lines.push(fieldLine("Task Count", section.summary.taskCount));
  lines.push(fieldLine("Prepared Session Project Count", section.summary.preparedSessionProjectCount));
  lines.push(fieldLine("Incomplete Or Failed Project Count", section.summary.incompleteProjectCount));
  lines.push(fieldLine("Agent ID", section.agent.id));
  lines.push(fieldLine("Agent Mode", section.agent.mode));
  lines.push(fieldLine("Agent Correctness Available (task sides)", `${section.summary.agentCorrectnessAvailableCount} of ${section.summary.agentSideCount}`));
  lines.push(fieldLine("Agent Token Totals Available (task sides)", `${section.summary.agentTotalTokensAvailableCount} of ${section.summary.agentSideCount}`));
  renderFreshnessSummary(lines, section);
  renderAffectedNeighborhoodSummary(lines, section);
  if (section.agentCampaign) {
    renderCampaignSection(lines, section.agentCampaign);
  }
  lines.push("Cold Start And Warm Reuse:");
  pushDashList(lines, section.costModel);
  lines.push("Limitations:");
  pushDashList(lines, section.limitations);
  if (section.projects.length === 0) {
    lines.push("No warm-index project evidence was recorded.");
    return;
  }
  section.projects.forEach((project, index) => {
    pushSection(lines, `Warm Index Project ${index + 1}: ${sanitizeScalar(project.benchmarkProject)}`);
    lines.push(fieldLine("Session Key", project.sessionKey));
    lines.push(fieldLine("Status", project.status));
    lines.push(fieldLine("Session Prepared", project.sessionPrepared));
    lines.push(fieldLine("Index Build Duration", formatWarmMetric(project.indexBuildDurationMs)));
    lines.push(fieldLine("Task Count", project.taskCount));
    for (const task of project.tasks) {
      pushSection(lines, `Task ${task.taskOrdinal}: ${sanitizeScalar(task.caseId)}`);
      const rows: Array<[string, unknown]> = [
        ["Raw Status", task.rawStatus],
        ["Warm Status", task.warmStatus],
        ["Index Freshness Status", task.indexFreshness ? task.indexFreshness.status : "not assessed"],
        ["Affected Neighborhood Status", task.affectedNeighborhood ? task.affectedNeighborhood.status : "not assessed"],
        ["Raw Context Characters", formatWarmMetric(task.raw.contextCharacters)],
        ["Warm Context Characters", formatWarmMetric(task.warm.contextCharacters)],
        ["Raw Estimated Context Tokens (estimate)", formatWarmMetric(task.raw.contextEstimatedTokens)],
        ["Warm Estimated Context Tokens (estimate)", formatWarmMetric(task.warm.contextEstimatedTokens)],
        ["Raw Operation Duration", formatWarmMetric(task.raw.operationDurationMs)],
        ["Warm Retrieval Duration", formatWarmMetric(task.warm.retrievalDurationMs)],
        ["Amortized Index Build Duration", formatWarmMetric(task.warm.amortizedIndexBuildDurationMs)],
        ["Cumulative Raw Duration", formatWarmMetric(task.raw.cumulativeDurationMs)],
        ["Cumulative Warm Component Duration", formatWarmMetric(task.warm.cumulativeComponentDurationMs)],
        ["Cumulative Raw Estimated Context Tokens (estimate)", formatWarmMetric(task.raw.cumulativeEstimatedContextTokens)],
        ["Cumulative Warm Estimated Context Tokens (estimate)", formatWarmMetric(task.warm.cumulativeEstimatedContextTokens)],
        ["Raw Agent Evaluation", formatWarmAgent(task.rawAgent)],
        ["Warm Agent Evaluation", formatWarmAgent(task.warmAgent)],
        ["Raw Agent Correctness", formatWarmMetric(task.raw.agentCorrectness)],
        ["Warm Agent Correctness", formatWarmMetric(task.warm.agentCorrectness)],
        ["Raw Agent Total Tokens", formatWarmMetric(task.raw.agentTotalTokens)],
        ["Warm Agent Total Tokens", formatWarmMetric(task.warm.agentTotalTokens)],
        ["Cumulative Raw Agent Total Tokens", formatWarmMetric(task.raw.cumulativeAgentTotalTokens)],
        ["Cumulative Warm Agent Total Tokens", formatWarmMetric(task.warm.cumulativeAgentTotalTokens)],
      ];
      for (const [label, value] of rows) {
        lines.push(fieldLine(label, value));
      }
      renderTaskFreshnessDetail(lines, task.indexFreshness);
      renderTaskAffectedNeighborhoodDetail(lines, task.affectedNeighborhood);
    }
  });
}

function renderFreshnessSummary(lines: string[], section: WarmIndexReuseReportV1): void {
  // Reports serialized before v0.6.0 Batch 3 lack the summary; render them as having no assessment.
  const summary = section.indexFreshnessSummary ?? {
    assessedTaskCount: 0,
    unassessedTaskCount: section.summary.taskCount,
    freshTaskCount: 0,
    staleTaskCount: 0,
    partiallyStaleTaskCount: 0,
    unknownTaskCount: 0,
  };
  pushSection(lines, "Index Freshness Summary");
  lines.push(fieldLine("Assessed Tasks", summary.assessedTaskCount));
  lines.push(fieldLine("Unassessed Tasks", summary.unassessedTaskCount));
  lines.push(fieldLine("Fresh Tasks", summary.freshTaskCount));
  lines.push(fieldLine("Stale Tasks", summary.staleTaskCount));
  lines.push(fieldLine("Partially-Stale Tasks", summary.partiallyStaleTaskCount));
  lines.push(fieldLine("Unknown Tasks", summary.unknownTaskCount));
}

function renderAffectedNeighborhoodSummary(lines: string[], section: WarmIndexReuseReportV1): void {
  // Reports serialized before v0.6.1 lack the summary; render them as having no assessment.
  const summary = section.affectedNeighborhoodSummary ?? {
    assessedTaskCount: 0,
    unassessedTaskCount: section.summary.taskCount,
    completeAssessmentCount: 0,
    partialAssessmentCount: 0,
    unavailableAssessmentCount: 0,
    relatedTaskCount: 0,
    unrelatedTaskCount: 0,
    unknownRelationshipTaskCount: 0,
    recommendedReindexCount: 0,
    notIndicatedReindexCount: 0,
    unknownReindexRecommendationCount: 0,
  };
  pushSection(lines, "Affected Neighborhood Summary");
  lines.push(fieldLine("Assessed Tasks", summary.assessedTaskCount));
  lines.push(fieldLine("Unassessed Tasks", summary.unassessedTaskCount));
  lines.push(fieldLine("Complete Assessments", summary.completeAssessmentCount));
  lines.push(fieldLine("Partial Assessments", summary.partialAssessmentCount));
  lines.push(fieldLine("Unavailable Assessments", summary.unavailableAssessmentCount));
  lines.push(fieldLine("Related Tasks", summary.relatedTaskCount));
  lines.push(fieldLine("Unrelated Tasks", summary.unrelatedTaskCount));
  lines.push(fieldLine("Unknown-Relationship Tasks", summary.unknownRelationshipTaskCount));
  lines.push(fieldLine("Reindex Recommended", summary.recommendedReindexCount));
  lines.push(fieldLine("Reindex Not Indicated", summary.notIndicatedReindexCount));
  lines.push(fieldLine("Reindex Recommendation Unknown", summary.unknownReindexRecommendationCount));
}

/** Renders the persisted affected-neighborhood evidence; numeric lines come from the metric owner. */
function renderTaskAffectedNeighborhoodDetail(lines: string[], evidence: WarmIndexReuseReportAffectedNeighborhoodV1 | null | undefined): void {
  if (!evidence) return;
  lines.push(fieldLine("Affected Neighborhood Relationship", evidence.relationship));
  lines.push(fieldLine("Reindex Recommendation", evidence.reindexRecommendation));
  lines.push(fieldLine("Reindex Recommendation Explanation", evidence.recommendationExplanation));
  lines.push(fieldLine("Affected Neighborhood Freshness Status", evidence.freshnessStatus));
  lines.push(fieldLine("Seed Mapping Status", evidence.seedMappingStatus));
  lines.push(fieldLine("Graph Evidence Status", evidence.graphEvidenceStatus));
  lines.push(fieldLine("Neighborhood Status", evidence.neighborhoodStatus));
  lines.push(fieldLine("Task Mapping Status", evidence.taskMappingStatus));
  lines.push(fieldLine("Resolvable Task Nodes", evidence.resolvableTaskNodeCount));
  lines.push(fieldLine("Changed Indexed Files", formatWarmMetric(evidence.metrics.changedFileCount)));
  lines.push(fieldLine("Changed Baseline Symbols", formatWarmMetric(evidence.metrics.changedSymbolCount)));
  lines.push(fieldLine("Affected Graph Nodes", formatWarmMetric(evidence.metrics.affectedNodeCount)));
  lines.push(fieldLine("Affected Graph Edges", formatWarmMetric(evidence.metrics.affectedEdgeCount)));
  lines.push(fieldLine("Task-Overlap Nodes", formatWarmMetric(evidence.metrics.taskOverlapCount)));
  lines.push(fieldLine("Task-Overlap Percent", formatWarmMetric(evidence.metrics.taskOverlapPercent)));
  lines.push("Affected Node IDs:");
  pushFreshnessBoundedNote(lines, evidence.affectedNodeIds);
  if (evidence.affectedNodeIds.items.length === 0) lines.push("- none");
  for (const id of evidence.affectedNodeIds.items) lines.push(`- ${sanitizeScalar(id)}`);
  lines.push("Participating Edge IDs:");
  pushFreshnessBoundedNote(lines, evidence.participatingEdgeIds);
  if (evidence.participatingEdgeIds.items.length === 0) lines.push("- none");
  for (const id of evidence.participatingEdgeIds.items) lines.push(`- ${sanitizeScalar(id)}`);
  lines.push("Unresolved Task Mappings:");
  pushFreshnessBoundedNote(lines, evidence.unresolvedTaskMappings);
  if (evidence.unresolvedTaskMappings.items.length === 0) lines.push("- none");
  for (const entry of evidence.unresolvedTaskMappings.items) {
    lines.push(`- ${sanitizeScalar(entry.subject)} ${sanitizeScalar(entry.name)} [${sanitizeScalar(entry.reason)}]`);
  }
  lines.push("Ambiguous Task Symbols:");
  pushFreshnessBoundedNote(lines, evidence.ambiguousTaskSymbols);
  if (evidence.ambiguousTaskSymbols.items.length === 0) lines.push("- none");
  for (const entry of evidence.ambiguousTaskSymbols.items) {
    lines.push(`- ${sanitizeScalar(entry.name)}: ${entry.candidateNodeIds.map((id) => sanitizeScalar(id)).join(", ")}`);
  }
  lines.push("Affected Neighborhood Warnings:");
  pushFreshnessBoundedNote(lines, evidence.warnings);
  if (evidence.warnings.items.length === 0) lines.push("- none");
  for (const warning of evidence.warnings.items) {
    lines.push(`- [${sanitizeScalar(warning.code)}] ${sanitizeScalar(warning.message)}`);
  }
}

function pushFreshnessBoundedNote(lines: string[], list: WarmIndexReuseReportBoundedListV1<unknown>): void {
  if (list.omittedCount > 0) {
    lines.push(`Displayed: ${list.displayedCount} of ${list.totalCount}`);
    lines.push(`Omitted: ${list.omittedCount}`);
  }
}

/** Renders the persisted freshness counts and bounded evidence; hashes are never printed. */
function renderTaskFreshnessDetail(lines: string[], freshness: WarmIndexReuseReportFreshnessV1 | null | undefined): void {
  if (!freshness) return;
  lines.push(fieldLine("Baseline Snapshot Status", freshness.baselineSnapshotStatus));
  lines.push(fieldLine("Indexed Files", freshness.indexedFileCount));
  lines.push(fieldLine("Comparable Files", freshness.comparableFileCount));
  lines.push(fieldLine("Unchanged Files", freshness.unchangedFileCount));
  lines.push(fieldLine("Modified Files", freshness.changedFileCount));
  lines.push(fieldLine("Missing Files", freshness.missingFileCount));
  lines.push(fieldLine("Unresolved Comparisons", freshness.unresolvedFileCount));
  lines.push("Freshness Changes:");
  pushFreshnessBoundedNote(lines, freshness.changes);
  if (freshness.changes.items.length === 0) {
    lines.push("- none");
  }
  for (const change of freshness.changes.items) {
    lines.push(`- ${sanitizeScalar(change.changeType)} ${sanitizeScalar(change.path)}`);
  }
  lines.push("Freshness Unresolved Evidence:");
  pushFreshnessBoundedNote(lines, freshness.unresolved);
  if (freshness.unresolved.items.length === 0) {
    lines.push("- none");
  }
  for (const entry of freshness.unresolved.items) {
    lines.push(
      `- ${entry.path === null ? "run-level" : sanitizeScalar(entry.path)} [${sanitizeScalar(entry.reasonCode)}] ${sanitizeScalar(entry.message)}`
    );
  }
}

const INCREMENTAL_CHANGE_STALENESS_MAX_DISPLAY_ITEMS = 20;

function pushBoundedStringList(lines: string[], label: string, items: readonly string[]): void {
  lines.push(`${label}:`);
  if (items.length === 0) {
    lines.push("- none");
    return;
  }
  const shown = items.slice(0, INCREMENTAL_CHANGE_STALENESS_MAX_DISPLAY_ITEMS);
  for (const item of shown) lines.push(`- ${sanitizeScalar(item)}`);
  const omitted = items.length - shown.length;
  if (omitted > 0) lines.push(`... ${omitted} more`);
}

function symmetricIncrementalAffectedNeighborhood(scenario: IncrementalChangeStalenessReportScenarioV1) {
  const stale = scenario.staleTreatment?.affectedNeighborhood ?? null;
  const fullRefresh = scenario.fullRefreshTreatment?.affectedNeighborhood ?? null;
  if (!stale || !fullRefresh) return null;
  if (stale.relationship !== fullRefresh.relationship || stale.reindexRecommendation !== fullRefresh.reindexRecommendation) {
    return null;
  }
  return stale;
}

function renderIncrementalChangeStalenessTreatment(lines: string[], label: string, treatment: IncrementalChangeStalenessReportTreatmentV1 | null): void {
  pushSection(lines, label);
  if (!treatment) {
    lines.push("Not available.");
    return;
  }
  lines.push(fieldLine("Treatment Status", treatment.status));
  lines.push(fieldLine("Failure Reason", treatment.failureReason));
  lines.push(fieldLine("Active Index Phase", treatment.activeIndexPhase));
  lines.push(fieldLine("Baseline Freshness Status", treatment.baselineFreshness.status));
  lines.push("Retrieval (deterministic fake-agent / simulated harness evidence label applies to fakeAgent below):");
  lines.push(fieldLine("Retrieval Status", treatment.retrieval.status));
  lines.push(fieldLine("Selected Node ID", treatment.retrieval.selectedNodeId));
  lines.push(fieldLine("Selected File", treatment.retrieval.selectedFile));
  lines.push(fieldLine("Selected Symbol", treatment.retrieval.selectedSymbol));
  lines.push(fieldLine("Context Characters", treatment.retrieval.totalChars));
  lines.push(fieldLine("Estimated Context Tokens", treatment.retrieval.totalEstimatedTokens));
  lines.push(fieldLine("Retrieval Duration (ms)", treatment.retrieval.durationMs));
  pushBoundedStringList(lines, "Files Read", treatment.retrieval.filesRead);
  pushBoundedStringList(lines, "Retrieval Warnings", treatment.retrieval.warnings);
  lines.push("Fake-Agent Evidence (deterministic fake-agent / simulated harness evidence):");
  if (treatment.fakeAgent) {
    lines.push(fieldLine("Fake-Agent Status", treatment.fakeAgent.status));
    lines.push(
      fieldLine(
        "Correctness Score",
        treatment.fakeAgent.correctness.available ? treatment.fakeAgent.correctness.score : null
      )
    );
    lines.push(fieldLine("Passed", treatment.fakeAgent.correctness.passed));
    lines.push(fieldLine("Fake-Agent Duration (ms)", treatment.fakeAgent.durationMs));
  } else {
    lines.push("Not run for this treatment.");
  }
  lines.push("Required-File Evidence (bounded answer-key file-presence check, not retrieval precision/recall):");
  lines.push(fieldLine("Required-File Status", treatment.requiredFileEvidence.status));
  lines.push(fieldLine("Required-File Reason", treatment.requiredFileEvidence.reason));
  pushBoundedStringList(lines, "Required Files", treatment.requiredFileEvidence.requiredFiles);
  pushBoundedStringList(lines, "Observed Files", treatment.requiredFileEvidence.observedFiles);
  pushBoundedStringList(lines, "Missing Files", treatment.requiredFileEvidence.missingFiles);
}

function renderIncrementalChangeStalenessScenario(lines: string[], scenario: IncrementalChangeStalenessReportScenarioV1): void {
  pushSection(lines, `Scenario: ${scenario.scenarioId}`);
  lines.push(fieldLine("Category", scenario.category));
  lines.push(fieldLine("Status", scenario.status));
  lines.push(fieldLine("Failure Reason", scenario.failureReason));
  lines.push(fieldLine("Benchmark Project", scenario.benchmarkProjectId));
  lines.push(fieldLine("Base Case", scenario.baseCaseId));
  lines.push(fieldLine("Answer Policy", scenario.answerPolicy));
  lines.push(fieldLine("Query", scenario.query));
  pushBoundedStringList(lines, "Expected Files", scenario.expectedFiles);
  pushBoundedStringList(lines, "Expected Symbols", scenario.expectedSymbols);

  pushSection(lines, "Lifecycle");
  const lifecycle = scenario.lifecycle;
  if (!lifecycle) {
    lines.push("Not available.");
  } else {
    lines.push(fieldLine("Pre-Mutation Equivalence", lifecycle.preMutationEquivalence));
    lines.push(fieldLine("Post-Mutation Equivalence", lifecycle.postMutationEquivalence));
    lines.push(fieldLine("my-dev-kit Version", lifecycle.myDevKitVersion));
    lines.push(fieldLine("Stale Baseline Freshness Status", lifecycle.staleBaselineFreshnessStatus));
    lines.push(fieldLine("Full-Refresh Baseline Freshness Status", lifecycle.fullRefreshBaselineFreshnessStatus));
    lines.push(fieldLine("Full-Refresh Refreshed Freshness Status", lifecycle.fullRefreshRefreshedFreshnessStatus));
    pushBoundedStringList(lines, "Controlled File Paths", lifecycle.controlledFilePaths);
    pushBoundedStringList(lines, "Source Roots", lifecycle.sourceRoots);
  }

  pushSection(lines, "Affected-Neighborhood Evidence (changed baseline neighborhood relative to the task)");
  const symmetric = symmetricIncrementalAffectedNeighborhood(scenario);
  const bothPresent = scenario.staleTreatment?.affectedNeighborhood && scenario.fullRefreshTreatment?.affectedNeighborhood;
  if (!scenario.staleTreatment?.affectedNeighborhood && !scenario.fullRefreshTreatment?.affectedNeighborhood) {
    lines.push("Not available.");
  } else if (bothPresent && !symmetric) {
    lines.push("inconsistent persisted evidence");
  } else if (symmetric) {
    lines.push(fieldLine("Relationship", symmetric.relationship));
    lines.push(fieldLine("Reindex Recommendation", symmetric.reindexRecommendation));
    lines.push(fieldLine("Reindex Recommendation Explanation", REINDEX_RECOMMENDATION_EXPLANATIONS[symmetric.reindexRecommendation]));
    lines.push(fieldLine("Changed Indexed Files", symmetric.changedFileCount));
    lines.push(fieldLine("Changed Baseline Symbols", symmetric.changedSymbolCount));
    lines.push(fieldLine("Affected Graph Nodes", symmetric.affectedNodeCount));
    lines.push(fieldLine("Affected Graph Edges", symmetric.affectedEdgeCount));
    lines.push(fieldLine("Task-Overlap Nodes", symmetric.taskOverlapCount));
    lines.push(fieldLine("Task-Overlap Percent", symmetric.taskOverlapPercent));
  }

  renderIncrementalChangeStalenessTreatment(lines, "Stale-Index Treatment", scenario.staleTreatment);
  renderIncrementalChangeStalenessTreatment(lines, "Full-Refresh Treatment", scenario.fullRefreshTreatment);

  pushSection(lines, "Matched Comparison");
  lines.push(fieldLine("Correctness Relation", scenario.comparison.correctnessRelation));
  lines.push(fieldLine("Required-File Evidence Relation", scenario.comparison.requiredFileEvidenceRelation));
  lines.push(fieldLine("Stale-Risk Classification", scenario.comparison.staleRiskClassification));
  pushDashList(lines, scenario.comparison.reasonCodes);
  lines.push(STALE_RISK_CLASSIFICATION_EXPLANATIONS[scenario.comparison.staleRiskClassification]);
}

function renderIncrementalChangeStalenessSection(lines: string[], section: IncrementalChangeStalenessReportV1 | IncrementalChangeStalenessReportV2 | null): void {
  if (section === null) {
    lines.push("Not applicable to this plugin.");
    return;
  }
  if (isV2ReportSection(section)) {
    renderIncrementalChangeStalenessSectionV2(lines, section, { pushSection, fieldLine, pushDashList, pushBoundedStringList });
    return;
  }
  pushSection(lines, "Summary");
  lines.push(fieldLine("Scenarios", section.scenarioCount));
  lines.push(fieldLine("Ready", section.readyScenarioCount));
  lines.push(fieldLine("Failed", section.failedScenarioCount));
  lines.push(fieldLine("Observed Stale Regression", section.observedStaleRegressionCount));
  lines.push(fieldLine("No Observed Stale Regression", section.noObservedStaleRegressionCount));
  lines.push(fieldLine("Inconclusive", section.inconclusiveCount));

  for (const scenario of section.scenarios) {
    renderIncrementalChangeStalenessScenario(lines, scenario);
  }

  pushSection(lines, "Limitations");
  pushDashList(lines, section.limitations);
}

export function renderPluginExperimentReportText(report: PluginExperimentReport): string {
  const lines: string[] = [];

  pushSection(lines, "Plugin Experiment Report");

  pushSection(lines, "Report Metadata");
  lines.push(fieldLine("Generated At", report.metadata.generatedAt));
  lines.push(fieldLine("Run ID", report.metadata.runId));
  lines.push(fieldLine("Started At", report.metadata.startedAt));
  lines.push(fieldLine("Completed At", report.metadata.completedAt));
  lines.push(fieldLine("Status", report.metadata.status));
  lines.push(fieldLine("Output Root", report.metadata.outputRoot));

  pushSection(lines, "Plugin And Target");
  lines.push(fieldLine("Plugin ID", report.plugin.id));
  lines.push(fieldLine("Plugin Name", report.plugin.name));
  lines.push(fieldLine("Plugin Schema Version", report.plugin.schemaVersion));
  lines.push(fieldLine("Mode", report.target.mode));
  lines.push(fieldLine("Tool Root", report.target.toolRoot));
  lines.push(fieldLine("Target Root", report.target.targetRoot));

  pushSection(lines, "Interpretation");
  lines.push(fieldLine("Summary", report.interpretation.summary));
  lines.push(fieldLine("Recommended Next Step", report.interpretation.recommendedNextStep));

  pushSection(lines, "Variants");
  pushDashList(
    lines,
    report.variants.map(
      (variant) =>
        `${variant.name} (${variant.id}) completed=${variant.completedOutcomes} partial=${variant.partialOutcomes} failed=${variant.failedOutcomes} skipped=${variant.skippedOutcomes}`
    )
  );

  pushSection(lines, "Cases");
  pushDashList(
    lines,
    report.cases.map(
      (experimentCase) =>
        `${experimentCase.name} (${experimentCase.id}) status=${experimentCase.status} completed=${experimentCase.completedOutcomes} partial=${experimentCase.partialOutcomes} failed=${experimentCase.failedOutcomes} skipped=${experimentCase.skippedOutcomes}`
    )
  );

  pushSection(lines, "Metrics");
  pushDashList(
    lines,
    report.metrics.map(
      (metric) => `${metric.name} (${metric.id}) value=${metric.value ?? "unavailable"} unit=${metric.unit ?? ""}`
    )
  );

  pushSection(lines, "V0.4.3 Stage-Context Evidence");
  renderV043Section(lines, report.contextStrategyComparisonV043);

  pushSection(lines, "Warm Index Reuse Evidence");
  renderWarmIndexReuseSection(lines, report.warmIndexReuse);

  pushSection(lines, "Incremental-Change And Staleness Evidence");
  renderIncrementalChangeStalenessSection(lines, report.incrementalChangeStaleness);

  pushSection(lines, "Context Window Scaling");
  if (report.contextWindowScaling === null) {
    lines.push("Not applicable to this plugin.");
  } else {
    lines.push(...renderContextWindowScalingTextLines(report.contextWindowScaling));
  }

  pushSection(lines, "Retrieval Precision/Recall");
  const retrievalPrecisionRecall = report.retrievalPrecisionRecall ?? null;
  if (retrievalPrecisionRecall === null) {
    lines.push("Not applicable to this plugin.");
  } else {
    lines.push(...renderRetrievalPrecisionRecallTextLines(retrievalPrecisionRecall));
  }

  pushSection(lines, "Warnings, Skips, And Failures");
  pushDashList(
    lines,
    report.findings.map(
      (finding) => `${finding.severity} ${finding.code} ${finding.message} variant=${finding.variantId ?? ""} case=${finding.caseId ?? ""}`
    )
  );

  pushSection(lines, "Artifacts");
  pushDashList(
    lines,
    report.artifacts.map((artifact) => `${artifact.label} (${artifact.id}) kind=${artifact.kind} path=${artifact.path ?? ""}`)
  );

  return `${lines.join("\n")}\n`;
}
