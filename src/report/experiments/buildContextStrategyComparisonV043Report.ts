import type { ExperimentRun } from "../../experiments/index.js";
import type {
  ContextStrategyComparisonRun,
  LoadedContextArtifactPairV1,
  V043StageContextAssuranceRunRecordV1,
  V043StageContextEvaluationResultV1,
  V043StageContextRunAssuranceResultV1,
  V043StageContextStrategyExecutionIssue,
  V043StageContextStrategyExecutionResult,
  V043TargetImmutabilityComparisonV1,
  StageContextDeterminismResultV1,
} from "../../experiments/index.js";

type V043TargetMutationV1 = V043TargetImmutabilityComparisonV1["mutations"][number];
import type {
  StageContextCountMetricV1,
  StageContextExpectationMatchV1,
  StageContextObservedEvidenceV1,
  StageContextRatioMetricV1,
  StageContextResponsibilityMappingMetricV1,
  StageContextSizeMetricV1,
  StageContextStateComparisonV1,
  V043StageContextEvaluationMetricsV1,
} from "../../evaluation/stageContextMetrics/index.js";
import {
  V043_REPORT_DETAIL_LIMIT,
  type ContextStrategyComparisonV043ReportSummaryV1,
  type ContextStrategyComparisonV043ReportV1,
  type ContextStrategyComparisonV043StrategyReportV1,
  type V043BoundedReportListV1,
  type V043ReportArtifactMetadataV1,
  type V043ReportAssuranceSummaryV1,
  type V043ReportContextSizeV1,
  type V043ReportCountMetricV1,
  type V043ReportDeterminismV1,
  type V043ReportEvaluationSummaryV1,
  type V043ReportExecutionSummaryV1,
  type V043ReportExpectationMatchV1,
  type V043ReportIssueV1,
  type V043ReportMetricsV1,
  type V043ReportObservedEvidenceV1,
  type V043ReportRatioMetricV1,
  type V043ReportResponsibilityMappingV1,
  type V043ReportRunRecordV1,
  type V043ReportStateComparisonV1,
  type V043ReportTargetMutationV1,
} from "./contextStrategyComparisonV043ReportModel.js";

const INTERPRETATION_SUMMARY =
  "Stage-context strategies are reported independently using direct evidence, explicit availability states, target-immutability evidence, and repeated-run determinism. No composite ranking or winning strategy is calculated.";

const INTERPRETATION_LIMITATIONS: string[] = [
  "The published upstream artifacts do not expose considered-but-unselected reads.",
  "The published upstream artifacts do not expose unnecessary-read evidence.",
  "Estimated token counts use ceil(characterCount / 4) per source and are not provider telemetry.",
  "Unavailable and not-applicable values are distinct from zero.",
];

function boundItems<T>(source: readonly T[]): V043BoundedReportListV1<T> {
  const items = source.slice(0, V043_REPORT_DETAIL_LIMIT);
  return {
    totalCount: source.length,
    displayedCount: items.length,
    omittedCount: source.length - items.length,
    items,
  };
}

export function buildContextStrategyComparisonV043Report(
  run: ExperimentRun
): ContextStrategyComparisonV043ReportV1 | null {
  if (run.pluginId !== "context-strategy-comparison") return null;

  const candidate = run as Partial<ContextStrategyComparisonRun>;
  const executions = candidate.v043StageContextExecutions;
  const evaluations = candidate.v043StageContextEvaluations;
  const assurances = candidate.v043StageContextRunAssurance;

  if (executions === undefined && evaluations === undefined && assurances === undefined) {
    return null;
  }

  if (!Array.isArray(executions) || !Array.isArray(evaluations) || !Array.isArray(assurances)) {
    throw new Error("Invalid v0.4.3 report source: execution, evaluation, and assurance arrays are inconsistent.");
  }

  if (executions.length !== evaluations.length || executions.length !== assurances.length) {
    throw new Error("Invalid v0.4.3 report source: execution, evaluation, and assurance arrays are inconsistent.");
  }

  for (let index = 0; index < executions.length; index += 1) {
    const ids = [
      executions[index].strategyId,
      evaluations[index].strategyId,
      assurances[index].strategyId,
    ].filter((id) => id !== null && id !== undefined);
    const distinct = new Set(ids);
    if (distinct.size > 1) {
      throw new Error("Invalid v0.4.3 report source: execution, evaluation, and assurance arrays are inconsistent.");
    }
  }

  const strategies = executions.map((execution, index) =>
    buildStrategyReport(execution, evaluations[index], assurances[index])
  );

  return {
    schemaVersion: "1.0.0",
    detailLimit: V043_REPORT_DETAIL_LIMIT,
    summary: buildSummary(executions, evaluations, assurances),
    strategies,
    interpretation: {
      summary: INTERPRETATION_SUMMARY,
      limitations: [...INTERPRETATION_LIMITATIONS],
    },
  };
}

