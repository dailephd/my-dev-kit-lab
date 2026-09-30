import { describe, expect, it } from "vitest";
import {
  HISTORICAL_V1_UPSTREAM_MY_DEV_KIT_VERSION,
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2_EXPECTED,
  INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS,
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED,
  UPSTREAM_MY_DEV_KIT_VERSION,
  evaluateIncrementalChangeStalenessV2Acceptance,
  extractIncrementalChangeStalenessV2EvidenceRows,
  validateIncrementalChangeStalenessReportConsistencyV2
} from "../../scripts/verifyPackedPackageHelpers.js";

type Json = Record<string, any>;

const INTENTS: Record<string, string> = {
  "stale-index": "no-refresh-reference",
  "changed-files-refresh": "changed-files-partial-refresh",
  "affected-neighborhood-refresh": "affected-neighborhood-partial-refresh",
  "full-refresh": "full-refresh-reference"
};

function upstream(scope: "changed-files" | "affected-neighborhood", overrides: Json = {}): Json {
  return {
    requestedScope: scope,
    appliedScope: scope,
    selectionStatus: "applied",
    fallbackReason: null,
    seedFileCount: 1,
    seedSymbolCount: 2,
    affectedNodeCount: 5,
    affectedEdgeCount: 4,
    forcedNeighborReanalysisFileCount: 0,
    forcedNeighborSample: [],
    freshExtractionFileCount: 1,
    reusedFileCount: 30,
    ...overrides
  };
}

const AFFECTED = { status: "complete", relationship: "related", reindexRecommendation: "recommended" };
const fresh = { status: "fresh", changedFileCount: 0 };
const stale = { status: "stale", changedFileCount: 1 };

function treatment(id: string, refreshExecution: Json, extra: Json = {}): Json {
  const isStale = id === "stale-index";
  return {
    treatmentId: id,
    treatmentIntent: INTENTS[id],
    status: "completed",
    failureReason: null,
    activeIndexPhase: isStale ? "baseline" : "refreshed",
    baselineFreshness: stale,
    refreshedFreshness: isStale ? null : fresh,
    refreshExecution,
    affectedNeighborhood: { ...AFFECTED },
    retrieval: { status: "completed" },
    fakeAgent: { status: "completed", correctness: { available: true, score: 0.9 } },
    requiredFileEvidence: { status: "present", requiredFiles: ["a.ts"], observedFiles: ["a.ts"], missingFiles: [], reason: null },
    ...extra
  };
}

function scenario(id: string, options: { changed?: Json; affected?: Json } = {}): Json {
  const changed = options.changed ?? upstream("changed-files");
  const affected = options.affected ?? upstream("affected-neighborhood");
  const realization = (evidence: Json) => (evidence.selectionStatus === "applied" ? "APPLIED_PARTIAL" : "FALLBACK_FULL");
  return {
    scenarioId: id,
    status: "ready",
    lifecycle: { myDevKitVersion: `@dailephd/my-dev-kit ${UPSTREAM_MY_DEV_KIT_VERSION}` },
    treatments: [
      treatment("stale-index", { kind: "no-refresh", realization: "NO_REFRESH", incrementalRefresh: null }),
      treatment("changed-files-refresh", { kind: "incremental", realization: realization(changed), incrementalRefresh: changed }),
      treatment("affected-neighborhood-refresh", { kind: "incremental", realization: realization(affected), incrementalRefresh: affected }),
      treatment("full-refresh", { kind: "full", realization: "FULL_REFRESH", incrementalRefresh: null })
    ],
    referenceComparisons: [
      {
        kind: "stale-risk",
        candidateTreatmentId: "stale-index",
        referenceTreatmentId: "full-refresh",
        comparison: { correctnessRelation: "same", requiredFileEvidenceRelation: "same", staleRiskClassification: "no-observed-stale-regression", reasonCodes: [] }
      },
      { kind: "partial-refresh", candidateTreatmentId: "changed-files-refresh", referenceTreatmentId: "full-refresh", refreshRealization: realization(changed), classification: "no-observed-regression-relative-to-full", reasonCodes: [] },
      { kind: "partial-refresh", candidateTreatmentId: "affected-neighborhood-refresh", referenceTreatmentId: "full-refresh", refreshRealization: realization(affected), classification: "no-observed-regression-relative-to-full", reasonCodes: [] }
    ]
  };
}

const FORCED_AFFECTED = upstream("affected-neighborhood", {
  forcedNeighborReanalysisFileCount: 2,
  forcedNeighborSample: ["src/a.ts", "src/b.ts"],
  freshExtractionFileCount: 3,
  reusedFileCount: 28
});

