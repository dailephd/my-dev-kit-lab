import { afterEach, describe, expect, it } from "vitest";
import type { AffectedNeighborhoodAssessmentV1 } from "../../../src/evaluation/affectedNeighborhood.js";
import {
  defaultIncrementalChangeStalenessExecutionDeps,
  type IncrementalChangeStalenessExecutionDeps
} from "../../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import { checkAffectedNeighborhoodFourWaySymmetry } from "../../../src/experiments/plugins/incrementalChangeStaleness/executionV2.js";
import { incrementalChangeStalenessPlugin } from "../../../src/experiments/plugins/incrementalChangeStaleness/plugin.js";
import type { IncrementalChangeStalenessLifecycleResultV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/treatmentSessionV2.js";
import { cleanup, prepareAndExecuteV2 } from "./executionV2TestHelpers.js";
import { expectCanonicalFilesUnchanged, expectNoIndexOutputInCanonicalProjects } from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
afterEach(async () => {
  await cleanup(tracked);
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

const ORDER = ["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"] as const;

function norm(value: string): string {
  return value.split("\\").join("/");
}

function recordingDeps() {
  const retrievals: Array<{ indexDir: string; commandsDir: string; taskId: string; query: string }> = [];
  const agents: Array<{ outDir: string; runId: string; taskId: string; query: string }> = [];
  const deps: IncrementalChangeStalenessExecutionDeps = {
    runRetrieval: async (args) => {
      retrievals.push({ indexDir: args.indexDir, commandsDir: args.commandsDir, taskId: args.derivedTask.id, query: args.derivedTask.query });
      return defaultIncrementalChangeStalenessExecutionDeps.runRetrieval(args);
    },
    runFakeAgent: async (args) => {
      agents.push({ outDir: args.outDir, runId: args.runId, taskId: args.derivedTask.id, query: args.derivedTask.query });
      return defaultIncrementalChangeStalenessExecutionDeps.runFakeAgent(args);
    }
  };
  return { deps, retrievals, agents };
}

describe("v0.6.3 four-treatment execution", () => {
  it("executes the four treatments once each in fixed order, each against only its own active index, with one shared derived task", async () => {
    const { deps, retrievals, agents } = recordingDeps();
    const { execution, lifecycle } = await prepareAndExecuteV2(tracked, "U1", { execDeps: deps });
    if (lifecycle.status !== "ready") throw new Error("lifecycle not ready");
    expect(execution.status).toBe("ready");
    expect(execution.treatments.map((t) => t.treatmentId)).toEqual([...ORDER]);
    expect(retrievals).toHaveLength(4);
    expect(agents).toHaveLength(4);
    ORDER.forEach((id, index) => {
      expect(retrievals[index].indexDir).toBe(lifecycle.session.treatments[id].activeRetrieval.index.indexDir);
      expect(norm(retrievals[index].commandsDir)).toContain(`/commands/U1/${id}/retrieval`);
      expect(norm(agents[index].outDir)).toContain(`/agents/U1/${id}`);
      expect(agents[index].runId.endsWith(`.${id}`)).toBe(true);
    });
    // Same derived task/query for all four matched treatments; no treatment reads another's directory.
    expect(new Set(retrievals.map((r) => r.taskId)).size).toBe(1);
    expect(new Set(retrievals.map((r) => r.query)).size).toBe(1);
    expect(new Set(retrievals.map((r) => r.indexDir)).size).toBe(4);
    expect(execution.query).toBe(retrievals[0].query);
  }, 120_000);

  it("persists refresh execution from lifecycle truth: no-refresh, applied partials with exact upstream evidence, and full", async () => {
    const { execution, lifecycle } = await prepareAndExecuteV2(tracked, "U1");
    if (lifecycle.status !== "ready") throw new Error("lifecycle not ready");
    const [stale, changed, affected, full] = execution.treatments;
    expect(stale.refreshExecution).toEqual({ kind: "no-refresh", realization: "NO_REFRESH", incrementalRefresh: null });
    expect(full.refreshExecution).toEqual({ kind: "full", realization: "FULL_REFRESH", incrementalRefresh: null });
    expect(changed.refreshExecution.kind).toBe("incremental");
    expect(changed.refreshExecution.realization).toBe("APPLIED_PARTIAL");
    expect(changed.refreshExecution.incrementalRefresh).toEqual(lifecycle.session.treatments["changed-files-refresh"].refreshedIndex.incrementalRefresh);
    expect(changed.refreshExecution.incrementalRefresh).toMatchObject({ requestedScope: "changed-files", appliedScope: "changed-files", selectionStatus: "applied" });
    expect(affected.refreshExecution.realization).toBe("APPLIED_PARTIAL");
    expect(affected.refreshExecution.incrementalRefresh).toMatchObject({
      requestedScope: "affected-neighborhood",
      appliedScope: "affected-neighborhood",
      selectionStatus: "applied",
      seedFileCount: 1,
      seedSymbolCount: 2,
      affectedNodeCount: 5,
      affectedEdgeCount: 4,
      forcedNeighborReanalysisFileCount: 0,
      forcedNeighborSample: [],
      freshExtractionFileCount: 1,
      reusedFileCount: 9
    });
    expect(stale.activeIndexPhase).toBe("baseline");
    expect([changed, affected, full].map((t) => t.activeIndexPhase)).toEqual(["refreshed", "refreshed", "refreshed"]);
    expect(stale.refreshedFreshness).toBeNull();
    expect([changed, affected, full].map((t) => t.refreshedFreshness?.status)).toEqual(["fresh", "fresh", "fresh"]);
    // Affected-neighborhood evidence comes from the ORIGINAL baseline authority (all four baselines stale).
    expect(execution.treatments.map((t) => t.baselineFreshness.status)).toEqual(["stale", "stale", "stale", "stale"]);
  }, 120_000);

  it.each(["changed-files", "affected-neighborhood"] as const)("keeps a truthful %s fallback-full as FALLBACK_FULL without failing the execution", async (scope) => {
    const { execution } = await prepareAndExecuteV2(tracked, "U1", { kit: { refresh: { [scope]: "fallback" } } });
    expect(execution.status).toBe("ready");
    const id = scope === "changed-files" ? "changed-files-refresh" : "affected-neighborhood-refresh";
    const treatment = execution.treatments.find((t) => t.treatmentId === id)!;
    expect(treatment.refreshExecution.realization).toBe("FALLBACK_FULL");
    expect(treatment.refreshExecution.incrementalRefresh).toMatchObject({
      requestedScope: scope,
      appliedScope: "full",
      selectionStatus: "fallback-full",
      fallbackReason: "seed-selection-unavailable"
    });
    // Retrieval/evaluation status is independent of the fallback.
    expect(treatment.retrievalStatus).not.toBe("failed");
    const comparison = execution.referenceComparisons.find((c) => c.candidateTreatmentId === id)!;
    expect(comparison.kind === "partial-refresh" && comparison.classification).toBe("not-comparable-as-partial-refresh");
    expect(comparison.kind === "partial-refresh" && comparison.reasonCodes).toEqual(["candidate-fell-back-to-full"]);
  }, 120_000);

  it("builds exactly three reference comparisons against full-refresh with no winner, rank, or safety fields", async () => {
    const { execution } = await prepareAndExecuteV2(tracked, "U1");
    expect(execution.referenceComparisons.map((c) => [c.candidateTreatmentId, c.referenceTreatmentId, c.kind])).toEqual([
      ["stale-index", "full-refresh", "stale-risk"],
      ["changed-files-refresh", "full-refresh", "partial-refresh"],
      ["affected-neighborhood-refresh", "full-refresh", "partial-refresh"]
    ]);
    const text = JSON.stringify(execution.referenceComparisons);
    for (const forbidden of ["winner", "bestTreatment", "recommendedTreatment", "rank", "safetyPercent", "staleRiskPercent", "safeToSkipRefresh", "automaticRefreshChoice"]) {
      expect(text).not.toContain(forbidden);
    }
  }, 120_000);

  it("classifies stale via the unchanged stale-risk rules and partials via neutral full-reference rules from required-file evidence", async () => {
    const { execution } = await prepareAndExecuteV2(tracked, "T1", {
      searchByTreatment: { "stale-index": "missing", "changed-files-refresh": "missing", "affected-neighborhood-refresh": "present", "full-refresh": "present" }
    });
    const [stale, changed, affected] = execution.referenceComparisons;
    expect(stale.kind === "stale-risk" && stale.comparison.requiredFileEvidenceRelation).toBe("stale-worse");
    expect(stale.kind === "stale-risk" && stale.comparison.staleRiskClassification).toBe("observed-stale-regression");
    expect(stale.kind === "stale-risk" && stale.comparison.reasonCodes).toContain("stale-missing-required-file");
    expect(changed.kind === "partial-refresh" && changed.requiredFileEvidenceRelation).toBe("candidate-worse");
    expect(changed.kind === "partial-refresh" && changed.classification).toBe("observed-regression-relative-to-full");
    expect(changed.kind === "partial-refresh" && changed.reasonCodes).toContain("candidate-missing-required-file");
    expect(affected.kind === "partial-refresh" && affected.classification).toBe("no-observed-regression-relative-to-full");
  }, 120_000);

  it("treats a candidate that reads the required file while full-refresh does not as no observed regression (not a winner)", async () => {
    const { execution } = await prepareAndExecuteV2(tracked, "T1", {
      searchByTreatment: { "stale-index": "present", "changed-files-refresh": "present", "affected-neighborhood-refresh": "present", "full-refresh": "missing" }
    });
    const changed = execution.referenceComparisons[1];
    expect(changed.kind === "partial-refresh" && changed.requiredFileEvidenceRelation).toBe("candidate-better");
    expect(changed.kind === "partial-refresh" && changed.classification).toBe("no-observed-regression-relative-to-full");
  }, 120_000);

  it("retains other treatments' evidence and marks the comparison inconclusive when one retrieval throws", async () => {
    const deps: IncrementalChangeStalenessExecutionDeps = {
      ...defaultIncrementalChangeStalenessExecutionDeps,
      runRetrieval: async (args) => {
        if (norm(args.indexDir).includes("/affected-neighborhood-refresh/")) throw new Error("forced retrieval failure");
        return defaultIncrementalChangeStalenessExecutionDeps.runRetrieval(args);
      }
    };
    const { execution } = await prepareAndExecuteV2(tracked, "U1", { execDeps: deps });
    expect(execution.status).toBe("ready");
    const affected = execution.treatments[2];
    expect(affected.status).toBe("partial");
    expect(affected.retrieval).toBeNull();
    expect(affected.fakeAgent).toBeNull();
    expect(affected.requiredFileEvidence.status).toBe("unknown");
    expect(affected.failureReason).toContain("forced retrieval failure");
    expect(execution.treatments.filter((t) => t.retrieval !== null)).toHaveLength(3);
    const comparison = execution.referenceComparisons[2];
    expect(comparison.kind === "partial-refresh" && comparison.classification).toBe("inconclusive");
    expect(comparison.kind === "partial-refresh" && comparison.reasonCodes).toEqual(["correctness-unavailable", "required-file-evidence-unavailable"]);
  }, 120_000);

  it("reports a failed lifecycle as a failed scenario with no treatment evidence and inconclusive placeholders", async () => {
    const { execution } = await prepareAndExecuteV2(tracked, "U1", { kit: { bootstrap: "wrong-reason" } });
    expect(execution.status).toBe("failed");
    expect(execution.session).toBeNull();
    expect(execution.treatments).toEqual([]);
    expect(execution.failureReason).toContain("baseline-bootstrap-contract-mismatch");
    expect(execution.referenceComparisons).toHaveLength(3);
    for (const comparison of execution.referenceComparisons) {
      if (comparison.kind === "stale-risk") {
        expect(comparison.comparison.staleRiskClassification).toBe("inconclusive");
      } else {
        expect(comparison.classification).toBe("inconclusive");
        expect(comparison.refreshRealization).toBeNull();
      }
    }
  }, 120_000);

  it("fails the scenario before any retrieval when equivalent treatments produce asymmetric affected-neighborhood evidence", async () => {
    const { deps, retrievals } = recordingDeps();
    const transform = (lifecycle: IncrementalChangeStalenessLifecycleResultV2): IncrementalChangeStalenessLifecycleResultV2 => {
      if (lifecycle.status !== "ready") return lifecycle;
      const full = lifecycle.session.treatments["full-refresh"];
      // One treatment's baseline change authority disagrees: no confirmed changes at all.
      const doctored = {
        ...full,
        changeAuthority: {
          ...full.changeAuthority,
          postMutationBaselineFreshness: { ...full.changeAuthority.postMutationBaselineFreshness, changes: [], changedFileCount: 0, status: "fresh" as const }
        }
      };
      return { status: "ready", session: { ...lifecycle.session, treatments: { ...lifecycle.session.treatments, "full-refresh": doctored } } };
    };
    const { execution } = await prepareAndExecuteV2(tracked, "U1", { execDeps: deps, transformLifecycle: transform });
    expect(execution.status).toBe("failed");
    expect(execution.failureReason).toContain("AFFECTED_NEIGHBORHOOD_ASYMMETRY");
    expect(execution.failureReason).toContain("full-refresh");
    expect(execution.treatments).toEqual([]);
    expect(retrievals).toHaveLength(0);
  }, 120_000);

  it("four-way symmetry compares every treatment to the stale-index reference, including seedNodeCount", async () => {
    const { execution } = await prepareAndExecuteV2(tracked, "U1");
    const assessments = Object.fromEntries(execution.treatments.map((t) => [t.treatmentId, t.affectedNeighborhood])) as Record<(typeof ORDER)[number], AffectedNeighborhoodAssessmentV1>;
    expect(checkAffectedNeighborhoodFourWaySymmetry(assessments)).toEqual({ symmetric: true });
    const tweaked = { ...assessments, "changed-files-refresh": { ...assessments["changed-files-refresh"], seedNodeCount: assessments["changed-files-refresh"].seedNodeCount + 1 } };
    const result = checkAffectedNeighborhoodFourWaySymmetry(tweaked);
    expect(result.symmetric).toBe(false);
    expect(!result.symmetric && result.reason).toContain("changed-files-refresh: seedNodeCount");
    const altered = {
      ...assessments,
      "affected-neighborhood-refresh": { ...assessments["affected-neighborhood-refresh"], taskOverlapCount: (assessments["affected-neighborhood-refresh"].taskOverlapCount ?? 0) + 1 }
    };
    expect(checkAffectedNeighborhoodFourWaySymmetry(altered).symmetric).toBe(false);
  }, 120_000);

  it("leaves the public plugin at the released two-treatment surface", () => {
    expect([...(incrementalChangeStalenessPlugin.supportedVariants ?? [])]).toEqual(["stale-index", "full-refresh"]);
  });
});
