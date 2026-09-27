import { describe, expect, it } from "vitest";
import { renderIncrementalChangeStalenessHtml } from "../../../src/report/experiments/renderIncrementalChangeStalenessHtml.js";
import type { IncrementalChangeStalenessReportV1 } from "../../../src/report/experiments/incrementalChangeStalenessReportModel.js";

function baseSection(overrides: Partial<IncrementalChangeStalenessReportV1> = {}): IncrementalChangeStalenessReportV1 {
  return {
    schemaVersion: "my-dev-kit-lab-incremental-change-staleness-report-v1",
    pluginId: "incremental-change-staleness",
    scenarioCount: 1,
    readyScenarioCount: 1,
    failedScenarioCount: 0,
    observedStaleRegressionCount: 0,
    noObservedStaleRegressionCount: 1,
    inconclusiveCount: 0,
    scenarios: [
      {
        scenarioId: "SCN-1",
        category: "targeted-file-mutation",
        benchmarkProjectId: "proj-a",
        baseCaseId: "case-a",
        status: "ready",
        failureReason: null,
        query: "Where is foo defined?",
        answerPolicy: "inherit",
        expectedFiles: ["a.ts"],
        expectedSymbols: ["foo"],
        lifecycle: {
          preMutationEquivalence: "equivalent",
          postMutationEquivalence: "equivalent",
          controlledFilePaths: ["a.ts"],
          staleBaselineFreshnessStatus: "stale",
          fullRefreshBaselineFreshnessStatus: "stale",
          fullRefreshRefreshedFreshnessStatus: "fresh",
          myDevKitVersion: "1.12.4",
          sourceRoots: ["/tmp/proj-a"]
        },
        staleTreatment: {
          treatmentId: "stale-index",
          status: "completed",
          failureReason: null,
          activeIndexPhase: "baseline",
          baselineFreshness: { status: "stale" } as never,
          affectedNeighborhood: {
            status: "complete",
            relationship: "related",
            reindexRecommendation: "recommended",
            changedFileCount: 1,
            changedSymbolCount: 2,
            affectedNodeCount: 3,
            affectedEdgeCount: 2,
            taskOverlapCount: 2,
            taskOverlapPercent: 100
          } as never,
          retrieval: {
            status: "completed",
            warnings: [],
            totalChars: 400,
            totalEstimatedTokens: 100,
            tokenCountMethod: "estimated_chars_div_4",
            filesRead: ["a.ts"],
            selectedNodeId: "n1",
            selectedFile: "a.ts",
            selectedSymbol: "foo",
            durationMs: 10,
            commands: []
          },
          fakeAgent: {
            status: "completed",
            correctness: { available: true, score: 0.9, passed: true, failureReasons: [] },
            correctnessDetail: null,
            durationMs: 5,
            warnings: [],
            errors: []
          },
          requiredFileEvidence: { status: "present", requiredFiles: ["a.ts"], observedFiles: ["a.ts"], missingFiles: [], reason: null }
        } as never,
        fullRefreshTreatment: {
          treatmentId: "full-refresh",
          status: "completed",
          failureReason: null,
          activeIndexPhase: "refreshed",
          baselineFreshness: { status: "stale" } as never,
          affectedNeighborhood: {
            status: "complete",
            relationship: "related",
            reindexRecommendation: "recommended",
            changedFileCount: 1,
            changedSymbolCount: 2,
            affectedNodeCount: 3,
            affectedEdgeCount: 2,
            taskOverlapCount: 2,
            taskOverlapPercent: 100
          } as never,
          retrieval: {
            status: "completed",
            warnings: [],
            totalChars: 400,
            totalEstimatedTokens: 100,
            tokenCountMethod: "estimated_chars_div_4",
            filesRead: ["a.ts"],
            selectedNodeId: "n1",
            selectedFile: "a.ts",
            selectedSymbol: "foo",
            durationMs: 10,
            commands: []
          },
          fakeAgent: {
            status: "completed",
            correctness: { available: true, score: 0.9, passed: true, failureReasons: [] },
            correctnessDetail: null,
            durationMs: 5,
            warnings: [],
            errors: []
          },
          requiredFileEvidence: { status: "present", requiredFiles: ["a.ts"], observedFiles: ["a.ts"], missingFiles: [], reason: null }
        } as never,
        comparison: { correctnessRelation: "same", requiredFileEvidenceRelation: "same", staleRiskClassification: "no-observed-stale-regression", reasonCodes: ["no-stale-specific-difference-observed"] }
      }
    ],
    limitations: [
      "Results are scoped to the executed benchmark scenarios, deterministic controlled changes, configured my-dev-kit version, and observed retrieval/evaluation evidence."
    ],
    ...overrides
  };
}

