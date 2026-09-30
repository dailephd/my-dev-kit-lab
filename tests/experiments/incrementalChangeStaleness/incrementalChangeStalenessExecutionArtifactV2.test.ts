import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildIncrementalChangeStalenessExecutionArtifact,
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION
} from "../../../src/experiments/plugins/incrementalChangeStaleness/executionArtifact.js";
import {
  buildIncrementalChangeStalenessExecutionArtifactV2,
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2,
  parseIncrementalChangeStalenessExecutionArtifact,
  readIncrementalChangeStalenessExecutionArtifact,
  validateIncrementalChangeStalenessExecutionArtifactV2,
  writeIncrementalChangeStalenessExecutionArtifactV2,
  type IncrementalChangeStalenessExecutionArtifactV2
} from "../../../src/experiments/plugins/incrementalChangeStaleness/executionArtifactV2.js";
import type { IncrementalChangeStalenessScenarioExecutionV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/executionV2.js";
import { cleanup, prepareAndExecuteV2 } from "./executionV2TestHelpers.js";
import { expectCanonicalFilesUnchanged, expectNoIndexOutputInCanonicalProjects } from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
const outDirs: string[] = [];
let ready: IncrementalChangeStalenessScenarioExecutionV2;
let fallbackReady: IncrementalChangeStalenessScenarioExecutionV2;
let failed: IncrementalChangeStalenessScenarioExecutionV2;

beforeAll(async () => {
  ready = (await prepareAndExecuteV2(tracked, "U1")).execution;
  fallbackReady = (
    await prepareAndExecuteV2(tracked, "T1", {
      kit: { refresh: { "changed-files": "fallback" } },
      searchByTreatment: { "stale-index": "missing", "changed-files-refresh": "missing", "affected-neighborhood-refresh": "missing", "full-refresh": "present" }
    })
  ).execution;
  failed = (await prepareAndExecuteV2(tracked, "L2", { kit: { bootstrap: "wrong-reason" } })).execution;
}, 300_000);

afterAll(async () => {
  await cleanup(tracked);
});

afterEach(() => {
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

function build(...executions: IncrementalChangeStalenessScenarioExecutionV2[]): IncrementalChangeStalenessExecutionArtifactV2 {
  return buildIncrementalChangeStalenessExecutionArtifactV2({ runId: "run-1", pluginId: "incremental-change-staleness", executions });
}

function expectRejected(mutate: (scenario: IncrementalChangeStalenessExecutionArtifactV2["scenarios"][number]) => void, message: string) {
  const artifact = structuredClone(build(ready));
  mutate(artifact.scenarios[0]);
  expect(() => validateIncrementalChangeStalenessExecutionArtifactV2(artifact)).toThrow(message);
}

describe("v2 execution artifact shape", () => {
  it("has a distinct v2 schema and an ordered four-treatment / three-comparison scenario record", () => {
    const artifact = build(ready);
    expect(artifact.schemaVersion).toBe("my-dev-kit-lab-incremental-change-staleness-execution-v2");
    expect(artifact.schemaVersion).not.toBe(INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION);
    const scenario = artifact.scenarios[0];
    expect(scenario.status).toBe("ready");
    expect(scenario.treatments.map((t) => [t.treatmentId, t.treatmentIntent])).toEqual([
      ["stale-index", "my-dev-kit-no-refresh"],
      ["changed-files-refresh", "my-dev-kit-changed-files-refresh"],
      ["affected-neighborhood-refresh", "my-dev-kit-affected-neighborhood-refresh"],
      ["full-refresh", "my-dev-kit-full-refresh"]
    ]);
    expect(scenario.referenceComparisons.map((c) => [c.candidateTreatmentId, c.referenceTreatmentId])).toEqual([
      ["stale-index", "full-refresh"],
      ["changed-files-refresh", "full-refresh"],
      ["affected-neighborhood-refresh", "full-refresh"]
    ]);
    expect(scenario.treatments.map((t) => t.refreshExecution.realization)).toEqual(["NO_REFRESH", "APPLIED_PARTIAL", "APPLIED_PARTIAL", "FULL_REFRESH"]);
    for (const treatment of scenario.treatments) {
      expect(treatment).toHaveProperty("baselineFreshness");
      expect(treatment).toHaveProperty("affectedNeighborhood");
      expect(treatment).toHaveProperty("requiredFileEvidence");
      expect(treatment).toHaveProperty("fakeAgent");
    }
  });

  it("records a bounded lifecycle summary", () => {
    const lifecycle = build(ready).scenarios[0].lifecycle!;
    expect(lifecycle.indexInvocationCounts).toEqual({ "stale-index": 1, "changed-files-refresh": 2, "affected-neighborhood-refresh": 2, "full-refresh": 2 });
    expect(lifecycle.freshnessAssessmentCounts).toEqual({ "stale-index": 1, "changed-files-refresh": 2, "affected-neighborhood-refresh": 2, "full-refresh": 2 });
    expect(lifecycle.totalIndexInvocationCount).toBe(7);
    expect(lifecycle.totalFreshnessAssessmentCount).toBe(7);
    expect(lifecycle.preMutationEquivalence).toEqual({ "changed-files-refresh": "equivalent", "affected-neighborhood-refresh": "equivalent", "full-refresh": "equivalent" });
    expect(lifecycle.postMutationEquivalence).toEqual({ "changed-files-refresh": "equivalent", "affected-neighborhood-refresh": "equivalent", "full-refresh": "equivalent" });
    expect(Object.values(lifecycle.baselineFreshnessStatus)).toEqual(["stale", "stale", "stale", "stale"]);
    expect(lifecycle.refreshedFreshnessStatus).toEqual({ "changed-files-refresh": "fresh", "affected-neighborhood-refresh": "fresh", "full-refresh": "fresh" });
    expect(lifecycle.partialRealization).toEqual({ "changed-files-refresh": "APPLIED_PARTIAL", "affected-neighborhood-refresh": "APPLIED_PARTIAL" });
    expect(lifecycle.treatmentIntents["full-refresh"]).toBe("my-dev-kit-full-refresh");
    expect(lifecycle.controlledFilePaths.length).toBeGreaterThan(0);
    expect(lifecycle.sourceRoots.length).toBeGreaterThan(0);
  });

  it("never serializes raw retrieved context or graph bodies", () => {
    const withContext = ready.treatments.find((t) => (t.retrieval?.contextText ?? "").length > 20);
    const text = JSON.stringify(build(ready));
    expect(text).not.toContain('"contextText"');
    if (withContext) expect(text).not.toContain(withContext.retrieval!.contextText.slice(0, 40));
    expect(text).not.toContain('"codeGraph"');
  });

  it("preserves a failed scenario with no fabricated treatments and three placeholder comparisons", () => {
    const scenario = build(failed).scenarios[0];
    expect(scenario.status).toBe("failed");
    expect(scenario.lifecycle).toBeNull();
    expect(scenario.treatments).toEqual([]);
    expect(scenario.referenceComparisons).toHaveLength(3);
    expect(() => validateIncrementalChangeStalenessExecutionArtifactV2(build(failed))).not.toThrow();
  });
});

describe("v2 artifact summary counts", () => {
  it("derives descriptive counts deterministically from scenario records", () => {
    const summary = build(ready, fallbackReady, failed).summary;
    expect(summary.scenarioCount).toBe(3);
    expect(summary.readyScenarioCount).toBe(2);
    expect(summary.failedScenarioCount).toBe(1);
    expect(summary.changedFilesAppliedPartialCount).toBe(1);
    expect(summary.changedFilesFallbackFullCount).toBe(1);
    expect(summary.affectedNeighborhoodAppliedPartialCount).toBe(2);
    expect(summary.affectedNeighborhoodFallbackFullCount).toBe(0);
    expect(summary.changedFilesNotComparableCount).toBe(1);
    expect(summary.changedFilesInconclusiveCount).toBe(1); // the failed-scenario placeholder
    // T1 (missing everywhere except full) makes stale and the applied affected-neighborhood partial regress relative to full.
    expect(summary.staleObservedRegressionCount).toBe(1);
    expect(summary.affectedNeighborhoodObservedRegressionRelativeToFullCount).toBe(1);
    // Totals of each family equal the scenario count: every scenario lands in exactly one class.
    const changedTotal =
      summary.changedFilesObservedRegressionRelativeToFullCount +
      summary.changedFilesNoObservedRegressionRelativeToFullCount +
      summary.changedFilesInconclusiveCount +
      summary.changedFilesNotComparableCount;
    expect(changedTotal).toBe(3);
    const staleTotal = summary.staleObservedRegressionCount + summary.staleNoObservedRegressionCount + summary.staleInconclusiveCount;
    expect(staleTotal).toBe(3);
    // Identical input gives an identical artifact.
    expect(build(ready, fallbackReady, failed)).toEqual(build(ready, fallbackReady, failed));
    for (const key of Object.keys(summary)) expect(key).not.toMatch(/score|rank|winner|best/i);
  });
});

describe("v2 artifact contradiction rejection", () => {
  it("rejects a duplicate treatment", () =>
    expectRejected((s) => {
      s.treatments[3] = structuredClone(s.treatments[2]);
    }, "each once, in order"));

  it("rejects a missing treatment", () =>
    expectRejected((s) => {
      s.treatments.pop();
    }, "each once, in order"));

  it("rejects an invalid treatment order", () =>
    expectRejected((s) => {
      [s.treatments[1], s.treatments[2]] = [s.treatments[2], s.treatments[1]];
    }, "each once, in order"));

  it("rejects a wrong treatment intent", () =>
    expectRejected((s) => {
      s.treatments[1].treatmentIntent = "my-dev-kit-full-refresh" as never;
    }, "treatment intent"));

  it("rejects incrementalRefresh evidence on full-refresh", () =>
    expectRejected((s) => {
      s.treatments[3].refreshExecution = structuredClone(s.treatments[1].refreshExecution) as never;
    }, "full-refresh must be a full refresh"));

  it("rejects incrementalRefresh evidence on stale-index", () =>
    expectRejected((s) => {
      s.treatments[0].refreshExecution = structuredClone(s.treatments[1].refreshExecution) as never;
    }, "stale-index must be no-refresh"));

  it("rejects APPLIED_PARTIAL whose upstream applied scope is full", () =>
    expectRejected((s) => {
      const refresh = s.treatments[1].refreshExecution;
      if (refresh.kind === "incremental") refresh.incrementalRefresh.appliedScope = "full";
    }, "is APPLIED_PARTIAL but upstream reported"));

  it("rejects FALLBACK_FULL whose upstream applied scope is the requested partial scope", () => {
    const artifact = structuredClone(build(fallbackReady));
    const treatment = artifact.scenarios[0].treatments[1];
    if (treatment.refreshExecution.kind === "incremental") {
      treatment.refreshExecution.incrementalRefresh.appliedScope = "changed-files";
    }
    expect(() => validateIncrementalChangeStalenessExecutionArtifactV2(artifact)).toThrow("is FALLBACK_FULL but upstream reported");
  });

  it("rejects a fallback treatment whose comparison is not classified not-comparable", () => {
    const artifact = structuredClone(build(fallbackReady));
    const comparison = artifact.scenarios[0].referenceComparisons[1];
    if (comparison.kind === "partial-refresh") {
      comparison.classification = "no-observed-regression-relative-to-full";
      comparison.reasonCodes = ["no-reference-regression-observed"];
    }
    expect(() => validateIncrementalChangeStalenessExecutionArtifactV2(artifact)).toThrow("does not follow the partial-refresh reference rules");
  });

  it("rejects a comparison whose realization disagrees with its treatment", () =>
    expectRejected((s) => {
      const comparison = s.referenceComparisons[1];
      if (comparison.kind === "partial-refresh") comparison.refreshRealization = "FALLBACK_FULL";
    }, "differs from the treatment realization"));

  it("rejects a missing comparison", () =>
    expectRejected((s) => {
      s.referenceComparisons.pop();
    }, "reference comparisons must be exactly"));

  it("rejects a comparison referencing the wrong reference treatment", () =>
    expectRejected((s) => {
      (s.referenceComparisons[2] as { referenceTreatmentId: string }).referenceTreatmentId = "stale-index";
    }, "not full-refresh"));

  it("rejects a full-refresh comparison against itself", () =>
    expectRejected((s) => {
      (s.referenceComparisons[2] as { candidateTreatmentId: string }).candidateTreatmentId = "full-refresh";
    }, "reference comparisons must be exactly"));

  it("rejects a stale comparison that does not follow the stale-risk rules", () =>
    expectRejected((s) => {
      const stale = s.referenceComparisons[0];
      if (stale.kind === "stale-risk") stale.comparison.staleRiskClassification = stale.comparison.staleRiskClassification === "inconclusive" ? "observed-stale-regression" : "inconclusive";
    }, "stale-risk classification rules"));

  it("rejects a refreshed stale-index active index or missing refreshed freshness", () => {
    expectRejected((s) => {
      s.treatments[0].activeIndexPhase = "refreshed";
    }, "stale-index active index must be the baseline");
    expectRejected((s) => {
      s.treatments[2].refreshedFreshness = null;
    }, "missing refreshed freshness");
  });

  it("never writes contradictory evidence", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "ics-artifact-v2-"));
    outDirs.push(outDir);
    const artifact = structuredClone(build(ready));
    artifact.scenarios[0].treatments.pop();
    await expect(writeIncrementalChangeStalenessExecutionArtifactV2(outDir, artifact)).rejects.toThrow("each once, in order");
    expect(existsSync(path.join(outDir, "incremental-change-staleness-execution.json"))).toBe(false);
  });
});

describe("v1 / v2 coexistence", () => {
  it("writes v2 to the canonical filename and reads it back as v2, leaving the v1 builder and schema untouched", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "ics-artifact-v2-"));
    outDirs.push(outDir);
    const artifact = build(ready);
    const written = await writeIncrementalChangeStalenessExecutionArtifactV2(outDir, artifact);
    expect(path.basename(written)).toBe("incremental-change-staleness-execution.json");
    const parsedFromDisk = JSON.parse(readFileSync(written, "utf8"));
    expect(parsedFromDisk.schemaVersion).toBe(INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2);
    const read = await readIncrementalChangeStalenessExecutionArtifact(written);
    expect(read.version).toBe("v2");

    const v1 = buildIncrementalChangeStalenessExecutionArtifact({ runId: "run-1", pluginId: "incremental-change-staleness", executions: [] });
    expect(v1.schemaVersion).toBe("my-dev-kit-lab-incremental-change-staleness-execution-v1");
    expect(parseIncrementalChangeStalenessExecutionArtifact(v1).version).toBe("v1");
    expect(() => parseIncrementalChangeStalenessExecutionArtifact({ schemaVersion: "other" })).toThrow("Unrecognized");
  });
});
