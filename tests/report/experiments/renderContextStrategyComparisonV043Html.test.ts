import { describe, expect, it } from "vitest";
import { renderContextStrategyComparisonV043Html } from "../../../src/report/experiments/renderContextStrategyComparisonV043Html.js";
import { renderPluginExperimentReportHtml } from "../../../src/report/experiments/renderPluginExperimentReportHtml.js";
import type { PluginExperimentReport } from "../../../src/report/experiments/experimentReportModel.js";
import type {
  ContextStrategyComparisonV043ReportV1,
  ContextStrategyComparisonV043StrategyReportV1,
} from "../../../src/report/experiments/contextStrategyComparisonV043ReportModel.js";

function boundedList<T>(items: T[], totalCount?: number) {
  const total = totalCount ?? items.length;
  return { totalCount: total, displayedCount: items.length, omittedCount: total - items.length, items };
}

function baseStrategy(overrides: Partial<ContextStrategyComparisonV043StrategyReportV1> = {}): ContextStrategyComparisonV043StrategyReportV1 {
  return {
    strategyId: "architecture-context-only",
    artifacts: boundedList([
      {
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
      },
    ]),
    execution: {
      status: "completed",
      issues: boundedList([{ code: "SOME_ISSUE", fieldPath: "input.strategyId", message: "<script>alert(1)</script>", runNumber: null }]),
    },
    evaluation: {
      status: "completed",
      reason: null,
      warnings: boundedList([]),
      expectationMatches: boundedList([
        {
          expectationId: "exp-1",
          inclusion: "required",
          sourceArtifact: "context-capsule",
          category: "file",
          targetKey: "src/a.ts",
          outcome: "matched",
          matchedSourceInstances: ["architecture.contextCapsule"],
          matchedSourceFieldPaths: ["requiredContext[0].path"],
        },
      ]),
      observedEvidence: boundedList([
        {
          sourceArtifact: "context-capsule",
          sourceInstance: "architecture.contextCapsule",
          category: "file",
          targetKey: "src/a.ts",
          sourceFieldPath: "requiredContext[0].path",
        },
      ]),
      metrics: {
        requiredEvidenceRecall: {
          availability: "available",
          numerator: 1,
          denominator: 1,
          rate: 1,
          matchedExpectationIds: boundedList(["exp-1"]),
          missingExpectationIds: boundedList([]),
          reason: null,
        },
        allowedEvidenceCoverage: {
          availability: "available",
          numerator: 1,
          denominator: 1,
          rate: 1,
          matchedExpectationIds: boundedList([]),
          missingExpectationIds: boundedList([]),
          reason: null,
        },
        forbiddenEvidenceInclusion: {
          availability: "not-applicable",
          numerator: null,
          denominator: null,
          rate: null,
          matchedExpectationIds: boundedList([]),
          missingExpectationIds: boundedList([]),
          reason: "No forbidden evidence was expected.",
        },
        irrelevantFileInclusion: { availability: "available", count: 0, evidenceKeys: boundedList([]), reason: null },
        irrelevantInstructionInclusion: { availability: "available", count: 0, evidenceKeys: boundedList([]), reason: null },
        requiredProvenanceRecall: {
          availability: "unavailable",
          numerator: null,
          denominator: null,
          rate: null,
          matchedExpectationIds: boundedList([]),
          missingExpectationIds: boundedList([]),
          reason: "Provenance unavailable.",
        },
        responsibilityMappingCompleteness: boundedList([
          {
            sourceArtifact: "context-capsule",
            sourceInstance: "architecture.contextCapsule",
            requested: true,
            operational: true,
            mappedCount: 1,
            partiallyMappedCount: 0,
            unmappedCount: 0,
            notApplicableCount: 0,
            denominator: 1,
            mappedRate: 1,
          },
        ]),
        stateComparisons: boundedList([
          {
            sourceArtifact: "context-capsule",
            sourceInstance: "architecture.contextCapsule",
            expectationFieldPath: "expectedStates.contextCapsule.freshnessState",
            artifactFieldPath: "freshness.state",
            availability: "available",
            expected: "fresh",
            actual: "fresh",
            matched: true,
            reason: null,
          },
        ]),
        contextSize: {
          sources: boundedList([{ sourceInstance: "architecture.contextCapsule", sourceKind: "context-capsule", characterCount: 400, estimatedTokenCount: 100 }]),
          totalCharacterCount: 400,
          totalEstimatedTokenCount: 100,
          tokenEstimateFormula: "ceil(characterCount / 4) per source",
        },
        consideredButUnselectedReads: {
          availability: "unavailable",
          count: null,
          evidenceKeys: boundedList([]),
          reason: "The published upstream artifacts do not expose considered-but-unselected reads.",
        },
        unnecessaryReads: {
          availability: "unavailable",
          count: null,
          evidenceKeys: boundedList([]),
          reason: "The published upstream artifacts do not expose unnecessary-read evidence.",
        },
        targetImmutability: {
          availability: "unavailable",
          count: null,
          evidenceKeys: boundedList([]),
          reason: "Target immutability configuration was not supplied for this strategy run.",
        },
      },
    },
    assurance: {
      status: "not-applicable",
      repeatCount: 1,
      runRecords: boundedList([
        {
          runNumber: 1,
          executionStatus: "completed",
          evaluationStatus: "completed",
          targetImmutabilityAvailability: "available",
          targetImmutabilityStatus: "mutated",
          newMutationCount: 1,
          targetImmutabilityReason: null,
          mutations: boundedList([
            { id: "git.head", kind: "git-head", fieldPath: "git.head", before: "<img src=x onerror=alert(1)>", after: "def456" },
          ]),
        },
      ]),
      determinism: {
        availability: "not-applicable",
        repeatCount: 1,
        deterministic: null,
        baselineSha256: null,
        runDigests: boundedList([]),
        mismatchRunNumbers: [],
        reason: "Repeated-run determinism requires at least two runs.",
      },
      issues: boundedList([{ code: "TARGET_MUTATION_DETECTED", fieldPath: "runs[1].targetImmutability.git.head", message: "mutation \"detected\"", runNumber: 1 }]),
    },
    ...overrides,
  };
}