function artifact(overrides: (index: number, id: string) => Json | undefined = () => undefined): Json {
  const scenarios = INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS.map((id, index) => scenario(id, overrides(index, id) ?? {}));
  return {
    schemaVersion: INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2_EXPECTED,
    runId: "run",
    pluginId: "incremental-change-staleness",
    scenarios,
    summary: { scenarioCount: 6, readyScenarioCount: 6, failedScenarioCount: 0 }
  };
}

const withForcedNeighbor = (index: number) => (index === 2 ? { affected: FORCED_AFFECTED } : undefined);

describe("upstream pin for v0.6.3 acceptance", () => {
  it("requires 1.12.5 for current acceptance while keeping 1.12.4 as a distinct historical value", () => {
    expect(UPSTREAM_MY_DEV_KIT_VERSION).toBe("1.12.5");
    expect(HISTORICAL_V1_UPSTREAM_MY_DEV_KIT_VERSION).toBe("1.12.4");
  });
});

describe("evaluateIncrementalChangeStalenessV2Acceptance", () => {
  it("A/F: passes when all partials are applied and one scenario has a real forced-neighbor geometry difference", () => {
    const result = evaluateIncrementalChangeStalenessV2Acceptance(artifact(withForcedNeighbor));
    expect(result.problems).toEqual([]);
    expect(result.verdict).toBe("PASS");
    expect(result.discrimination).toBe("pass");
    expect(result.forcedNeighborScenarios).toEqual(["E1"]);
    expect(result.geometryDifferenceScenarios).toEqual(["E1"]);
    expect(result.rows).toHaveLength(24);
  });

  it("B: blocks with BLOCKED_SCENARIO_DISCRIMINATION_INSUFFICIENT when no scenario has a forced neighbor", () => {
    const result = evaluateIncrementalChangeStalenessV2Acceptance(artifact());
    expect(result.verdict).toBe("BLOCKED_SCENARIO_DISCRIMINATION_INSUFFICIENT");
    expect(result.discrimination).toBe("insufficient");
    expect(result.forcedNeighborScenarios).toEqual([]);
  });

  it("C: fails the discrimination invariant when a forced neighbor exists but affected fresh extraction does not exceed changed-files", () => {
    const flat = upstream("affected-neighborhood", { forcedNeighborReanalysisFileCount: 1, forcedNeighborSample: ["src/a.ts"], freshExtractionFileCount: 1, reusedFileCount: 30 });
    const result = evaluateIncrementalChangeStalenessV2Acceptance(artifact((index) => (index === 1 ? { affected: flat } : undefined)));
    expect(result.verdict).toBe("BLOCKED_SCENARIO_DISCRIMINATION_INSUFFICIENT");
    expect(result.discrimination).toBe("invariant-violation");
    expect(result.problems.join("\n")).toContain("[L2]");
  });

  it("D: a changed-files FALLBACK_FULL fails the realization gate and reports the fallback evidence", () => {
    const fallback = upstream("changed-files", { selectionStatus: "fallback-full", appliedScope: "full", fallbackReason: "baseline-hash-mismatch" });
    const result = evaluateIncrementalChangeStalenessV2Acceptance(artifact((index) => (index === 0 ? { changed: fallback, affected: undefined } : withForcedNeighbor(index))));
    expect(result.verdict).toBe("BLOCKED_CHANGED_FILES_PARTIAL_NOT_REALIZED");
    expect(result.changedFilesRealizationProblems.join("\n")).toContain("baseline-hash-mismatch");
    expect(result.discrimination).toBe("not-evaluated");
  });

  it("E: an affected-neighborhood FALLBACK_FULL fails the realization gate", () => {
    const fallback = upstream("affected-neighborhood", { selectionStatus: "fallback-full", appliedScope: "full", fallbackReason: "seed-selection-unavailable" });
    const result = evaluateIncrementalChangeStalenessV2Acceptance(artifact((index) => (index === 3 ? { affected: fallback } : withForcedNeighbor(index))));
    expect(result.verdict).toBe("BLOCKED_AFFECTED_NEIGHBORHOOD_PARTIAL_NOT_REALIZED");
    expect(result.affectedRealizationProblems.join("\n")).toContain("[P1]");
  });

  it("rejects a not-comparable partial classification in a production run", () => {
    const value = artifact(withForcedNeighbor);
    value.scenarios[0].referenceComparisons[1].classification = "not-comparable-as-partial-refresh";
    expect(evaluateIncrementalChangeStalenessV2Acceptance(value).verdict).toBe("BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH");
  });

  it("rejects the V1 schema, missing treatments, and missing comparisons", () => {
    expect(evaluateIncrementalChangeStalenessV2Acceptance({ ...artifact(withForcedNeighbor), schemaVersion: "my-dev-kit-lab-incremental-change-staleness-execution-v1" }).verdict).toBe(
      "BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH"
    );
    const missingTreatment = artifact(withForcedNeighbor);
    missingTreatment.scenarios[4].treatments = missingTreatment.scenarios[4].treatments.slice(0, 3);
    expect(evaluateIncrementalChangeStalenessV2Acceptance(missingTreatment).contractProblems.join("\n")).toContain("[I1] treatments are not exactly");
    const missingComparison = artifact(withForcedNeighbor);
    missingComparison.scenarios[5].referenceComparisons = missingComparison.scenarios[5].referenceComparisons.slice(0, 2);
    expect(evaluateIncrementalChangeStalenessV2Acceptance(missingComparison).contractProblems.join("\n")).toContain("[T1] reference comparisons are not exactly");
  });

  it("does not substitute zero for unavailable partial evidence", () => {
    const unavailable = upstream("affected-neighborhood", { forcedNeighborReanalysisFileCount: null, freshExtractionFileCount: null, reusedFileCount: null });
    const result = evaluateIncrementalChangeStalenessV2Acceptance(artifact((index) => (index === 0 ? { affected: unavailable } : withForcedNeighbor(index))));
    expect(result.verdict).toBe("BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH");
    expect(result.contractProblems.join("\n")).toContain("forcedNeighborReanalysisFileCount is unavailable");
    expect(result.discrimination).toBe("not-evaluated");
    const row = extractIncrementalChangeStalenessV2EvidenceRows(artifact((index) => (index === 0 ? { affected: unavailable } : undefined))).find(
      (entry) => entry.scenarioId === "U1" && entry.treatmentId === "affected-neighborhood-refresh"
    );
    expect(row?.forcedNeighborReanalysisFileCount).toBeNull();
  });

  it("bounds the forced-neighbor sample: cap, count, and nonempty when the count is positive", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `src/f${i}.ts`);
    const cases: Array<[Json, string]> = [
      [{ ...FORCED_AFFECTED, forcedNeighborReanalysisFileCount: 30, forcedNeighborSample: tooMany }, "above the cap"],
      [{ ...FORCED_AFFECTED, forcedNeighborReanalysisFileCount: 1, forcedNeighborSample: ["a.ts", "b.ts"] }, "exceeds forcedNeighborReanalysisFileCount"],
      [{ ...FORCED_AFFECTED, forcedNeighborSample: [] }, "empty forcedNeighborSample"],
      [{ ...FORCED_AFFECTED, forcedNeighborSample: [42] }, "not a list of path strings"]
    ];
    for (const [affected, message] of cases) {
      const result = evaluateIncrementalChangeStalenessV2Acceptance(artifact((index) => (index === 2 ? { affected } : undefined)));
      expect(result.contractProblems.join("\n")).toContain(message);
    }
    // A capped sample smaller than the count is accepted (upstream intentionally caps the public sample).
    const capped = { ...FORCED_AFFECTED, forcedNeighborReanalysisFileCount: 50, forcedNeighborSample: tooMany.slice(0, 20), freshExtractionFileCount: 51, reusedFileCount: 2 };
    expect(evaluateIncrementalChangeStalenessV2Acceptance(artifact((index) => (index === 2 ? { affected: capped } : undefined))).verdict).toBe("PASS");
  });

  it("requires stale-index no-refresh on the baseline and refreshed treatments to be fresh, without demanding a correctness difference", () => {
    const wrongStale = artifact(withForcedNeighbor);
    wrongStale.scenarios[0].treatments[0].baselineFreshness = fresh;
    expect(evaluateIncrementalChangeStalenessV2Acceptance(wrongStale).contractProblems.join("\n")).toContain("stale-index baseline freshness");
    const notFresh = artifact(withForcedNeighbor);
    notFresh.scenarios[1].treatments[2].refreshedFreshness = stale;
    expect(evaluateIncrementalChangeStalenessV2Acceptance(notFresh).contractProblems.join("\n")).toContain("affected-neighborhood-refresh refreshed freshness");
    // Identical correctness across all treatments (the default fixture) is a valid PASS.
    expect(evaluateIncrementalChangeStalenessV2Acceptance(artifact(withForcedNeighbor)).verdict).toBe("PASS");
  });

  it("rejects forbidden aggregate fields but not ordinary correctness score", () => {
    const value = artifact(withForcedNeighbor);
    expect(JSON.stringify(value)).toContain('"score"');
    expect(evaluateIncrementalChangeStalenessV2Acceptance(value).verdict).toBe("PASS");
    for (const key of ["winner", "bestTreatment", "rank", "safeToSkipRefresh", "refreshSafetyPercent"]) {
      const bad = artifact(withForcedNeighbor);
      bad[key] = "x";
      expect(evaluateIncrementalChangeStalenessV2Acceptance(bad).contractProblems.join("\n")).toContain(key);
    }
  });

  it("keeps the treatment id list in the frozen order", () => {
    expect([...INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED]).toEqual(["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]);
  });
});

