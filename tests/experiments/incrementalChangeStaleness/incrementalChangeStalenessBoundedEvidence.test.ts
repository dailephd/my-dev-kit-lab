import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOUNDED_SOURCE_PROTOCOL_ID,
  type MyDevKitBoundedCoverageV1,
  type MyDevKitBoundedRetrievalResult
} from "../../../src/evaluation/runMyDevKitRetrieval.js";
import type { MyDevKitRetrievalResult } from "../../../src/evaluation/types.js";
import { tokenCountMethod } from "../../../src/core/countTokens.js";
import {
  classifyStaleRisk,
  compareRequiredFileEvidence,
  compareRequiredFileEvidenceAgainstReference,
  type RequiredFileEvidenceV1
} from "../../../src/experiments/plugins/incrementalChangeStaleness/comparison.js";
import {
  classifyPartialRefreshAgainstFull,
  compareCandidateRequiredFileEvidence,
  compareCandidateRequiredFileEvidenceAgainstReference
} from "../../../src/experiments/plugins/incrementalChangeStaleness/comparisonV2.js";
import {
  buildIncrementalChangeStalenessRequiredFileEvidence,
  resolveIncrementalChangeStalenessScenarioTask,
  runIncrementalChangeStalenessFakeAgent
} from "../../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import {
  buildReferenceComparisons,
  type IncrementalChangeStalenessTreatmentExecutionV2
} from "../../../src/experiments/plugins/incrementalChangeStaleness/executionV2.js";
import type { PartialRefreshRealization } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecyclePolicyV2.js";
import { loadProjectProfiles } from "./executionV2TestHelpers.js";
import { makeRunOwnedRoot, repoRoot, resolveScenario } from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function files(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `src/file${index + 1}.ts`);
}

function boundedRetrieval(
  sourced: readonly string[],
  overrides: Partial<MyDevKitBoundedCoverageV1> & { failed?: readonly string[] } = {}
): MyDevKitBoundedRetrievalResult {
  const { failed = [], ...coverageOverrides } = overrides;
  const attempts = [...sourced.map((file) => ({ file, nodeId: `file:${file}`, sourced: true })), ...failed.map((file) => ({ file, nodeId: `file:${file}`, sourced: false }))];
  return {
    caseId: "case",
    skipped: false,
    warnings: [],
    totalChars: 10,
    totalEstimatedTokens: 3,
    tokenCountMethod,
    contextText: "context",
    filesRead: [...sourced],
    commands: [],
    durationMs: 1,
    boundedCoverage: {
      protocol: BOUNDED_SOURCE_PROTOCOL_ID,
      maxSourceFiles: 8,
      searchLimit: 40,
      searchResultCount: attempts.length,
      searchTruncated: false,
      eligibleCandidateFileCount: attempts.length,
      candidateBudgetExhausted: false,
      rejectedCandidateCount: 0,
      attempts,
      ...coverageOverrides
    }
  };
}

