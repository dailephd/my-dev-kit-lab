import { describe, expect, it } from "vitest";
import { renderPluginExperimentReportText } from "../../../src/report/experiments/renderPluginExperimentReportText.js";
import type { PluginExperimentReport } from "../../../src/report/experiments/experimentReportModel.js";
import type {
  ContextStrategyComparisonV043ReportV1,
  ContextStrategyComparisonV043StrategyReportV1,
} from "../../../src/report/experiments/contextStrategyComparisonV043ReportModel.js";

function boundedList<T>(items: T[], totalCount?: number): { totalCount: number; displayedCount: number; omittedCount: number; items: T[] } {
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
    execution: { status: "completed", issues: boundedList([]) },
    evaluation: {
      status: "completed",
      reason: null,
      warnings: boundedList([]),
      expectationMatches: boundedList([]),
      observedEvidence: boundedList([]),
      metrics: {
        requiredEvidenceRecall: {
          availability: "available",
          numerator: 1,
          denominator: 3,
          rate: 1 / 3,
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
        responsibilityMappingCompleteness: boundedList([]),
        stateComparisons: boundedList([
          {
            sourceArtifact: "context-capsule",
            sourceInstance: "architecture.contextCapsule",
            expectationFieldPath: "expectedStates.contextCapsule.contextAdequacyStatus",
            artifactFieldPath: "contextAdequacy.status",
            availability: "available",
            expected: "adequate",
            actual: "adequate",
            matched: true,
            reason: null,
          },
          {
            sourceArtifact: "context-capsule",
            sourceInstance: "architecture.contextCapsule",
            expectationFieldPath: "expectedStates.contextCapsule.roleAdequacyStatus",
            artifactFieldPath: "roleAdequacy.status",
            availability: "available",
            expected: "adequate",
            actual: "adequate",
            matched: true,
            reason: null,
          },
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
          targetImmutabilityAvailability: "unavailable",
          targetImmutabilityStatus: null,
          newMutationCount: null,
          targetImmutabilityReason: "Target immutability configuration was not supplied for this strategy run.",
          mutations: boundedList([]),
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
      issues: boundedList([]),
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

describe("renderPluginExperimentReportText", () => {
  it("RPT-082 the text report uses LF line endings", () => {
    const text = renderPluginExperimentReportText(baseReport());
    expect(text).not.toContain("\r\n");
  });

  it("RPT-083 the text report ends with exactly one LF", () => {
    const text = renderPluginExperimentReportText(baseReport());
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("RPT-084 the text report contains every top-level section in order", () => {
    const text = renderPluginExperimentReportText(baseReport());
    const sections = [
      "Plugin Experiment Report",
      "Report Metadata",
      "Plugin And Target",
      "Interpretation",
      "Variants",
      "Cases",
      "Metrics",
      "V0.4.3 Stage-Context Evidence",
      "Warnings, Skips, And Failures",
      "Artifacts",
    ];
    let cursor = -1;
    for (const section of sections) {
      const index = text.indexOf(section);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("RPT-085 a non-context plugin reports not applicable", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: null }));
    expect(text).toContain("Not applicable to this plugin.");
  });

  it("RPT-086 a legacy-only context run reports no selected v0.4.3 strategies", () => {
    const text = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
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
        }),
      })
    );
    expect(text).toContain("No v0.4.3 stage-context strategies were selected.");
  });

  it("RPT-087 strategies render in source order", () => {
    const text = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
          strategies: [
            baseStrategy({ strategyId: "bounded-workflow-instruction-packet" }),
            baseStrategy({ strategyId: "architecture-context-only" }),
          ],
        }),
      })
    );
    const firstIndex = text.indexOf("Strategy 1: bounded-workflow-instruction-packet");
    const secondIndex = text.indexOf("Strategy 2: architecture-context-only");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("RPT-088 artifacts render in source order", () => {
    const text = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
          strategies: [
            baseStrategy({
              artifacts: boundedList([
                {
                  sourceInstance: "expectations",
                  artifactKind: "expectation-fixture",
                  sourcePath: "mock/expectations.json",
                  schemaVersion: "1.0.0",
                  generatedAt: null,
                  producerName: null,
                  producerVersion: null,
                  role: null,
                  workflowId: null,
                  stageId: null,
                  catalogSchemaVersion: null,
                  catalogVersion: null,
                  fixtureId: null,
                  caseId: "case-1",
                  title: "Case One",
                },
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
              ]),
            }),
          ],
        }),
      })
    );
    const firstIndex = text.indexOf("expectations");
    const secondIndex = text.indexOf("architecture.contextCapsule");
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("RPT-089 available ratio metrics show numerator and denominator", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("Numerator: 1");
    expect(text).toContain("Denominator: 3");
  });

  it("RPT-090 available ratio metrics show the raw rate", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain(`Rate: ${1 / 3}`);
  });

  it("RPT-091 available ratio metrics show an explicitly labeled percentage", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain(`Percentage: ${(1 / 3) * 100}%`);
  });

  it("RPT-092 unavailable ratio metrics show the exact reason", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("Reason: Provenance unavailable.");
  });

  it("RPT-093 unavailable ratio metrics do not display zero", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    const requiredProvenanceIndex = text.indexOf("Required Provenance Recall");
    const snippet = text.slice(requiredProvenanceIndex, requiredProvenanceIndex + 200);
    expect(snippet).not.toContain("Numerator: 0");
  });

  it("RPT-094 not-applicable ratio metrics show the exact reason", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("Reason: No forbidden evidence was expected.");
  });

  it("RPT-095 not-applicable ratio metrics do not display zero", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    const forbiddenIndex = text.indexOf("Forbidden Evidence Inclusion");
    const snippet = text.slice(forbiddenIndex, forbiddenIndex + 200);
    expect(snippet).not.toContain("Numerator: 0");
  });

  it("RPT-096 available count zero displays zero", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("Count: 0");
  });

  it("RPT-097 unavailable count does not display zero", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    const index = text.indexOf("Unnecessary Reads");
    const snippet = text.slice(index, index + 200);
    expect(snippet).not.toContain("Count: 0");
    expect(snippet).toContain("Reason: The published upstream artifacts do not expose unnecessary-read evidence.");
  });

  it("RPT-098 not-applicable count does not display zero", () => {
    const text = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
          strategies: [
            baseStrategy({
              evaluation: {
                ...baseStrategy().evaluation,
                metrics: {
                  ...baseStrategy().evaluation.metrics!,
                  irrelevantInstructionInclusion: {
                    availability: "not-applicable",
                    count: null,
                    evidenceKeys: boundedList([]),
                    reason: "No instructions were supplied.",
                  },
                },
              },
            }),
          ],
        }),
      })
    );
    const index = text.indexOf("Irrelevant Instruction Inclusion");
    const snippet = text.slice(index, index + 200);
    expect(snippet).not.toContain("Count: 0");
  });

  it("RPT-099 bounded lists display displayedCount, totalCount, and omittedCount", () => {
    const text = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
          strategies: [baseStrategy({ evaluation: { ...baseStrategy().evaluation, warnings: boundedList(Array.from({ length: 5 }, (_, i) => `w${i}`), 6) } })],
        }),
      })
    );
    expect(text).toContain("Displayed: 5 of 6");
    expect(text).toContain("Omitted: 1");
  });

  it("RPT-100 no synthetic ellipsis item is added", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).not.toContain("...");
    expect(text).not.toContain("…");
  });

  it("RPT-101 target unchanged and target mutated are distinct", () => {
    const unchangedText = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
          strategies: [
            baseStrategy({
              assurance: {
                ...baseStrategy().assurance,
                runRecords: boundedList([
                  {
                    runNumber: 1,
                    executionStatus: "completed",
                    evaluationStatus: "completed",
                    targetImmutabilityAvailability: "available",
                    targetImmutabilityStatus: "unchanged",
                    newMutationCount: 0,
                    targetImmutabilityReason: null,
                    mutations: boundedList([]),
                  },
                ]),
              },
            }),
          ],
        }),
      })
    );
    const mutatedText = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
          strategies: [
            baseStrategy({
              assurance: {
                ...baseStrategy().assurance,
                runRecords: boundedList([
                  {
                    runNumber: 1,
                    executionStatus: "completed",
                    evaluationStatus: "completed",
                    targetImmutabilityAvailability: "available",
                    targetImmutabilityStatus: "mutated",
                    newMutationCount: 3,
                    targetImmutabilityReason: null,
                    mutations: boundedList([]),
                  },
                ]),
              },
            }),
          ],
        }),
      })
    );
    expect(unchangedText).toContain("status=unchanged");
    expect(mutatedText).toContain("status=mutated");
    expect(unchangedText).not.toContain("status=mutated");
  });

  it("RPT-102 one-run determinism is not reported as deterministic", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    const index = text.indexOf("Repeated-Run Determinism");
    const snippet = text.slice(index, index + 200);
    expect(snippet).toContain("Availability: not-applicable");
    expect(snippet).not.toContain("Deterministic:");
  });

  it("RPT-103 available deterministic true is rendered", () => {
    const text = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
          strategies: [
            baseStrategy({
              assurance: {
                ...baseStrategy().assurance,
                determinism: {
                  availability: "available",
                  repeatCount: 2,
                  deterministic: true,
                  baselineSha256: "deadbeef",
                  runDigests: boundedList([{ runNumber: 1, sha256: "deadbeef" }, { runNumber: 2, sha256: "deadbeef" }]),
                  mismatchRunNumbers: [],
                  reason: null,
                },
              },
            }),
          ],
        }),
      })
    );
    expect(text).toContain("Deterministic: true");
  });

  it("RPT-104 available deterministic false is rendered", () => {
    const text = renderPluginExperimentReportText(
      baseReport({
        contextStrategyComparisonV043: baseV043Report({
          strategies: [
            baseStrategy({
              assurance: {
                ...baseStrategy().assurance,
                determinism: {
                  availability: "available",
                  repeatCount: 2,
                  deterministic: false,
                  baselineSha256: "deadbeef",
                  runDigests: boundedList([{ runNumber: 1, sha256: "deadbeef" }, { runNumber: 2, sha256: "beefdead" }]),
                  mismatchRunNumbers: [2],
                  reason: null,
                },
              },
            }),
          ],
        }),
      })
    );
    expect(text).toContain("Deterministic: false");
  });

  it("RPT-105 context adequacy and role adequacy field paths remain separate", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("contextAdequacy.status");
    expect(text).toContain("roleAdequacy.status");
  });

  it("RPT-106 freshness.state remains the rendered artifact field path", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("freshness.state");
    expect(text).not.toContain("freshness.status");
  });

  it("RPT-107 unnecessary-read unavailability reason is exact", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("The published upstream artifacts do not expose unnecessary-read evidence.");
  });

  it("RPT-108 considered-but-unselected-read unavailability reason is exact", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("The published upstream artifacts do not expose considered-but-unselected reads.");
  });

  it("RPT-109 estimated tokens are labeled as estimates", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).toContain("Total Estimated Token Count (estimate)");
    expect(text).toContain("ceil(characterCount / 4) per source");
  });

  it("RPT-110 the text report contains no composite score", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text.toLowerCase()).not.toContain("composite score");
  });

  it("RPT-111 the text report contains no winning strategy", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text.toLowerCase()).not.toContain("winning strategy");
    expect(text.toLowerCase()).not.toContain("winner");
  });

  it("RPT-112 the text report contains no raw artifact JSON", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).not.toContain("requiredContext");
    expect(text).not.toContain("candidateFiles");
  });

  it("RPT-113 the text report contains no stack trace", () => {
    const text = renderPluginExperimentReportText(baseReport({ contextStrategyComparisonV043: baseV043Report() }));
    expect(text).not.toMatch(/\n\s*at\s+\S+\s*\(/);
    expect(text).not.toContain(".ts:");
  });

  it("RPT-114 carriage returns in scalar values cannot create a new report line", () => {
    const text = renderPluginExperimentReportText(baseReport({ metadata: { ...baseReport().metadata, runId: "run\ra\rb" } }));
    const lineCount = text.split("\n").length;
    expect(text).toContain("run a b");
    const withoutInjected = renderPluginExperimentReportText(baseReport());
    expect(lineCount).toBe(withoutInjected.split("\n").length);
  });

  it("RPT-115 line feeds in scalar values cannot create a new report line", () => {
    const text = renderPluginExperimentReportText(baseReport({ metadata: { ...baseReport().metadata, runId: "run\ninjected-line" } }));
    expect(text).not.toContain("\ninjected-line");
    expect(text).toContain("run injected-line");
  });

  it("RPT-116 tabs in scalar values become spaces", () => {
    const text = renderPluginExperimentReportText(baseReport({ metadata: { ...baseReport().metadata, runId: "run\ttabbed" } }));
    expect(text).toContain("run tabbed");
    expect(text).not.toContain("run\ttabbed");
  });

  it("RPT-117 null bytes are removed from scalar output", () => {
    const text = renderPluginExperimentReportText(baseReport({ metadata: { ...baseReport().metadata, runId: `run${String.fromCharCode(0)}id` } }));
    expect(text).toContain("runid");
    expect(text.includes(String.fromCharCode(0))).toBe(false);
  });

  it("RPT-118 ANSI control characters are not emitted", () => {
    const text = renderPluginExperimentReportText(
      baseReport({ metadata: { ...baseReport().metadata, runId: `run${String.fromCharCode(27)}[31mred${String.fromCharCode(27)}[0m` } })
    );
    expect(text.includes(String.fromCharCode(27))).toBe(false);
  });

  it("RPT-119 the renderer does not mutate the report", () => {
    const report = baseReport({ contextStrategyComparisonV043: baseV043Report() });
    const before = JSON.stringify(report);
    renderPluginExperimentReportText(report);
    expect(JSON.stringify(report)).toBe(before);
  });
});