describe("renderIncrementalChangeStalenessHtml", () => {
  it("renders 'not applicable' for a null section (TST-B5-056 baseline)", () => {
    const html = renderIncrementalChangeStalenessHtml(null);
    expect(html).toContain("Not applicable to this plugin.");
  });

  it("renders the summary section with the six required counts (TST-B5-056, 047)", () => {
    const html = renderIncrementalChangeStalenessHtml(baseSection());
    expect(html).toContain("Scenarios");
    expect(html).toContain("Ready");
    expect(html).toContain("Failed");
    expect(html).toContain("Observed stale regression");
    expect(html).toContain("No observed stale regression");
    expect(html).toContain("Inconclusive");
  });

  it("renders the scenario comparison table with exactly the planned columns, in order, and no Winner/Score/Recommended columns (TST-B5-057, 064, 065)", () => {
    const html = renderIncrementalChangeStalenessHtml(baseSection());
    const expectedColumns = [
      "Scenario",
      "Category",
      "Status",
      "Relationship",
      "Reindex recommendation",
      "Stale correctness",
      "Full-refresh correctness",
      "Correctness relation",
      "Stale required files",
      "Full-refresh required files",
      "Required-file relation",
      "Stale-risk classification"
    ];
    for (const column of expectedColumns) {
      expect(html).toContain(`<th>${column}</th>`);
    }
    expect(html).not.toMatch(/<th>Winner<\/th>/i);
    expect(html).not.toMatch(/<th>Score<\/th>/i);
    expect(html).not.toMatch(/<th>Recommended treatment<\/th>/i);
  });

  it("renders one row per scenario and preserves scenario order (TST-B5-058, 059)", () => {
    const section = baseSection();
    section.scenarios = [
      { ...section.scenarios[0], scenarioId: "FIRST" },
      { ...section.scenarios[0], scenarioId: "SECOND" }
    ];
    section.scenarioCount = 2;
    const html = renderIncrementalChangeStalenessHtml(section);
    expect(html.indexOf("Scenario: FIRST")).toBeLessThan(html.indexOf("Scenario: SECOND"));
  });

  it("renders both treatment sections and the matched comparison with reason codes (TST-B5-061, 062)", () => {
    const html = renderIncrementalChangeStalenessHtml(baseSection());
    expect(html).toContain("Stale-Index Treatment");
    expect(html).toContain("Full-Refresh Treatment");
    expect(html).toContain("Matched Comparison");
    expect(html).toContain("no-stale-specific-difference-observed");
  });

  it("labels fake-agent evidence as deterministic/simulated harness evidence, never a provider measurement (TST-B5-036)", () => {
    const html = renderIncrementalChangeStalenessHtml(baseSection());
    expect(html).toMatch(/deterministic fake-agent \/ simulated harness evidence/);
    expect(html).not.toMatch(/Codex performance|Claude performance|provider measurement/i);
  });

  it("renders the limitations section (TST-B5-063)", () => {
    const html = renderIncrementalChangeStalenessHtml(baseSection());
    expect(html).toContain("Limitations");
    expect(html).toContain("Results are scoped to the executed benchmark scenarios");
  });

  it("never embeds a full retrieved context body (TST-B5-067)", () => {
    const html = renderIncrementalChangeStalenessHtml(baseSection());
    expect(html).not.toContain("contextText");
  });

  it("renders a failed scenario without crashing, with treatments shown as not available (TST-B5-060, 075, 076)", () => {
    const section = baseSection();
    section.scenarios = [
      {
        ...section.scenarios[0],
        status: "failed",
        failureReason: "LIFECYCLE_FAILURE: simulated",
        lifecycle: null,
        staleTreatment: null,
        fullRefreshTreatment: null,
        comparison: { correctnessRelation: "unknown", requiredFileEvidenceRelation: "unknown", staleRiskClassification: "inconclusive", reasonCodes: ["correctness-unavailable"] }
      }
    ];
    section.failedScenarioCount = 1;
    section.readyScenarioCount = 0;
    expect(() => renderIncrementalChangeStalenessHtml(section)).not.toThrow();
    const html = renderIncrementalChangeStalenessHtml(section);
    expect(html).toContain("Not available.");
    expect(html).toContain("inconclusive");
  });

  it("bounds long file lists for display and reports the omitted count (TST-B5-080, 082)", () => {
    const section = baseSection();
    const manyFiles = Array.from({ length: 30 }, (_, i) => `file-${i}.ts`);
    section.scenarios[0].expectedFiles = manyFiles;
    const html = renderIncrementalChangeStalenessHtml(section);
    expect(html).toContain("... 10 more");
  });
});