describe("bounded required-file evidence (multi-file observation)", () => {
  it.each([1, 2, 3, 5])("is present only when all %i required files were actually sourced", (count) => {
    const required = files(count);
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: required, retrieval: boundedRetrieval(required) });
    expect(evidence).toMatchObject({ status: "present", missingFiles: [], reason: null });
    expect(evidence.observedFiles).toEqual(required);
  });

  it.each([2, 3, 5])("credits only sourced files when %i are required and one is not sourced", (count) => {
    const required = files(count);
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: required, retrieval: boundedRetrieval(required.slice(1)) });
    expect(evidence.status).toBe("missing");
    expect(evidence.missingFiles).toEqual([required[0]]);
    expect(evidence.observedFiles).toEqual(required.slice(1));
    // A missing result states it is relative to the bounded protocol and not an exhaustive assessment.
    expect(evidence.reason).toContain("not an exhaustive source-set assessment");
  });

  it("classifies a protocol that cannot source as many files as are required as unknown, not missing", () => {
    const required = files(5);
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({
      requiredFiles: required,
      retrieval: boundedRetrieval([required[0]], { maxSourceFiles: 1 })
    });
    expect(evidence.status).toBe("unknown");
    expect(evidence.reason).toContain("Coverage-limited");
    expect(evidence.missingFiles).toEqual([]);
  });

  it("classifies unsourced required files as unknown when a bounded source command failed", () => {
    const required = files(3);
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({
      requiredFiles: required,
      retrieval: boundedRetrieval([required[0]], { failed: [required[1]] })
    });
    expect(evidence.status).toBe("unknown");
    expect(evidence.reason).toContain("failed");
    expect(evidence.observedFiles).toEqual([required[0]]);
  });

  it("classifies unsourced required files as unknown when candidate identities were rejected", () => {
    const required = files(2);
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({
      requiredFiles: required,
      retrieval: boundedRetrieval([required[0]], { rejectedCandidateCount: 1 })
    });
    expect(evidence.status).toBe("unknown");
    expect(evidence.reason).toContain("rejected");
  });

  it("does not turn a surfaced-but-unsourced file into an observation", () => {
    const required = files(2);
    const retrieval = boundedRetrieval([required[0]], { eligibleCandidateFileCount: 6, candidateBudgetExhausted: true, searchTruncated: true });
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: required, retrieval });
    expect(evidence.status).toBe("missing");
    expect(evidence.observedFiles).toEqual([required[0]]);
    expect(evidence.reason).toContain("candidate budget exhausted: yes");
    expect(evidence.reason).toContain("search truncated: yes");
  });

  it("treats an empty complete bounded observation as missing, never as satisfied", () => {
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: files(2), retrieval: boundedRetrieval([]) });
    expect(evidence.status).toBe("missing");
    expect(evidence.observedFiles).toEqual([]);
  });

  it("normalizes required and observed path spelling before comparing", () => {
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({
      requiredFiles: ["./src/file1.ts", "src\\file2.ts"],
      retrieval: boundedRetrieval(["src/file1.ts", "src/file2.ts"])
    });
    expect(evidence.status).toBe("present");
  });

  it("keeps a failed bounded retrieval unknown through the historical failed-retrieval rule", () => {
    const failed: MyDevKitBoundedRetrievalResult = {
      ...boundedRetrieval([]),
      skipped: true,
      warnings: ["my-dev-kit search command failed."],
      commands: [{ commandId: "search", ok: false } as MyDevKitRetrievalResult["commands"][number]]
    };
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: files(1), retrieval: failed });
    expect(evidence.status).toBe("unknown");
    expect(evidence.reason).toContain("Retrieval failed");
  });

  it("keeps the historical rule for a plain (non-bounded) retrieval result", () => {
    const plain: MyDevKitRetrievalResult = { ...boundedRetrieval(["src/file1.ts"]) };
    delete (plain as Partial<MyDevKitBoundedRetrievalResult>).boundedCoverage;
    expect(buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: files(2), retrieval: plain })).toMatchObject({
      status: "missing",
      reason: null
    });
  });
});

function evidence(status: RequiredFileEvidenceV1["status"]): RequiredFileEvidenceV1 {
  return { status, requiredFiles: ["src/a.ts"], observedFiles: [], missingFiles: [], reason: null };
}

describe("reference-adequacy gate for required-file relations", () => {
  it("keeps the historical rules unchanged on the ungated comparison", () => {
    expect(compareRequiredFileEvidence(evidence("missing"), evidence("missing"))).toBe("same");
  });

  it("does not accept equal weakness as evidence: both missing is unknown", () => {
    expect(compareRequiredFileEvidenceAgainstReference(evidence("missing"), evidence("missing"))).toBe("unknown");
    expect(compareCandidateRequiredFileEvidence(evidence("missing"), evidence("missing"))).toBe("same");
    expect(compareCandidateRequiredFileEvidenceAgainstReference(evidence("missing"), evidence("missing"))).toBe("unknown");
  });

  it("still reports same when the reference itself is adequate", () => {
    expect(compareRequiredFileEvidenceAgainstReference(evidence("present"), evidence("present"))).toBe("same");
  });

  it("still detects a proven regression and an improvement over an insufficient reference", () => {
    expect(compareRequiredFileEvidenceAgainstReference(evidence("missing"), evidence("present"))).toBe("stale-worse");
    expect(compareRequiredFileEvidenceAgainstReference(evidence("present"), evidence("missing"))).toBe("stale-better");
    expect(compareCandidateRequiredFileEvidenceAgainstReference(evidence("missing"), evidence("present"))).toBe("candidate-worse");
  });

  it("keeps unknown evidence unknown", () => {
    expect(compareRequiredFileEvidenceAgainstReference(evidence("unknown"), evidence("present"))).toBe("unknown");
    expect(compareRequiredFileEvidenceAgainstReference(evidence("present"), evidence("unknown"))).toBe("unknown");
  });
});

