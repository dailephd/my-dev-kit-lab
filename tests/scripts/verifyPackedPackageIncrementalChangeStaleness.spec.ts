import { describe, expect, it } from "vitest";
import {
  INCREMENTAL_CHANGE_STALENESS_CONTROLLED_PATHS,
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_EXPECTED,
  INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS,
  validateIncrementalChangeStalenessArtifact,
  validateIncrementalChangeStalenessReportConsistency
} from "../../scripts/verifyPackedPackageHelpers.js";

const AFFECTED = {
  status: "complete",
  relationship: "related",
  reindexRecommendation: "recommended",
  changedFileCount: 1,
  changedSymbolCount: 2,
  affectedNodeCount: 3,
  affectedEdgeCount: 2,
  taskOverlapCount: 1,
  taskOverlapPercent: 50
};

function treatment(id: "stale-index" | "full-refresh", activeIndexPhase: "baseline" | "refreshed") {
  return {
    treatmentId: id,
    activeIndexPhase,
    retrieval: { status: "completed" },
    requiredFileEvidence: { status: "present", requiredFiles: ["a.ts"], observedFiles: ["a.ts"], missingFiles: [], reason: null },
    fakeAgent: { correctness: { available: true, score: 0.9, passed: true } },
    affectedNeighborhood: { ...AFFECTED }
  };
}

function scenario(id: string, overrides: Record<string, unknown> = {}) {
  return {
    scenarioId: id,
    status: "ready",
    lifecycle: {
      preMutationEquivalence: "equivalent",
      postMutationEquivalence: "equivalent",
      staleBaselineFreshnessStatus: "stale",
      fullRefreshBaselineFreshnessStatus: "stale",
      fullRefreshRefreshedFreshnessStatus: "fresh",
      myDevKitVersion: "@dailephd/my-dev-kit 1.12.4",
      controlledFilePaths: [INCREMENTAL_CHANGE_STALENESS_CONTROLLED_PATHS[id as keyof typeof INCREMENTAL_CHANGE_STALENESS_CONTROLLED_PATHS]]
    },
    stale: treatment("stale-index", "baseline"),
    fullRefresh: treatment("full-refresh", "refreshed"),
    comparison: { correctnessRelation: "same", requiredFileEvidenceRelation: "same", staleRiskClassification: "no-observed-stale-regression", reasonCodes: ["no-stale-specific-difference-observed"] },
    ...overrides
  };
}

function validArtifact() {
  const scenarios = INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS.map((id) => scenario(id));
  return {
    schemaVersion: INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_EXPECTED,
    scenarios,
    summary: {
      scenarioCount: 6,
      readyScenarioCount: 6,
      failedScenarioCount: 0,
      observedStaleRegressionCount: 0,
      noObservedStaleRegressionCount: 6,
      inconclusiveCount: 0
    }
  };
}

describe("validateIncrementalChangeStalenessArtifact", () => {
  it("accepts a valid six-scenario artifact (TST-B6-020..034)", () => {
    expect(validateIncrementalChangeStalenessArtifact(validArtifact())).toEqual([]);
  });

  it("rejects the wrong schema version (TST-B6-056)", () => {
    const artifact = { ...validArtifact(), schemaVersion: "wrong" };
    expect(validateIncrementalChangeStalenessArtifact(artifact)).toEqual(
      expect.arrayContaining([expect.stringContaining("schemaVersion")])
    );
  });

  it("rejects a wrong scenario count/order (TST-B6-021, 022, 057)", () => {
    const artifact = validArtifact();
    artifact.scenarios = artifact.scenarios.slice(0, 5);
    expect(validateIncrementalChangeStalenessArtifact(artifact)).toEqual(
      expect.arrayContaining([expect.stringContaining("scenario order/identity mismatch")])
    );
  });

  it("rejects a scenario missing lifecycle fresh/stale states (TST-B6-026..030)", () => {
    const artifact = validArtifact();
    (artifact.scenarios[1].lifecycle as Record<string, unknown>).fullRefreshRefreshedFreshnessStatus = "unknown";
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("fullRefreshRefreshedFreshnessStatus"))).toBe(true);
  });

  it("rejects wrong activeIndexPhase (TST-B6-031, 032)", () => {
    const artifact = validArtifact();
    (artifact.scenarios[0].stale as Record<string, unknown>).activeIndexPhase = "refreshed";
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("activeIndexPhase"))).toBe(true);
  });

  it("rejects a controlled file path that does not match the frozen scenario contract (TST-B6-033)", () => {
    const artifact = validArtifact();
    (artifact.scenarios[0].lifecycle as Record<string, unknown>).controlledFilePaths = ["some/other/file.py"];
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("controlledFilePaths"))).toBe(true);
  });

  it("rejects T1 if it no longer targets py/tests/test_quality.py (TST-B6 T1 continuity)", () => {
    expect(INCREMENTAL_CHANGE_STALENESS_CONTROLLED_PATHS.T1).toBe("py/tests/test_quality.py");
  });

  it("rejects invalid affected-neighborhood relationship/recommendation vocabulary (TST-B6-037, 038)", () => {
    const artifact = validArtifact();
    ((artifact.scenarios[2].stale as Record<string, unknown>).affectedNeighborhood as Record<string, unknown>).relationship = "sideways";
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("relationship is invalid"))).toBe(true);
  });

  it("rejects stale/full-refresh affected-neighborhood asymmetry (TST-B6-039)", () => {
    const artifact = validArtifact();
    ((artifact.scenarios[3].fullRefresh as Record<string, unknown>).affectedNeighborhood as Record<string, unknown>).relationship = "unrelated";
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("asymmetry"))).toBe(true);
  });

  it("rejects invalid required-file evidence structural consistency (TST-B6-040, 050)", () => {
    const artifact = validArtifact();
    (artifact.scenarios[4].stale as Record<string, unknown>).requiredFileEvidence = { status: "missing", requiredFiles: ["a.ts"], observedFiles: [], missingFiles: [] };
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("missingFiles is empty"))).toBe(true);
  });

  it("rejects invalid comparison vocabulary (TST-B6-047, 049, 051)", () => {
    const artifact = validArtifact();
    (artifact.scenarios[5].comparison as Record<string, unknown>).staleRiskClassification = "definitely-bad";
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("staleRiskClassification is invalid"))).toBe(true);
  });

  it("rejects summary counts that do not sum correctly (TST-B6-057..060)", () => {
    const artifact = validArtifact();
    artifact.summary.inconclusiveCount = 1;
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("classification counts sum"))).toBe(true);
  });

  it("rejects a forbidden overall-verdict field anywhere in the artifact (TST-B6-053, 054)", () => {
    const artifact: Record<string, unknown> = validArtifact();
    artifact.winner = "full-refresh";
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("forbidden overall-verdict field"))).toBe(true);
  });

  it("rejects embedded full graph node/edge records (TST-B6-061)", () => {
    const artifact: Record<string, unknown> = validArtifact();
    (artifact.scenarios as unknown[])[0] = { ...(artifact.scenarios as Record<string, unknown>[])[0], leak: { nodes: [{ id: "n1" }] } };
    const problems = validateIncrementalChangeStalenessArtifact(artifact);
    expect(problems.some((p) => p.includes("embeds full graph"))).toBe(true);
  });
});