function buildSummary(
  executions: V043StageContextStrategyExecutionResult[],
  evaluations: V043StageContextEvaluationResultV1[],
  assurances: V043StageContextRunAssuranceResultV1[]
): ContextStrategyComparisonV043ReportSummaryV1 {
  return {
    strategyCount: executions.length,
    completedExecutionCount: executions.filter((e) => e.status === "completed").length,
    invalidInputExecutionCount: executions.filter((e) => e.status === "invalid-input").length,
    failedExecutionCount: executions.filter((e) => e.status === "failed").length,
    completedEvaluationCount: evaluations.filter((e) => e.status === "completed").length,
    notApplicableEvaluationCount: evaluations.filter((e) => e.status === "not-applicable").length,
    failedEvaluationCount: evaluations.filter((e) => e.status === "failed").length,
    passedAssuranceCount: assurances.filter((a) => a.status === "passed").length,
    failedAssuranceCount: assurances.filter((a) => a.status === "failed").length,
    notApplicableAssuranceCount: assurances.filter((a) => a.status === "not-applicable").length,
  };
}

function buildStrategyReport(
  execution: V043StageContextStrategyExecutionResult,
  evaluation: V043StageContextEvaluationResultV1,
  assurance: V043StageContextRunAssuranceResultV1
): ContextStrategyComparisonV043StrategyReportV1 {
  return {
    strategyId: assurance.strategyId,
    artifacts: buildArtifactMetadata(execution),
    execution: buildExecutionSummary(execution),
    evaluation: buildEvaluationSummary(evaluation),
    assurance: buildAssuranceSummary(assurance),
  };
}

function buildExecutionSummary(execution: V043StageContextStrategyExecutionResult): V043ReportExecutionSummaryV1 {
  if (execution.status === "completed") {
    return { status: "completed", issues: boundItems([]) };
  }
  const issues = execution.issues.map(buildIssueFromExecutionIssue);
  return { status: execution.status, issues: boundItems(issues) };
}

function buildIssueFromExecutionIssue(issue: V043StageContextStrategyExecutionIssue): V043ReportIssueV1 {
  return {
    code: issue.code,
    fieldPath: issue.fieldPath ?? null,
    message: issue.message,
    runNumber: null,
  };
}

