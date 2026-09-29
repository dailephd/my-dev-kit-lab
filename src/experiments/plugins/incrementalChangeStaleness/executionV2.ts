import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { AffectedNeighborhoodAssessmentV1 } from "../../../evaluation/affectedNeighborhood.js";
import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import type { BenchmarkProjectProfile, MyDevKitIncrementalRefreshEvidence, MyDevKitRetrievalResult } from "../../../evaluation/types.js";
import { classifyStaleRisk, compareCorrectness, compareRequiredFileEvidence, type RequiredFileEvidenceV1 } from "./comparison.js";
import {
  compareCandidateCorrectness,
  compareCandidateRequiredFileEvidence,
  classifyPartialRefreshAgainstFull,
  type CandidateCorrectnessRelationV2,
  type CandidateRequiredFileRelationV2,
  type PartialRefreshReferenceClassificationV2,
  type PartialRefreshReferenceReasonCodeV2
} from "./comparisonV2.js";
import {
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS,
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS,
  type IncrementalChangeStalenessV2TreatmentId,
  type IncrementalChangeStalenessV2TreatmentIntent
} from "./disposableTarget.js";
import {
  assessIncrementalChangeStalenessAffectedNeighborhood,
  checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry,
  correctnessComparable,
  defaultIncrementalChangeStalenessExecutionDeps,
  executeTreatmentEvaluation,
  INCONCLUSIVE_NO_EXECUTION,
  resolveIncrementalChangeStalenessScenarioTask,
  type IncrementalChangeStalenessComparisonV1,
  type IncrementalChangeStalenessExecutionDeps,
  type IncrementalChangeStalenessFakeAgentEvidenceV1,
  type IncrementalChangeStalenessRetrievalStatus,
  type IncrementalChangeStalenessTreatmentExecutionStatus
} from "./execution.js";
import type { PartialRefreshRealization } from "./lifecyclePolicyV2.js";
import type { IncrementalChangeStalenessAnswerPolicy, IncrementalChangeStalenessScenario, IncrementalChangeStalenessScenarioCategory } from "./scenarioTypes.js";
import type { IncrementalChangeStalenessBaseCaseIdentityV1, IncrementalChangeStalenessIndexRole } from "./treatmentSession.js";
import type { IncrementalChangeStalenessLifecycleResultV2, IncrementalChangeStalenessScenarioSessionV2 } from "./treatmentSessionV2.js";

// ---------------------------------------------------------------------------
// v0.6.3 Batch 3 -- four-treatment execution. Consumes a READY Batch 2 lifecycle session: it never
// rebuilds indexes, mutates source, or recomputes lifecycle state. Retrieval, fake-agent, correctness,
// and required-file evidence come from the same shared owner as v0.6.2 (executeTreatmentEvaluation).
// ---------------------------------------------------------------------------

/** What the treatment's refresh actually did, copied from lifecycle truth (never inferred from names). */
export type IncrementalChangeStalenessRefreshExecutionV2 =
  | { kind: "no-refresh"; realization: "NO_REFRESH"; incrementalRefresh: null }
  | { kind: "incremental"; realization: PartialRefreshRealization; incrementalRefresh: MyDevKitIncrementalRefreshEvidence }
  | { kind: "full"; realization: "FULL_REFRESH"; incrementalRefresh: null };

export type IncrementalChangeStalenessTreatmentExecutionV2 = {
  treatmentId: IncrementalChangeStalenessV2TreatmentId;
  treatmentIntent: IncrementalChangeStalenessV2TreatmentIntent;
  status: IncrementalChangeStalenessTreatmentExecutionStatus;
  failureReason: string | null;
  activeIndexPhase: IncrementalChangeStalenessIndexRole;
  baselineFreshness: IndexFreshnessAssessmentV1;
  /** Post-refresh freshness where a refreshed index exists; null for stale-index. */
  refreshedFreshness: IndexFreshnessAssessmentV1 | null;
  affectedNeighborhood: AffectedNeighborhoodAssessmentV1;
  retrieval: MyDevKitRetrievalResult | null;
  retrievalStatus: IncrementalChangeStalenessRetrievalStatus | "not-run";
  fakeAgent: IncrementalChangeStalenessFakeAgentEvidenceV1 | null;
  requiredFileEvidence: RequiredFileEvidenceV1;
  refreshExecution: IncrementalChangeStalenessRefreshExecutionV2;
};

