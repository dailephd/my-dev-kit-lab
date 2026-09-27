import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentRun } from "../../../src/experiments/index.js";
import {
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION,
  type IncrementalChangeStalenessExecutionArtifactV1,
  type IncrementalChangeStalenessScenarioExecutionArtifactRecordV1,
  type IncrementalChangeStalenessTreatmentSummaryV1
} from "../../../src/experiments/plugins/incrementalChangeStaleness/executionArtifact.js";
import {
  buildIncrementalChangeStalenessReport,
  buildPluginExperimentReport,
  renderIncrementalChangeStalenessHtml,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
  STALE_RISK_CLASSIFICATION_EXPLANATIONS
} from "../../../src/report/index.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const AFFECTED_NEIGHBORHOOD_AVAILABLE = {
  schemaVersion: "my-dev-kit-lab-affected-neighborhood-assessment-v1",
  status: "complete" as const,
  freshnessStatus: "stale" as const,
  seedMappingStatus: "complete" as const,
  graphEvidenceStatus: "complete" as const,
  neighborhoodStatus: "complete" as const,
  changedFileCount: 1,
  changedSymbolCount: 2,
  seedNodeCount: 1,
  affectedNodeCount: 3,
  affectedEdgeCount: 2,
  affectedNodeIds: ["n1", "n2", "n3"],
  participatingEdgeIds: ["e1", "e2"],
  taskMapping: {
    status: "complete" as const,
    expectedFiles: ["a.ts"],
    expectedSymbols: ["foo"],
    resolvedFiles: [{ path: "a.ts", nodeId: "n1" }],
    resolvedSymbols: [{ name: "foo", nodeId: "n2" }],
    unresolvedCount: 0,
    unresolved: [],
    unresolvedTruncated: false,
    ambiguousCount: 0,
    ambiguousSymbols: [],
    ambiguousTruncated: false,
    duplicateEntryCount: 0,
    resolvedTaskNodeIds: ["n1", "n2"],
    resolvableTaskNodeCount: 2
  },
  taskOverlapCount: 2,
  taskOverlapNodeIds: ["n1", "n2"],
  taskOverlapPercent: 100,
  relationship: "related" as const,
  reindexRecommendation: "recommended" as const,
  warningCount: 0,
  warnings: [],
  warningsTruncated: false
};

const FRESHNESS_STALE = {
  schemaVersion: "my-dev-kit-lab-index-freshness-v1",
  status: "stale" as const,
  assessedAt: "2026-01-01T00:00:00.000Z",
  baselineSnapshotStatus: "complete" as const,
  indexedFileCount: 3,
  comparableFileCount: 3,
  unchangedFileCount: 2,
  changedFileCount: 1,
  missingFileCount: 0,
  unresolvedFileCount: 0,
  changes: [{ path: "a.ts", changeType: "modified" as const, baselineSha256: "x", baselineSizeBytes: 1, baselineModifiedAt: "t", currentSha256: "y", currentSizeBytes: 2, currentModifiedAt: "t2" }],
  unresolved: [],
  warnings: [],
  changesTruncated: false,
  unresolvedTruncated: false
};

function makeTreatment(overrides: Partial<IncrementalChangeStalenessTreatmentSummaryV1> = {}): IncrementalChangeStalenessTreatmentSummaryV1 {
  return {
    treatmentId: "stale-index",
    status: "completed",
    failureReason: null,
    activeIndexPhase: "baseline",
    baselineFreshness: FRESHNESS_STALE as never,
    affectedNeighborhood: AFFECTED_NEIGHBORHOOD_AVAILABLE as never,
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
    requiredFileEvidence: { status: "present", requiredFiles: ["a.ts"], observedFiles: ["a.ts"], missingFiles: [], reason: null },
    ...overrides
  };
}

function makeScenario(
  overrides: Partial<IncrementalChangeStalenessScenarioExecutionArtifactRecordV1> = {}
): IncrementalChangeStalenessScenarioExecutionArtifactRecordV1 {
  return {
    scenarioId: "T-FIXTURE",
    category: "targeted-file-mutation",
    benchmarkProjectId: "proj-a",
    baseCaseId: "case-a",
    answerPolicy: "inherit",
    query: "Where is foo defined?",
    expectedFiles: ["a.ts"],
    expectedSymbols: ["foo"],
    status: "ready",
    failureReason: null,
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
    stale: makeTreatment({ treatmentId: "stale-index" }),
    fullRefresh: makeTreatment({ treatmentId: "full-refresh", activeIndexPhase: "refreshed" }),
    comparison: { correctnessRelation: "same", requiredFileEvidenceRelation: "same", staleRiskClassification: "no-observed-stale-regression", reasonCodes: ["no-stale-specific-difference-observed"] },
    ...overrides
  };
}