function buildArtifactMetadata(
  execution: V043StageContextStrategyExecutionResult
): V043BoundedReportListV1<V043ReportArtifactMetadataV1> {
  if (execution.status !== "completed") {
    return boundItems([]);
  }
  const entries: V043ReportArtifactMetadataV1[] = [];
  entries.push({
    sourceInstance: "expectations",
    artifactKind: "expectation-fixture",
    sourcePath: execution.expectationsSourcePath,
    schemaVersion: execution.expectations.schemaVersion,
    generatedAt: null,
    producerName: null,
    producerVersion: null,
    role: null,
    workflowId: null,
    stageId: null,
    catalogSchemaVersion: null,
    catalogVersion: null,
    fixtureId: null,
    caseId: execution.expectations.caseId,
    title: execution.expectations.title,
  });

  const payload = execution.payload as unknown as Record<string, unknown>;

  if ("contextArtifacts" in payload) {
    const contextArtifacts = payload.contextArtifacts as LoadedContextArtifactPairV1[];
    contextArtifacts.forEach((pair, index) => {
      entries.push(...buildContextArtifactPairMetadata(pair, `contextArtifacts[${index}]`));
    });
    entries.push(
      buildWorkflowInstructionPacketMetadata(
        payload.workflowInstructionPacketSourcePath as string,
        payload.workflowInstructionPacket as Record<string, unknown>
      )
    );
  } else if ("fullWorkflowLibrary" in payload) {
    entries.push(
      buildFullWorkflowLibraryMetadata(
        payload.fullWorkflowLibrarySourcePath as string,
        payload.fullWorkflowLibrary as Record<string, unknown>
      )
    );
  } else if ("workflowInstructionPacket" in payload) {
    entries.push(
      buildWorkflowInstructionPacketMetadata(
        payload.workflowInstructionPacketSourcePath as string,
        payload.workflowInstructionPacket as Record<string, unknown>
      )
    );
  } else if ("testImplementation" in payload) {
    entries.push(...buildContextArtifactPairMetadata(payload.architecture as LoadedContextArtifactPairV1, "architecture"));
    entries.push(...buildContextArtifactPairMetadata(payload.implementation as LoadedContextArtifactPairV1, "implementation"));
    entries.push(
      ...buildContextArtifactPairMetadata(payload.testImplementation as LoadedContextArtifactPairV1, "testImplementation")
    );
  } else if ("implementation" in payload) {
    entries.push(...buildContextArtifactPairMetadata(payload.architecture as LoadedContextArtifactPairV1, "architecture"));
    entries.push(...buildContextArtifactPairMetadata(payload.implementation as LoadedContextArtifactPairV1, "implementation"));
  } else if ("architecture" in payload) {
    entries.push(...buildContextArtifactPairMetadata(payload.architecture as LoadedContextArtifactPairV1, "architecture"));
  }

  return boundItems(entries);
}

function buildContextArtifactPairMetadata(
  pair: LoadedContextArtifactPairV1,
  sourceInstancePrefix: string
): V043ReportArtifactMetadataV1[] {
  const entries: V043ReportArtifactMetadataV1[] = [
    {
      sourceInstance: `${sourceInstancePrefix}.contextCapsule`,
      artifactKind: "context-capsule",
      sourcePath: pair.contextCapsuleSourcePath,
      schemaVersion: pair.contextCapsule.schemaVersion,
      generatedAt: pair.contextCapsule.generatedAt,
      producerName: pair.contextCapsule.tool.name,
      producerVersion: pair.contextCapsule.tool.version,
      role: pair.contextCapsule.request.role,
      workflowId: null,
      stageId: null,
      catalogSchemaVersion: null,
      catalogVersion: null,
      fixtureId: null,
      caseId: null,
      title: null,
    },
  ];
  if (pair.retrievalAuditRecord) {
    entries.push({
      sourceInstance: `${sourceInstancePrefix}.retrievalAuditRecord`,
      artifactKind: "retrieval-audit-record",
      sourcePath: pair.retrievalAuditRecordSourcePath ?? "",
      schemaVersion: pair.retrievalAuditRecord.schemaVersion,
      generatedAt: pair.retrievalAuditRecord.generatedAt,
      producerName: pair.retrievalAuditRecord.tool.name,
      producerVersion: pair.retrievalAuditRecord.tool.version,
      role: pair.retrievalAuditRecord.request.role,
      workflowId: null,
      stageId: null,
      catalogSchemaVersion: null,
      catalogVersion: null,
      fixtureId: null,
      caseId: null,
      title: null,
    });
  }
  return entries;
}

function buildWorkflowInstructionPacketMetadata(
  sourcePath: string,
  packet: Record<string, unknown>
): V043ReportArtifactMetadataV1 {
  return {
    sourceInstance: "workflowInstructionPacket",
    artifactKind: "workflow-instruction-packet",
    sourcePath,
    schemaVersion: packet.schemaVersion as string,
    generatedAt: null,
    producerName: null,
    producerVersion: null,
    role: null,
    workflowId: packet.workflowId as string,
    stageId: packet.stageId as string,
    catalogSchemaVersion: packet.catalogSchemaVersion as string,
    catalogVersion: packet.catalogVersion as string,
    fixtureId: null,
    caseId: null,
    title: null,
  };
}