function baseV043Report(overrides: Partial<ContextStrategyComparisonV043ReportV1> = {}): ContextStrategyComparisonV043ReportV1 {
  return {
    schemaVersion: "1.0.0",
    detailLimit: 100,
    summary: {
      strategyCount: 1,
      completedExecutionCount: 1,
      invalidInputExecutionCount: 0,
      failedExecutionCount: 0,
      completedEvaluationCount: 1,
      notApplicableEvaluationCount: 0,
      failedEvaluationCount: 0,
      passedAssuranceCount: 0,
      failedAssuranceCount: 0,
      notApplicableAssuranceCount: 1,
    },
    strategies: [baseStrategy()],
    interpretation: {
      summary: "Stage-context strategies are reported independently.",
      limitations: ["Limitation one.", "Limitation two."],
    },
    ...overrides,
  };
}

function baseReport(overrides: Partial<PluginExperimentReport> = {}): PluginExperimentReport {
  return {
    metadata: {
      generatedAt: "2026-06-23T00:00:00.000Z",
      runId: "context-run",
      startedAt: "2026-06-23T00:00:00.000Z",
      completedAt: "2026-06-23T00:00:01.000Z",
      status: "completed",
      outputRoot: "lab-output/context-run",
    },
    plugin: {
      id: "context-strategy-comparison",
      name: "Context Strategy Comparison",
      description: "Compares strategies.",
      schemaVersion: "1.0.0",
      status: "stable",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "html", "text"],
    },
    target: {
      kind: "external-local",
      targetRoot: "Z:\\Projects\\one",
      toolRoot: "Z:\\Users\\newuser\\Projects\\my-dev-kit-lab",
      packageName: "@dailephd/my-dev-kit",
      packageVersion: "1.10.2",
      hasPackageJson: true,
      hasLockfile: true,
      branch: "main",
      commit: "abc1234",
      hasGit: true,
      isSelf: false,
      mode: "external target",
    },
    summary: null,
    variants: [],
    cases: [],
    metrics: [],
    artifacts: [],
    warnings: [],
    failures: [],
    skippedOutcomes: [],
    findings: [],
    contextStrategyComparisonV043: null,
    interpretation: { summary: "summary", recommendedNextStep: "next step" },
    rawRun: {} as PluginExperimentReport["rawRun"],
    ...overrides,
  };
}