type Fake = { correctnessScore: number | null };

function treatment(
  treatmentId: IncrementalChangeStalenessTreatmentExecutionV2["treatmentId"],
  required: RequiredFileEvidenceV1["status"],
  fake: Fake,
  realization: PartialRefreshRealization | null
): IncrementalChangeStalenessTreatmentExecutionV2 {
  const refreshExecution =
    treatmentId === "stale-index"
      ? { kind: "no-refresh", realization: "NO_REFRESH", incrementalRefresh: null }
      : treatmentId === "full-refresh"
        ? { kind: "full", realization: "FULL_REFRESH", incrementalRefresh: null }
        : { kind: "incremental", realization, incrementalRefresh: {} };
  return {
    treatmentId,
    requiredFileEvidence: evidence(required),
    fakeAgent:
      fake.correctnessScore === null
        ? null
        : { status: "completed", correctness: { available: true, score: fake.correctnessScore, passed: false, failureReasons: [] }, correctnessDetail: null, durationMs: 1, warnings: [], errors: [] },
    refreshExecution
  } as unknown as IncrementalChangeStalenessTreatmentExecutionV2;
}

function comparisonsFor(args: {
  stale: RequiredFileEvidenceV1["status"];
  changed: RequiredFileEvidenceV1["status"];
  neighborhood: RequiredFileEvidenceV1["status"];
  full: RequiredFileEvidenceV1["status"];
  changedRealization?: PartialRefreshRealization;
}) {
  const sameScore = { correctnessScore: 0.75 };
  return buildReferenceComparisons([
    treatment("stale-index", args.stale, sameScore, null),
    treatment("changed-files-refresh", args.changed, sameScore, args.changedRealization ?? "APPLIED_PARTIAL"),
    treatment("affected-neighborhood-refresh", args.neighborhood, sameScore, "APPLIED_PARTIAL"),
    treatment("full-refresh", args.full, sameScore, null)
  ]);
}