export type IncrementalChangeStalenessStaleRiskReferenceComparisonV2 = {
  kind: "stale-risk";
  candidateTreatmentId: "stale-index";
  referenceTreatmentId: "full-refresh";
  /** The unchanged v0.6.2 stale-risk comparison object. */
  comparison: IncrementalChangeStalenessComparisonV1;
};

export type IncrementalChangeStalenessPartialReferenceComparisonV2 = {
  kind: "partial-refresh";
  candidateTreatmentId: "changed-files-refresh" | "affected-neighborhood-refresh";
  referenceTreatmentId: "full-refresh";
  /** Null only for a failed scenario whose treatments were never executed. */
  refreshRealization: PartialRefreshRealization | null;
  correctnessRelation: CandidateCorrectnessRelationV2;
  requiredFileEvidenceRelation: CandidateRequiredFileRelationV2;
  classification: PartialRefreshReferenceClassificationV2;
  reasonCodes: PartialRefreshReferenceReasonCodeV2[];
};

export type IncrementalChangeStalenessReferenceComparisonV2 =
  | IncrementalChangeStalenessStaleRiskReferenceComparisonV2
  | IncrementalChangeStalenessPartialReferenceComparisonV2;

export type IncrementalChangeStalenessScenarioExecutionV2 = {
  scenarioId: string;
  category: IncrementalChangeStalenessScenarioCategory;
  benchmarkProjectId: string;
  baseCaseId: string;
  answerPolicy: IncrementalChangeStalenessAnswerPolicy;
  query: string | null;
  expectedFiles: string[];
  expectedSymbols: string[];
  status: "ready" | "failed";
  failureReason: string | null;
  session: IncrementalChangeStalenessScenarioSessionV2 | null;
  /** Empty when the scenario failed before any treatment executed; otherwise the four treatments in fixed order. */
  treatments: IncrementalChangeStalenessTreatmentExecutionV2[];
  /** Always exactly three comparisons against full-refresh, in fixed order. */
  referenceComparisons: IncrementalChangeStalenessReferenceComparisonV2[];
};

export type IncrementalChangeStalenessAffectedSymmetryResultV2 = { symmetric: true } | { symmetric: false; reason: string };

/**
 * Four-way check with stale-index only as the deterministic reference. Reuses the v0.6.2 pairwise check
 * (status, relationship, reindexRecommendation, and the six numeric metrics) and additionally requires
 * equal seedNodeCount. Conflicting evidence is never averaged or merged.
 */
export function checkAffectedNeighborhoodFourWaySymmetry(
  assessments: Readonly<Record<IncrementalChangeStalenessV2TreatmentId, AffectedNeighborhoodAssessmentV1>>
): IncrementalChangeStalenessAffectedSymmetryResultV2 {
  const reference = assessments["stale-index"];
  const reasons: string[] = [];
  for (const treatmentId of INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS) {
    if (treatmentId === "stale-index") continue;
    const other = assessments[treatmentId];
    const pairwise = checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry(reference, other);
    if (!pairwise.symmetric) reasons.push(`${treatmentId}: ${pairwise.reason}`);
    if (reference.seedNodeCount !== other.seedNodeCount) {
      reasons.push(`${treatmentId}: seedNodeCount (${reference.seedNodeCount} vs ${other.seedNodeCount})`);
    }
  }
  return reasons.length === 0 ? { symmetric: true } : { symmetric: false, reason: `Affected-neighborhood assessments are asymmetric across treatments: ${reasons.join(" | ")}` };
}

const PARTIAL_TREATMENT_IDS = ["changed-files-refresh", "affected-neighborhood-refresh"] as const;

function placeholderComparisons(): IncrementalChangeStalenessReferenceComparisonV2[] {
  return [
    { kind: "stale-risk", candidateTreatmentId: "stale-index", referenceTreatmentId: "full-refresh", comparison: { ...INCONCLUSIVE_NO_EXECUTION, reasonCodes: [...INCONCLUSIVE_NO_EXECUTION.reasonCodes] } },
    ...PARTIAL_TREATMENT_IDS.map(
      (candidateTreatmentId): IncrementalChangeStalenessPartialReferenceComparisonV2 => ({
        kind: "partial-refresh",
        candidateTreatmentId,
        referenceTreatmentId: "full-refresh",
        refreshRealization: null,
        correctnessRelation: "unknown",
        requiredFileEvidenceRelation: "unknown",
        classification: "inconclusive",
        reasonCodes: ["correctness-unavailable", "required-file-evidence-unavailable"]
      })
    )
  ];
}