describe("validateIncrementalChangeStalenessReportConsistency", () => {
  function validReportInputs() {
    const artifact = validArtifact();
    const scenarios = artifact.scenarios.map((s) => ({ scenarioId: s.scenarioId, comparison: s.comparison }));
    const report = {
      incrementalChangeStaleness: {
        scenarioCount: 6,
        readyScenarioCount: 6,
        failedScenarioCount: 0,
        observedStaleRegressionCount: 0,
        noObservedStaleRegressionCount: 6,
        inconclusiveCount: 0,
        scenarios,
        limitations: [
          "Results are scoped to the executed benchmark scenarios.",
          "no-observed-stale-regression does not prove stale indexes are generally safe.",
          "reindexRecommendation did not select or trigger either experiment treatment.",
          "Required-file evidence is not retrieval precision/recall.",
          "Correctness is deterministic fake-agent evidence."
        ]
      }
    };
    const reportText = scenarios.map((s) => `${s.scenarioId} ${s.comparison.staleRiskClassification}`).join("\n") +
      "\nscoped\ndoes not prove stale indexes are generally safe\ndid not select or trigger\nnot retrieval precision/recall\ndeterministic fake-agent";
    const reportHtml = reportText;
    return { artifact, report, reportText, reportHtml };
  }

  it("accepts consistent artifact/report/text/html (TST-B6-063..075)", () => {
    const inputs = validReportInputs();
    expect(validateIncrementalChangeStalenessReportConsistency(inputs)).toEqual([]);
  });

  it("rejects report.json comparison disagreeing with the execution artifact (TST-B6-067)", () => {
    const inputs = validReportInputs();
    (inputs.report.incrementalChangeStaleness.scenarios[0] as Record<string, unknown>).comparison = {
      correctnessRelation: "same",
      requiredFileEvidenceRelation: "same",
      staleRiskClassification: "observed-stale-regression",
      reasonCodes: []
    };
    const problems = validateIncrementalChangeStalenessReportConsistency(inputs);
    expect(problems.some((p) => p.includes("disagrees with execution artifact comparison"))).toBe(true);
  });

  it("rejects a missing incrementalChangeStaleness report section", () => {
    const inputs = validReportInputs();
    expect(validateIncrementalChangeStalenessReportConsistency({ ...inputs, report: {} })).toEqual([
      "report.json has no incrementalChangeStaleness section"
    ]);
  });

  it("rejects report text/html lacking a required limitations meaning (TST-B6-071, 074)", () => {
    const inputs = validReportInputs();
    inputs.reportText = inputs.reportText.replace("scoped", "");
    const problems = validateIncrementalChangeStalenessReportConsistency(inputs);
    expect(problems.some((p) => p.includes('report.txt limitations lack expected meaning: "scoped"'))).toBe(true);
  });

  it("rejects a forbidden overall-verdict claim in report text/html (TST-B6-075)", () => {
    const inputs = validReportInputs();
    inputs.reportHtml += " full refresh wins";
    const problems = validateIncrementalChangeStalenessReportConsistency(inputs);
    expect(problems.some((p) => p.includes("forbidden overall-verdict claim"))).toBe(true);
  });

  it("rejects summary count disagreement between report.json and the execution artifact (TST-B6-068)", () => {
    const inputs = validReportInputs();
    inputs.report.incrementalChangeStaleness.inconclusiveCount = 1;
    const problems = validateIncrementalChangeStalenessReportConsistency(inputs);
    expect(problems.some((p) => p.includes("summary counts disagree"))).toBe(true);
  });
});
