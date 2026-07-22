import { describe, expect, it } from "vitest";
import {
  V043_REPORT_DETAIL_LIMIT,
  type ContextStrategyComparisonV043ReportV1,
  type V043ReportArtifactMetadataV1,
  type V043ReportAssuranceSummaryV1,
  type V043ReportContextSizeV1,
  type V043ReportCountMetricV1,
  type V043ReportIssueV1,
  type V043ReportRatioMetricV1,
  type V043ReportRunRecordV1,
  type V043ReportStateComparisonV1,
  type V043ReportTargetMutationV1,
} from "../../../src/report/experiments/contextStrategyComparisonV043ReportModel.js";

describe("contextStrategyComparisonV043ReportModel", () => {
  it("RPT-001 the detail limit equals 100", () => {
    expect(V043_REPORT_DETAIL_LIMIT).toBe(100);
  });

  it("RPT-002 the report schema version is 1.0.0", () => {
    const report: ContextStrategyComparisonV043ReportV1 = {
      schemaVersion: "1.0.0",
      detailLimit: 100,
      summary: {
        strategyCount: 0,
        completedExecutionCount: 0,
        invalidInputExecutionCount: 0,
        failedExecutionCount: 0,
        completedEvaluationCount: 0,
        notApplicableEvaluationCount: 0,
        failedEvaluationCount: 0,
        passedAssuranceCount: 0,
        failedAssuranceCount: 0,
        notApplicableAssuranceCount: 0,
      },
      strategies: [],
      interpretation: { summary: "s", limitations: [] },
    };
    expect(report.schemaVersion).toBe("1.0.0");
  });

  it("RPT-003 the report model has no composite-score field", () => {
    const summaryKeys = [
      "strategyCount",
      "completedExecutionCount",
      "invalidInputExecutionCount",
      "failedExecutionCount",
      "completedEvaluationCount",
      "notApplicableEvaluationCount",
      "failedEvaluationCount",
      "passedAssuranceCount",
      "failedAssuranceCount",
      "notApplicableAssuranceCount",
    ];
    expect(summaryKeys.some((key) => /score/i.test(key))).toBe(false);
  });

  it("RPT-004 the report model has no grade field", () => {
    const reportKeys: (keyof ContextStrategyComparisonV043ReportV1)[] = [
      "schemaVersion",
      "detailLimit",
      "summary",
      "strategies",
      "interpretation",
    ];
    expect(reportKeys.some((key) => /grade/i.test(String(key)))).toBe(false);
  });

  it("RPT-005 the report model has no rank field", () => {
    const reportKeys: (keyof ContextStrategyComparisonV043ReportV1)[] = [
      "schemaVersion",
      "detailLimit",
      "summary",
      "strategies",
      "interpretation",
    ];
    expect(reportKeys.some((key) => /rank/i.test(String(key)))).toBe(false);
  });

  it("RPT-006 the report model has no winner field", () => {
    const reportKeys: (keyof ContextStrategyComparisonV043ReportV1)[] = [
      "schemaVersion",
      "detailLimit",
      "summary",
      "strategies",
      "interpretation",
    ];
    expect(reportKeys.some((key) => /winner/i.test(String(key)))).toBe(false);
  });

  it("RPT-007 ratio metrics preserve available, unavailable, and not-applicable", () => {
    const available: V043ReportRatioMetricV1["availability"] = "available";
    const unavailable: V043ReportRatioMetricV1["availability"] = "unavailable";
    const notApplicable: V043ReportRatioMetricV1["availability"] = "not-applicable";
    expect([available, unavailable, notApplicable]).toEqual(["available", "unavailable", "not-applicable"]);
  });

  it("RPT-008 count metrics preserve available, unavailable, and not-applicable", () => {
    const available: V043ReportCountMetricV1["availability"] = "available";
    const unavailable: V043ReportCountMetricV1["availability"] = "unavailable";
    const notApplicable: V043ReportCountMetricV1["availability"] = "not-applicable";
    expect([available, unavailable, notApplicable]).toEqual(["available", "unavailable", "not-applicable"]);
  });

  it("RPT-009 state comparisons preserve exact artifactFieldPath", () => {
    const comparison: V043ReportStateComparisonV1 = {
      sourceArtifact: "context-capsule",
      sourceInstance: "architecture.contextCapsule",
      expectationFieldPath: "expectedStates.contextCapsule.freshnessState",
      artifactFieldPath: "freshness.state",
      availability: "available",
      expected: "fresh",
      actual: "fresh",
      matched: true,
      reason: null,
    };
    expect(comparison.artifactFieldPath).toBe("freshness.state");
  });

  it("RPT-010 context-size token formula label is exact", () => {
    const size: V043ReportContextSizeV1 = {
      sources: { totalCount: 0, displayedCount: 0, omittedCount: 0, items: [] },
      totalCharacterCount: 0,
      totalEstimatedTokenCount: 0,
      tokenEstimateFormula: "ceil(characterCount / 4) per source",
    };
    expect(size.tokenEstimateFormula).toBe("ceil(characterCount / 4) per source");
  });

  it("RPT-011 target mutations do not contain file-content fields", () => {
    const mutation: V043ReportTargetMutationV1 = {
      id: "git.head",
      kind: "git-head",
      fieldPath: "git.head",
      before: "a",
      after: "b",
    };
    expect(Object.keys(mutation).sort()).toEqual(["after", "before", "fieldPath", "id", "kind"]);
  });

  it("RPT-012 execution report issues do not contain details", () => {
    const issue: V043ReportIssueV1 = {
      code: "INVALID_STRATEGY_INPUT",
      fieldPath: "input.strategyId",
      message: "invalid",
      runNumber: null,
    };
    expect(Object.keys(issue).sort()).toEqual(["code", "fieldPath", "message", "runNumber"]);
  });

  it("RPT-013 assurance report issues do not contain details", () => {
    const issue: V043ReportIssueV1 = {
      code: "TARGET_MUTATION_DETECTED",
      fieldPath: "runs[1].targetImmutability.git.head",
      message: "mutated",
      runNumber: 1,
    };
    expect(Object.keys(issue).sort()).toEqual(["code", "fieldPath", "message", "runNumber"]);
  });

  it("RPT-014 artifact metadata contains no raw artifact field", () => {
    const metadata: V043ReportArtifactMetadataV1 = {
      sourceInstance: "architecture.contextCapsule",
      artifactKind: "context-capsule",
      sourcePath: "mock/architecture-capsule.json",
      schemaVersion: "1.0.0",
      generatedAt: "2026-06-23T00:00:00.000Z",
      producerName: "my-dev-kit",
      producerVersion: "1.10.2",
      role: "architecture",
      workflowId: null,
      stageId: null,
      catalogSchemaVersion: null,
      catalogVersion: null,
      fixtureId: null,
      caseId: null,
      title: null,
    };
    expect(Object.keys(metadata)).not.toContain("requiredContext");
    expect(Object.keys(metadata)).not.toContain("candidateFiles");
  });

  it("RPT-015 run records contain no complete execution object", () => {
    const runRecord: V043ReportRunRecordV1 = {
      runNumber: 1,
      executionStatus: "completed",
      evaluationStatus: "completed",
      targetImmutabilityAvailability: "available",
      targetImmutabilityStatus: "unchanged",
      newMutationCount: 0,
      targetImmutabilityReason: null,
      mutations: { totalCount: 0, displayedCount: 0, omittedCount: 0, items: [] },
    };
    expect(Object.keys(runRecord)).not.toContain("input");
    expect(Object.keys(runRecord)).not.toContain("payload");
  });

  it("RPT-016 run records contain no complete evaluation object", () => {
    const runRecord: V043ReportRunRecordV1 = {
      runNumber: 1,
      executionStatus: "completed",
      evaluationStatus: "completed",
      targetImmutabilityAvailability: "available",
      targetImmutabilityStatus: "unchanged",
      newMutationCount: 0,
      targetImmutabilityReason: null,
      mutations: { totalCount: 0, displayedCount: 0, omittedCount: 0, items: [] },
    };
    expect(Object.keys(runRecord)).not.toContain("metrics");
    expect(Object.keys(runRecord)).not.toContain("expectationMatches");
  });

  it("assurance summary model has status, repeatCount, runRecords, determinism, issues", () => {
    const assurance: V043ReportAssuranceSummaryV1 = {
      status: "passed",
      repeatCount: 1,
      runRecords: { totalCount: 0, displayedCount: 0, omittedCount: 0, items: [] },
      determinism: {
        availability: "not-applicable",
        repeatCount: 1,
        deterministic: null,
        baselineSha256: null,
        runDigests: { totalCount: 0, displayedCount: 0, omittedCount: 0, items: [] },
        mismatchRunNumbers: [],
        reason: "Repeated-run determinism requires at least two runs.",
      },
      issues: { totalCount: 0, displayedCount: 0, omittedCount: 0, items: [] },
    };
    expect(Object.keys(assurance).sort()).toEqual(["determinism", "issues", "repeatCount", "runRecords", "status"]);
  });
});