function refreshExecutionOf(session: IncrementalChangeStalenessScenarioSessionV2, treatmentId: IncrementalChangeStalenessV2TreatmentId): IncrementalChangeStalenessRefreshExecutionV2 {
  const treatment = session.treatments[treatmentId];
  if (treatment.refreshRealization !== null) {
    const incrementalRefresh = treatment.refreshedIndex.incrementalRefresh;
    if (!incrementalRefresh) {
      throw new Error(`${treatmentId} lifecycle reported ${treatment.refreshRealization} without upstream incrementalRefresh evidence.`);
    }
    return { kind: "incremental", realization: treatment.refreshRealization, incrementalRefresh: structuredClone(incrementalRefresh) };
  }
  return treatment.postMutationIndexBuilt
    ? { kind: "full", realization: "FULL_REFRESH", incrementalRefresh: null }
    : { kind: "no-refresh", realization: "NO_REFRESH", incrementalRefresh: null };
}

/**
 * Executes the four matched treatments in fixed order for one lifecycle-ready V2 session, then builds
 * exactly three comparisons against full-refresh. A lifecycle that is not ready, or an affected-neighborhood
 * asymmetry, is a failed scenario with no fabricated treatment evidence.
 */
export async function executeIncrementalChangeStalenessScenarioV2(options: {
  repoRoot: string;
  scenario: IncrementalChangeStalenessScenario;
  lifecycle: IncrementalChangeStalenessLifecycleResultV2;
  baseCase: IncrementalChangeStalenessBaseCaseIdentityV1;
  projectProfiles: readonly BenchmarkProjectProfile[];
  runOwnedRoot: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  deps?: Partial<IncrementalChangeStalenessExecutionDeps>;
}): Promise<IncrementalChangeStalenessScenarioExecutionV2> {
  const deps: IncrementalChangeStalenessExecutionDeps = { ...defaultIncrementalChangeStalenessExecutionDeps, ...options.deps };
  const scenario = options.scenario;

  if (options.lifecycle.status !== "ready") {
    return {
      scenarioId: scenario.id,
      category: scenario.category,
      benchmarkProjectId: options.baseCase.benchmarkProjectId,
      baseCaseId: options.baseCase.caseId,
      answerPolicy: scenario.answerPolicy,
      query: null,
      expectedFiles: [],
      expectedSymbols: [],
      status: "failed",
      failureReason: `${options.lifecycle.failure.code}: ${options.lifecycle.failure.message}`,
      session: null,
      treatments: [],
      referenceComparisons: placeholderComparisons()
    };
  }

  const session = options.lifecycle.session;
  const { resolved, derivedTask } = await resolveIncrementalChangeStalenessScenarioTask({ repoRoot: options.repoRoot, scenario });
  const scenarioBase = {
    scenarioId: scenario.id,
    category: scenario.category,
    benchmarkProjectId: scenario.benchmarkProjectId,
    baseCaseId: scenario.baseCaseId,
    answerPolicy: scenario.answerPolicy,
    query: resolved.query,
    expectedFiles: resolved.expectedFiles,
    expectedSymbols: resolved.expectedSymbols,
    session
  };

  // Affected-neighborhood evidence is derived from each treatment's ORIGINAL BASELINE change authority.
  const affected = {} as Record<IncrementalChangeStalenessV2TreatmentId, AffectedNeighborhoodAssessmentV1>;
  for (const treatmentId of INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS) {
    affected[treatmentId] = assessIncrementalChangeStalenessAffectedNeighborhood(session.treatments[treatmentId], derivedTask);
  }
  const symmetry = checkAffectedNeighborhoodFourWaySymmetry(affected);
  if (!symmetry.symmetric) {
    return {
      ...scenarioBase,
      status: "failed",
      failureReason: `AFFECTED_NEIGHBORHOOD_ASYMMETRY: ${symmetry.reason}`,
      treatments: [],
      referenceComparisons: placeholderComparisons()
    };
  }

  const retrievalCommandsDir = (treatmentId: IncrementalChangeStalenessV2TreatmentId) =>
    resolveWithinRoot(options.runOwnedRoot, path.join("commands", scenario.id, treatmentId, "retrieval"));
  const agentOutDir = (treatmentId: IncrementalChangeStalenessV2TreatmentId) =>
    resolveWithinRoot(options.runOwnedRoot, path.join("agents", scenario.id, treatmentId));

  // Fixed deterministic order, sequential; each treatment retrieves only from its own active index.
  const treatments: IncrementalChangeStalenessTreatmentExecutionV2[] = [];
  for (const treatmentId of INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS) {
    const lifecycleTreatment = session.treatments[treatmentId];
    const evaluation = await executeTreatmentEvaluation({
      treatmentId,
      baselineFreshness: lifecycleTreatment.changeAuthority.postMutationBaselineFreshness,
      activeIndexPhase: lifecycleTreatment.activeRetrieval.role,
      activeIndexDir: lifecycleTreatment.activeRetrieval.index.indexDir,
      derivedTask,
      affectedNeighborhood: affected[treatmentId],
      requiredFiles: resolved.expectedFiles,
      kitCommand: session.kitCommand,
      retrievalCommandsDir: retrievalCommandsDir(treatmentId),
      agentOutDir: agentOutDir(treatmentId),
      projectProfiles: options.projectProfiles,
      cwd: options.cwd,
      env: options.env,
      deps
    });
    treatments.push({
      ...evaluation,
      treatmentIntent: INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS[treatmentId],
      refreshedFreshness: lifecycleTreatment.refreshedFreshness,
      refreshExecution: refreshExecutionOf(session, treatmentId)
    });
  }

  return {
    ...scenarioBase,
    status: "ready",
    failureReason: null,
    treatments,
    referenceComparisons: buildReferenceComparisons(treatments)
  };
}