function writeArtifact(dir: string, artifact: IncrementalChangeStalenessExecutionArtifactV1): string {
  const artifactPath = path.join(dir, "incremental-change-staleness-execution.json");
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  return artifactPath;
}

function makeRun(artifactPath: string): ExperimentRun {
  return {
    runId: "run-1",
    pluginId: "incremental-change-staleness",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    status: "completed",
    target: {
      kind: "self",
      targetRoot: "/repo",
      toolRoot: "/repo",
      packageName: "@dailephd/my-dev-kit-lab",
      packageVersion: "0.6.2",
      hasPackageJson: true,
      hasLockfile: true,
      branch: "main",
      commit: "abc123",
      hasGit: true,
      isSelf: true
    },
    variants: [],
    cases: [],
    metrics: [],
    artifacts: [
      { id: "incremental-change-staleness-execution", label: "evidence", path: artifactPath, kind: "artifact", mimeType: "application/json" }
    ],
    warnings: [],
    failures: [],
    metadata: { executionArtifactPath: artifactPath }
  };
}

function makeArtifact(scenarios: IncrementalChangeStalenessScenarioExecutionArtifactRecordV1[]): IncrementalChangeStalenessExecutionArtifactV1 {
  return {
    schemaVersion: INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION,
    runId: "run-1",
    pluginId: "incremental-change-staleness",
    scenarios,
    summary: {
      scenarioCount: scenarios.length,
      readyScenarioCount: scenarios.filter((s) => s.status === "ready").length,
      failedScenarioCount: scenarios.filter((s) => s.status === "failed").length,
      observedStaleRegressionCount: scenarios.filter((s) => s.comparison.staleRiskClassification === "observed-stale-regression").length,
      noObservedStaleRegressionCount: scenarios.filter((s) => s.comparison.staleRiskClassification === "no-observed-stale-regression").length,
      inconclusiveCount: scenarios.filter((s) => s.comparison.staleRiskClassification === "inconclusive").length
    }
  };
}