describe("validateIncrementalChangeStalenessReportConsistencyV2", () => {
  const LIMITATIONS = ['Results are scoped to the "executed" scenarios.', "Full refresh is a comparison reference, not an asserted optimal strategy."];

  function inputs() {
    const value = artifact(withForcedNeighbor);
    const report = {
      incrementalChangeStaleness: {
        schemaVersion: "my-dev-kit-lab-incremental-change-staleness-report-v2",
        summary: structuredClone(value.summary),
        scenarios: structuredClone(value.scenarios),
        limitations: LIMITATIONS
      }
    };
    const markers = [
      "Reference Comparisons",
      "Refresh Execution",
      "No Refresh vs Full Refresh",
      "Changed-Files Refresh vs Full Refresh",
      "Affected-Neighborhood Refresh vs Full Refresh",
      "different evidence families",
      "Forced-neighbor reanalysis files",
      "NO_REFRESH APPLIED_PARTIAL FULL_REFRESH",
      "no-observed-stale-regression no-observed-regression-relative-to-full",
      ...INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS,
      ...INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED.map((id) => `(${id})`),
      ...LIMITATIONS
    ];
    const reportText = markers.join("\n");
    const reportHtml = markers.map((m) => m.replace(/&/g, "&amp;").replace(/"/g, "&quot;")).join("<br>");
    return { artifact: value, report, reportText, reportHtml, expectedLimitations: LIMITATIONS };
  }

  it("accepts consistent V2 JSON/text/HTML, comparing HTML after unescaping", () => {
    expect(validateIncrementalChangeStalenessReportConsistencyV2(inputs())).toEqual([]);
  });

  it("rejects a V1-shaped report section, missing text markers, and drifted limitations", () => {
    const v1 = inputs();
    (v1.report.incrementalChangeStaleness as Json).schemaVersion = "my-dev-kit-lab-incremental-change-staleness-report-v1";
    expect(validateIncrementalChangeStalenessReportConsistencyV2(v1).join("\n")).toContain("schemaVersion");
    const missing = inputs();
    missing.reportText = missing.reportText.replace("Changed-Files Refresh vs Full Refresh", "");
    expect(validateIncrementalChangeStalenessReportConsistencyV2(missing).join("\n")).toContain("report.txt lacks required section/label");
    const drift = inputs();
    (drift.report.incrementalChangeStaleness as Json).limitations = ["other"];
    expect(validateIncrementalChangeStalenessReportConsistencyV2(drift).join("\n")).toContain("limitations differ");
  });

  it("accepts the frozen negated disclaimer wording (not a declared best treatment)", () => {
    const ok = inputs();
    ok.reportText += " Full refresh is a comparison reference, not a declared best treatment.";
    ok.reportHtml += "<p>Full refresh is a comparison reference, not a declared best treatment.</p>";
    expect(validateIncrementalChangeStalenessReportConsistencyV2(ok)).toEqual([]);
  });

  it("rejects report/artifact disagreement, forbidden claims, and exposed context text", () => {
    const disagree = inputs();
    (disagree.report.incrementalChangeStaleness.scenarios[0] as Json).treatments = [];
    expect(validateIncrementalChangeStalenessReportConsistencyV2(disagree).join("\n")).toContain("[U1] report.json treatments disagrees");
    const claim = inputs();
    claim.reportHtml += " Partial refresh is safe";
    expect(validateIncrementalChangeStalenessReportConsistencyV2(claim).join("\n")).toContain("forbidden claim");
    const leak = inputs();
    leak.reportHtml += " contextText";
    expect(validateIncrementalChangeStalenessReportConsistencyV2(leak).join("\n")).toContain("raw retrieved context text");
  });
});