/** Exactly three comparisons against full-refresh: stale-index, changed-files-refresh, affected-neighborhood-refresh. */
export function buildReferenceComparisons(treatments: readonly IncrementalChangeStalenessTreatmentExecutionV2[]): IncrementalChangeStalenessReferenceComparisonV2[] {
  const byId = new Map(treatments.map((treatment) => [treatment.treatmentId, treatment]));
  const reference = byId.get("full-refresh");
  const stale = byId.get("stale-index");
  if (!reference || !stale) throw new Error("Reference comparisons require the stale-index and full-refresh treatment executions.");

  // Historical v0.6.2 semantics, unchanged.
  const staleCorrectness = compareCorrectness(correctnessComparable(stale.fakeAgent), correctnessComparable(reference.fakeAgent));
  const staleRequired = compareRequiredFileEvidence(stale.requiredFileEvidence, reference.requiredFileEvidence);
  const staleRisk = classifyStaleRisk(staleCorrectness, staleRequired);
  const comparisons: IncrementalChangeStalenessReferenceComparisonV2[] = [
    {
      kind: "stale-risk",
      candidateTreatmentId: "stale-index",
      referenceTreatmentId: "full-refresh",
      comparison: {
        correctnessRelation: staleCorrectness,
        requiredFileEvidenceRelation: staleRequired,
        staleRiskClassification: staleRisk.staleRiskClassification,
        reasonCodes: staleRisk.reasonCodes
      }
    }
  ];

  for (const candidateTreatmentId of PARTIAL_TREATMENT_IDS) {
    const candidate = byId.get(candidateTreatmentId);
    if (!candidate || candidate.refreshExecution.kind !== "incremental") {
      throw new Error(`${candidateTreatmentId} has no incremental refresh execution to compare.`);
    }
    const correctnessRelation = compareCandidateCorrectness(correctnessComparable(candidate.fakeAgent), correctnessComparable(reference.fakeAgent));
    const requiredFileEvidenceRelation = compareCandidateRequiredFileEvidence(candidate.requiredFileEvidence, reference.requiredFileEvidence);
    const classified = classifyPartialRefreshAgainstFull({
      realization: candidate.refreshExecution.realization,
      correctnessRelation,
      requiredFileEvidenceRelation
    });
    comparisons.push({
      kind: "partial-refresh",
      candidateTreatmentId,
      referenceTreatmentId: "full-refresh",
      refreshRealization: candidate.refreshExecution.realization,
      correctnessRelation,
      requiredFileEvidenceRelation,
      classification: classified.classification,
      reasonCodes: classified.reasonCodes
    });
  }
  return comparisons;
}