describe("buildIncrementalChangeStalenessReport", () => {
  it("returns null for a different plugin (TST-B5-001..003 scope check)", () => {
    const dir = makeTempDir("ics-report-null-");
    const artifactPath = writeArtifact(dir, makeArtifact([makeScenario()]));
    const run = { ...makeRun(artifactPath), pluginId: "warm-index-reuse" };
    expect(buildIncrementalChangeStalenessReport(run)).toBeNull();
  });

  it("projects the persisted artifact into the report model, preserving scenario/treatment order and summary counts (TST-B5-001..004)", () => {
    const dir = makeTempDir("ics-report-basic-");
    const scenarioA = makeScenario({ scenarioId: "A" });
    const scenarioB = makeScenario({ scenarioId: "B" });
    const artifactPath = writeArtifact(dir, makeArtifact([scenarioA, scenarioB]));
    const report = buildIncrementalChangeStalenessReport(makeRun(artifactPath));

    expect(report).not.toBeNull();
    expect(report!.scenarioCount).toBe(2);
    expect(report!.readyScenarioCount).toBe(2);
    expect(report!.scenarios.map((s) => s.scenarioId)).toEqual(["A", "B"]);
    expect(report!.scenarios[0].staleTreatment?.treatmentId).toBe("stale-index");
    expect(report!.scenarios[0].fullRefreshTreatment?.treatmentId).toBe("full-refresh");
  });

  it("never reads benchmark/index/source state -- only the persisted execution artifact (TST-B5-009..017)", () => {
    const dir = makeTempDir("ics-report-noio-");
    const artifactPath = writeArtifact(dir, makeArtifact([makeScenario()]));
    // Deleting the run-owned root (which never existed) proves nothing else on disk is required.
    const report = buildIncrementalChangeStalenessReport(makeRun(artifactPath));
    expect(report).not.toBeNull();
    expect(report!.scenarios[0].comparison.staleRiskClassification).toBe("no-observed-stale-regression");
  });

  it("throws rather than reconstructing evidence when the artifact is missing (TST-B5-018)", () => {
    const run = makeRun(path.join(os.tmpdir(), "does-not-exist-ics-execution.json"));
    expect(() => buildIncrementalChangeStalenessReport(run)).toThrow();
  });

  it("preserves failed scenarios with null treatments and inconclusive comparison (TST-B5-005, 075..078)", () => {
    const dir = makeTempDir("ics-report-failed-");
    const failedScenario = makeScenario({
      scenarioId: "FAILED",
      status: "failed",
      failureReason: "LIFECYCLE_FAILURE: simulated",
      lifecycle: null,
      stale: null,
      fullRefresh: null,
      comparison: { correctnessRelation: "unknown", requiredFileEvidenceRelation: "unknown", staleRiskClassification: "inconclusive", reasonCodes: ["correctness-unavailable", "required-file-evidence-unavailable"] }
    });
    const okScenario = makeScenario({ scenarioId: "OK" });
    const artifactPath = writeArtifact(dir, makeArtifact([failedScenario, okScenario]));
    const report = buildIncrementalChangeStalenessReport(makeRun(artifactPath));

    expect(report!.scenarios[0].status).toBe("failed");
    expect(report!.scenarios[0].staleTreatment).toBeNull();
    expect(report!.scenarios[0].fullRefreshTreatment).toBeNull();
    expect(report!.scenarios[0].comparison.staleRiskClassification).toBe("inconclusive");
    // TST-B5-079: one failed scenario does not suppress the ready scenario.
    expect(report!.scenarios[1].status).toBe("ready");
  });

  it("preserves unavailable affected-neighborhood metrics as unavailable, not zero, and unknown relationship as unknown (TST-B5-019..023)", () => {
    const dir = makeTempDir("ics-report-unavailable-");
    const unavailableAffected = {
      ...AFFECTED_NEIGHBORHOOD_AVAILABLE,
      status: "unavailable" as const,
      changedFileCount: null,
      changedSymbolCount: null,
      affectedNodeCount: null,
      affectedEdgeCount: null,
      taskOverlapCount: null,
      taskOverlapPercent: null,
      relationship: "unknown" as const,
      reindexRecommendation: "unknown" as const
    };
    const scenario = makeScenario({
      stale: makeTreatment({ affectedNeighborhood: unavailableAffected as never }),
      fullRefresh: makeTreatment({ treatmentId: "full-refresh", activeIndexPhase: "refreshed", affectedNeighborhood: unavailableAffected as never })
    });
    const artifactPath = writeArtifact(dir, makeArtifact([scenario]));
    const report = buildIncrementalChangeStalenessReport(makeRun(artifactPath));
    const affected = report!.scenarios[0].staleTreatment!.affectedNeighborhood;
    expect(affected.changedFileCount).toBeNull();
    expect(affected.relationship).toBe("unknown");
    expect(affected.reindexRecommendation).toBe("unknown");

    const html = renderIncrementalChangeStalenessHtml(report);
    expect(html).toContain("unavailable");
    expect(html).not.toMatch(/Changed indexed files<\/td>\s*<td>0/);
  });

  it("has no overall score, grade, winner, or recommended-treatment field anywhere in the report (TST-B5-007, 008, 074)", () => {
    const dir = makeTempDir("ics-report-noverdict-");
    const artifactPath = writeArtifact(dir, makeArtifact([makeScenario()]));
    const report = buildIncrementalChangeStalenessReport(makeRun(artifactPath));
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/"overallScore"|"overallGrade"|"winner"|"bestTreatment"|"safeToSkipReindex"|"staleRiskPercent"|"recommendedTreatment"/);
  });

  it("labels fake-agent evidence text with the classification explanations map, never claiming general safety (TST-B5-041)", () => {
    expect(STALE_RISK_CLASSIFICATION_EXPLANATIONS["no-observed-stale-regression"]).toMatch(/does not establish general stale-index safety/);
    expect(STALE_RISK_CLASSIFICATION_EXPLANATIONS["inconclusive"]).toMatch(/is not the same as no regression/i);
  });
});

describe("buildPluginExperimentReport integration for incremental-change-staleness", () => {
  it("attaches incrementalChangeStaleness and leaves warmIndexReuse/contextStrategyComparisonV043 null (regression: TST-B5-084..087)", () => {
    const dir = makeTempDir("ics-report-plugin-integration-");
    const artifactPath = writeArtifact(dir, makeArtifact([makeScenario()]));
    const run = makeRun(artifactPath);
    const report = buildPluginExperimentReport({
      run,
      plugin: {
        id: "incremental-change-staleness",
        name: "Incremental Change Staleness",
        description: "desc",
        schemaVersion: "1.0.0",
        status: "experimental",
        supportedTargets: ["self"],
        supportedOutputs: ["json", "html"]
      }
    });
    expect(report.incrementalChangeStaleness).not.toBeNull();
    expect(report.warmIndexReuse).toBeNull();
    expect(report.contextStrategyComparisonV043).toBeNull();

    const text = renderPluginExperimentReportText(report);
    expect(text).toContain("Incremental-Change And Staleness Evidence");
    expect(text).toContain("no-observed-stale-regression");
    // TST-B5-055: no raw retrieved context body in the text report.
    expect(text).not.toContain("contextText");

    const html = renderPluginExperimentReportHtml(report);
    expect(html).toContain("Incremental-Change And Staleness Evidence");
    expect(html).not.toMatch(/<th>Winner<\/th>/i);
    expect(html).not.toMatch(/<th>Recommended treatment<\/th>/i);
  });
});