describe("renderContextStrategyComparisonV043Html", () => {
  it("RPT-120 a null section renders not applicable", () => {
    const html = renderContextStrategyComparisonV043Html(null);
    expect(html).toContain("Not applicable to this plugin.");
  });

  it("RPT-121 a zero-strategy section renders the exact empty state", () => {
    const html = renderContextStrategyComparisonV043Html(
      baseV043Report({
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
      })
    );
    expect(html).toContain("No v0.4.3 stage-context strategies were selected.");
  });

  it("RPT-122 summary counts render", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("<td>1</td>");
  });

  it("RPT-123 strategies render in source order", () => {
    const html = renderContextStrategyComparisonV043Html(
      baseV043Report({
        strategies: [
          baseStrategy({ strategyId: "bounded-workflow-instruction-packet" }),
          baseStrategy({ strategyId: "architecture-context-only" }),
        ],
      })
    );
    const firstIndex = html.indexOf("bounded-workflow-instruction-packet");
    const secondIndex = html.indexOf("architecture-context-only");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("RPT-124 artifact metadata renders", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("architecture.contextCapsule");
    expect(html).toContain("mock/architecture-capsule.json");
  });

  it("RPT-125 execution issues render", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("SOME_ISSUE");
  });

  it("RPT-126 expectation matches render", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("exp-1");
  });

  it("RPT-127 observed evidence renders", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("requiredContext[0].path");
  });

  it("RPT-128 state comparisons render", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("freshness.state");
  });

  it("RPT-129 responsibility mappings render", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("<td>context-capsule</td>");
  });

  it("RPT-130 context size renders", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("ceil(characterCount / 4) per source");
  });

  it("RPT-131 target immutability renders", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("mutated");
  });

  it("RPT-132 target mutations render", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("git.head");
  });

  it("RPT-133 determinism renders", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("Repeated-run determinism requires at least two runs.");
  });

  it("RPT-134 assurance issues render", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("TARGET_MUTATION_DETECTED");
  });

  it("RPT-135 bounded-list omitted counts render", () => {
    const html = renderContextStrategyComparisonV043Html(
      baseV043Report({
        strategies: [
          baseStrategy({
            artifacts: boundedList(
              [
                {
                  sourceInstance: "architecture.contextCapsule",
                  artifactKind: "context-capsule",
                  sourcePath: "mock/architecture-capsule.json",
                  schemaVersion: "1.0.0",
                  generatedAt: null,
                  producerName: null,
                  producerVersion: null,
                  role: "architecture",
                  workflowId: null,
                  stageId: null,
                  catalogSchemaVersion: null,
                  catalogVersion: null,
                  fixtureId: null,
                  caseId: null,
                  title: null,
                },
              ],
              5
            ),
          }),
        ],
      })
    );
    expect(html).toContain("Displayed 1 of 5");
    expect(html).toContain("omitted 4");
  });

  it("RPT-136 unavailable displays unavailable", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("unavailable");
  });

  it("RPT-137 not-applicable displays not-applicable", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("not-applicable");
  });

  it("RPT-138 available zero displays 0", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).toContain("<td>0</td>");
  });

  it("RPT-139 unavailable null does not display as 0", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    const index = html.indexOf("Unnecessary Reads");
    const snippet = html.slice(index, index + 300);
    expect(snippet).not.toContain("<td>0</td>");
    expect(snippet).toContain("unavailable");
  });

  it("RPT-140 not-applicable null does not display as 0", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    const index = html.indexOf("Forbidden Evidence Inclusion");
    const snippet = html.slice(index, index + 300);
    expect(snippet).not.toContain("<td>0</td>");
  });

  it("RPT-141 HTML special characters are escaped", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("RPT-142 issue messages cannot inject HTML", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).not.toContain('mutation "detected"');
    expect(html).toContain("mutation &quot;detected&quot;");
  });

  it("RPT-143 target paths cannot inject HTML", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("RPT-144 no script tag is emitted by the renderer", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).not.toContain("<script");
  });

  it("RPT-145 no external resource URL is emitted", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("RPT-146 no raw JSON object is embedded", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html).not.toContain('"schemaVersion"');
  });

  it("RPT-147 no composite score appears", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html.toLowerCase()).not.toContain("composite score");
  });

  it("RPT-148 no winning-strategy language appears", () => {
    const html = renderContextStrategyComparisonV043Html(baseV043Report());
    expect(html.toLowerCase()).not.toContain("winning strategy");
    expect(html.toLowerCase()).not.toContain("best-supported strategy");
  });

  it("RPT-149 the renderer does not mutate the report", () => {
    const report = baseV043Report();
    const before = JSON.stringify(report);
    renderContextStrategyComparisonV043Html(report);
    expect(JSON.stringify(report)).toBe(before);
  });

  it("RPT-150 the complete plugin HTML places the v0.4.3 section after Metrics", () => {
    const html = renderPluginExperimentReportHtml(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    const metricsIndex = html.indexOf("<h2>Metrics</h2>");
    const v043Index = html.indexOf("V0.4.3 Stage-Context Evidence");
    expect(v043Index).toBeGreaterThan(metricsIndex);
  });

  it("RPT-151 the complete plugin HTML places it before Warnings, Skips, And Failures", () => {
    const html = renderPluginExperimentReportHtml(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    const v043Index = html.indexOf("V0.4.3 Stage-Context Evidence");
    const warningsIndex = html.indexOf("Warnings, Skips, And Failures");
    expect(warningsIndex).toBeGreaterThan(v043Index);
  });

  it("RPT-152 legacy generic sections remain present", () => {
    const html = renderPluginExperimentReportHtml(baseReport({ contextStrategyComparisonV043: null }));
    expect(html).toContain("Plugin And Target");
    expect(html).toContain("Variants");
    expect(html).toContain("Cases");
    expect(html).toContain("Artifacts");
  });

  it("RPT-153 a v0.4.3 report uses the neutral interpretation", () => {
    const html = renderPluginExperimentReportHtml(
      baseReport({
        contextStrategyComparisonV043: baseV043Report(),
        interpretation: {
          summary:
            "Stage-context evidence was recorded for 1 strategy executions. Review each strategy independently; this report does not calculate a composite ranking or winning strategy.",
          recommendedNextStep: "Review each metric independently.",
        },
      })
    );
    expect(html).toContain("does not calculate a composite ranking or winning strategy");
  });

  it("RPT-154 a v0.4.3 report contains no Best-supported strategy label", () => {
    const html = renderPluginExperimentReportHtml(
      baseReport({
        contextStrategyComparisonV043: baseV043Report(),
        interpretation: {
          summary: "Stage-context evidence was recorded for 1 strategy executions.",
          recommendedNextStep: "Review each metric independently.",
        },
      })
    );
    expect(html).not.toContain("Best-supported strategy");
  });

  it("RPT-155 a legacy-only report preserves the existing legacy interpretation", () => {
    const html = renderPluginExperimentReportHtml(
      baseReport({
        contextStrategyComparisonV043: null,
        interpretation: {
          summary: "raw-full-file vs my-dev-kit-guided comparison Best-supported strategy: my-dev-kit-guided.",
          recommendedNextStep: "Review case-level outcomes.",
        },
      })
    );
    expect(html).toContain("raw-full-file vs my-dev-kit-guided");
  });
});