describe("counterfactual fidelity of the reference comparisons", () => {
  it("detects a proven file-evidence regression that an identical synthetic answer score would otherwise mask", () => {
    const [stale, changed, neighborhood] = comparisonsFor({ stale: "missing", changed: "missing", neighborhood: "present", full: "present" });
    expect(stale).toMatchObject({ kind: "stale-risk", comparison: { correctnessRelation: "same", requiredFileEvidenceRelation: "stale-worse", staleRiskClassification: "observed-stale-regression" } });
    expect(changed).toMatchObject({ kind: "partial-refresh", correctnessRelation: "same", requiredFileEvidenceRelation: "candidate-worse", classification: "observed-regression-relative-to-full" });
    expect(neighborhood).toMatchObject({ requiredFileEvidenceRelation: "same", classification: "no-observed-regression-relative-to-full" });
  });

  it("reports the inverse: a candidate that observed the files the reference did not is better, not a regression", () => {
    const [stale, changed] = comparisonsFor({ stale: "present", changed: "present", neighborhood: "present", full: "missing" });
    expect(stale).toMatchObject({ comparison: { requiredFileEvidenceRelation: "stale-better", staleRiskClassification: "no-observed-stale-regression" } });
    expect(changed).toMatchObject({ requiredFileEvidenceRelation: "candidate-better", classification: "no-observed-regression-relative-to-full" });
  });

  it("does not accept a deliberately insufficient reference just because every variant is equally weak", () => {
    const comparisons = comparisonsFor({ stale: "missing", changed: "missing", neighborhood: "missing", full: "missing" });
    expect(comparisons[0]).toMatchObject({ comparison: { requiredFileEvidenceRelation: "unknown", staleRiskClassification: "inconclusive", reasonCodes: ["required-file-evidence-unavailable"] } });
    for (const comparison of comparisons.slice(1)) {
      expect(comparison).toMatchObject({ requiredFileEvidenceRelation: "unknown", classification: "inconclusive" });
    }
  });

  it("accepts an adequate positive reference control when every treatment observed the required files", () => {
    const comparisons = comparisonsFor({ stale: "present", changed: "present", neighborhood: "present", full: "present" });
    expect(comparisons[0]).toMatchObject({ comparison: { staleRiskClassification: "no-observed-stale-regression" } });
    expect(comparisons[1]).toMatchObject({ classification: "no-observed-regression-relative-to-full" });
  });

  it("treats unknown full-reference evidence as inconclusive", () => {
    const comparisons = comparisonsFor({ stale: "present", changed: "present", neighborhood: "present", full: "unknown" });
    expect(comparisons[0]).toMatchObject({ comparison: { staleRiskClassification: "inconclusive" } });
    expect(comparisons[1]).toMatchObject({ classification: "inconclusive" });
  });

  it("keeps APPLIED_PARTIAL and FALLBACK_FULL distinct", () => {
    const applied = comparisonsFor({ stale: "present", changed: "present", neighborhood: "present", full: "present", changedRealization: "APPLIED_PARTIAL" })[1];
    const fallback = comparisonsFor({ stale: "present", changed: "present", neighborhood: "present", full: "present", changedRealization: "FALLBACK_FULL" })[1];
    expect(applied).toMatchObject({ refreshRealization: "APPLIED_PARTIAL", classification: "no-observed-regression-relative-to-full" });
    expect(fallback).toMatchObject({ refreshRealization: "FALLBACK_FULL", classification: "not-comparable-as-partial-refresh" });
    expect(classifyPartialRefreshAgainstFull({ realization: "FALLBACK_FULL", correctnessRelation: "same", requiredFileEvidenceRelation: "candidate-worse" }).classification).toBe(
      "not-comparable-as-partial-refresh"
    );
  });

  it("keeps the stale-risk classifier a pure function of the persisted relations", () => {
    expect(classifyStaleRisk("same", "unknown")).toEqual({ staleRiskClassification: "inconclusive", reasonCodes: ["required-file-evidence-unavailable"] });
  });
});

describe("the unchanged synthetic fake agent is not measured Kit correctness", () => {
  const expectedScores: Record<string, number> = { U1: 0.75, L2: 0.75, E1: 0.75, P1: 0.75, I1: 0.75, T1: 0.7 };

  it.each(Object.entries(expectedScores))("scenario %s: two-fact truncation scores %s and never passes", async (scenarioId, expectedScore) => {
    const { scenario } = await resolveScenario(scenarioId);
    const { derivedTask } = await resolveIncrementalChangeStalenessScenarioTask({ repoRoot, scenario });
    const requiredFacts = derivedTask.answerKey!.expectedFacts.length;
    expect(requiredFacts).toBeGreaterThanOrEqual(3);
    const outDir = makeRunOwnedRoot(tracked, "ics-fake-agent-");
    const result = await runIncrementalChangeStalenessFakeAgent({
      derivedTask,
      projectProfiles: await loadProjectProfiles(),
      outDir: path.join(outDir, "agent"),
      cwd: repoRoot,
      runId: `${scenarioId}.counterexample`
    });
    expect(result.correctness.available).toBe(true);
    expect(result.correctness.score).toBe(expectedScore);
    expect(result.correctness.passed).toBe(false);
    expect(result.correctnessDetail?.requiredFactsFound).toBe(2);
    expect(result.correctnessDetail?.requiredFactsTotal).toBeGreaterThanOrEqual(3);
  });
});