function buildFullWorkflowLibraryMetadata(
  sourcePath: string,
  library: Record<string, unknown>
): V043ReportArtifactMetadataV1 {
  return {
    sourceInstance: "fullWorkflowLibrary",
    artifactKind: "full-workflow-library",
    sourcePath,
    schemaVersion: library.schemaVersion as string,
    generatedAt: null,
    producerName: null,
    producerVersion: null,
    role: null,
    workflowId: null,
    stageId: null,
    catalogSchemaVersion: null,
    catalogVersion: null,
    fixtureId: library.fixtureId as string,
    caseId: null,
    title: library.title as string,
  };
}

function buildEvaluationSummary(evaluation: V043StageContextEvaluationResultV1): V043ReportEvaluationSummaryV1 {
  if (evaluation.status !== "completed") {
    return {
      status: evaluation.status,
      reason: evaluation.reason,
      warnings: boundItems([]),
      expectationMatches: boundItems([]),
      observedEvidence: boundItems([]),
      metrics: null,
    };
  }
  return {
    status: "completed",
    reason: null,
    warnings: boundItems(evaluation.warnings),
    expectationMatches: boundItems(evaluation.expectationMatches.map(buildExpectationMatch)),
    observedEvidence: boundItems(evaluation.observedEvidence.map(buildObservedEvidence)),
    metrics: buildMetrics(evaluation.metrics),
  };
}

function buildExpectationMatch(match: StageContextExpectationMatchV1): V043ReportExpectationMatchV1 {
  return {
    expectationId: match.expectationId,
    inclusion: match.inclusion,
    sourceArtifact: match.sourceArtifact,
    category: match.category,
    targetKey: match.targetKey,
    outcome: match.outcome,
    matchedSourceInstances: match.matchedSourceInstances,
    matchedSourceFieldPaths: match.matchedSourceFieldPaths,
  };
}

function buildObservedEvidence(evidence: StageContextObservedEvidenceV1): V043ReportObservedEvidenceV1 {
  return {
    sourceArtifact: evidence.sourceArtifact,
    sourceInstance: evidence.sourceInstance,
    category: evidence.category,
    targetKey: evidence.targetKey,
    sourceFieldPath: evidence.sourceFieldPath,
  };
}

function buildMetrics(metrics: V043StageContextEvaluationMetricsV1): V043ReportMetricsV1 {
  return {
    requiredEvidenceRecall: buildRatioMetric(metrics.requiredEvidenceRecall),
    allowedEvidenceCoverage: buildRatioMetric(metrics.allowedEvidenceCoverage),
    forbiddenEvidenceInclusion: buildRatioMetric(metrics.forbiddenEvidenceInclusion),
    irrelevantFileInclusion: buildCountMetric(metrics.irrelevantFileInclusion),
    irrelevantInstructionInclusion: buildCountMetric(metrics.irrelevantInstructionInclusion),
    requiredProvenanceRecall: buildRatioMetric(metrics.requiredProvenanceRecall),
    responsibilityMappingCompleteness: boundItems(
      metrics.responsibilityMappingCompleteness.map(buildResponsibilityMapping)
    ),
    stateComparisons: boundItems(metrics.stateComparisons.map(buildStateComparison)),
    contextSize: buildContextSize(metrics.contextSize),
    consideredButUnselectedReads: buildCountMetric(metrics.consideredButUnselectedReads),
    unnecessaryReads: buildCountMetric(metrics.unnecessaryReads),
    targetImmutability: buildCountMetric(metrics.targetImmutability),
  };
}

function buildRatioMetric(metric: StageContextRatioMetricV1): V043ReportRatioMetricV1 {
  return {
    availability: metric.availability,
    numerator: metric.numerator,
    denominator: metric.denominator,
    rate: metric.rate,
    matchedExpectationIds: boundItems(metric.matchedExpectationIds),
    missingExpectationIds: boundItems(metric.missingExpectationIds),
    reason: metric.reason,
  };
}

function buildCountMetric(metric: StageContextCountMetricV1): V043ReportCountMetricV1 {
  return {
    availability: metric.availability,
    count: metric.count,
    evidenceKeys: boundItems(metric.evidenceKeys),
    reason: metric.reason,
  };
}

function buildResponsibilityMapping(
  mapping: StageContextResponsibilityMappingMetricV1
): V043ReportResponsibilityMappingV1 {
  return {
    sourceArtifact: mapping.sourceArtifact,
    sourceInstance: mapping.sourceInstance,
    requested: mapping.requested,
    operational: mapping.operational,
    mappedCount: mapping.mappedCount,
    partiallyMappedCount: mapping.partiallyMappedCount,
    unmappedCount: mapping.unmappedCount,
    notApplicableCount: mapping.notApplicableCount,
    denominator: mapping.denominator,
    mappedRate: mapping.mappedRate,
  };
}

function buildStateComparison(comparison: StageContextStateComparisonV1): V043ReportStateComparisonV1 {
  return {
    sourceArtifact: comparison.sourceArtifact,
    sourceInstance: comparison.sourceInstance,
    expectationFieldPath: comparison.expectationFieldPath,
    artifactFieldPath: comparison.artifactFieldPath,
    availability: comparison.availability,
    expected: comparison.expected,
    actual: comparison.actual,
    matched: comparison.matched,
    reason: comparison.reason,
  };
}

function buildContextSize(size: StageContextSizeMetricV1): V043ReportContextSizeV1 {
  return {
    sources: boundItems(
      size.sources.map((source) => ({
        sourceInstance: source.sourceInstance,
        sourceKind: source.sourceKind,
        characterCount: source.characterCount,
        estimatedTokenCount: source.estimatedTokenCount,
      }))
    ),
    totalCharacterCount: size.totalCharacterCount,
    totalEstimatedTokenCount: size.totalEstimatedTokenCount,
    tokenEstimateFormula: "ceil(characterCount / 4) per source",
  };
}

function buildAssuranceSummary(assurance: V043StageContextRunAssuranceResultV1): V043ReportAssuranceSummaryV1 {
  return {
    status: assurance.status,
    repeatCount: assurance.repeatCount,
    runRecords: boundItems(assurance.runRecords.map(buildRunRecord)),
    determinism: buildDeterminism(assurance.determinism),
    issues: boundItems(
      assurance.issues.map((issue) => ({
        code: issue.code,
        fieldPath: issue.fieldPath,
        message: issue.message,
        runNumber: issue.runNumber,
      }))
    ),
  };
}

function buildRunRecord(record: V043StageContextAssuranceRunRecordV1): V043ReportRunRecordV1 {
  const targetImmutability = record.targetImmutability;
  if (targetImmutability.availability === "available") {
    return {
      runNumber: record.runNumber,
      executionStatus: record.executionStatus,
      evaluationStatus: record.evaluationStatus,
      targetImmutabilityAvailability: "available",
      targetImmutabilityStatus: targetImmutability.comparison.status,
      newMutationCount: targetImmutability.comparison.newMutationCount,
      targetImmutabilityReason: null,
      mutations: boundItems(targetImmutability.comparison.mutations.map(buildTargetMutation)),
    };
  }
  return {
    runNumber: record.runNumber,
    executionStatus: record.executionStatus,
    evaluationStatus: record.evaluationStatus,
    targetImmutabilityAvailability: "unavailable",
    targetImmutabilityStatus: null,
    newMutationCount: null,
    targetImmutabilityReason: targetImmutability.reason,
    mutations: boundItems([]),
  };
}

function buildTargetMutation(mutation: V043TargetMutationV1): V043ReportTargetMutationV1 {
  return {
    id: mutation.id,
    kind: mutation.kind,
    fieldPath: mutation.fieldPath,
    before: mutation.before,
    after: mutation.after,
  };
}

function buildDeterminism(determinism: StageContextDeterminismResultV1): V043ReportDeterminismV1 {
  return {
    availability: determinism.availability,
    repeatCount: determinism.repeatCount,
    deterministic: determinism.deterministic,
    baselineSha256: determinism.baselineSha256,
    runDigests: boundItems(determinism.runDigests.map((digest) => ({ runNumber: digest.runNumber, sha256: digest.sha256 }))),
    mismatchRunNumbers: [...determinism.mismatchRunNumbers],
    reason: determinism.reason,
  };
}
