import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { AffectedNeighborhoodAssessmentV1 } from "../../../evaluation/affectedNeighborhood.js";
import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import { classifyStaleRisk, type RequiredFileEvidenceV1 } from "./comparison.js";
import { classifyPartialRefreshAgainstFull, type PartialRefreshReferenceClassificationV2 } from "./comparisonV2.js";
import {
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS,
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS,
  type IncrementalChangeStalenessV2TreatmentId,
  type IncrementalChangeStalenessV2TreatmentIntent
} from "./disposableTarget.js";
import {
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_ARTIFACT_FILE,
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION,
  sortedUnique,
  summarizeFakeAgent,
  summarizeRequiredFileEvidence,
  summarizeRetrieval,
  type IncrementalChangeStalenessExecutionArtifactV1,
  type IncrementalChangeStalenessFakeAgentSummaryV1,
  type IncrementalChangeStalenessRetrievalSummaryV1
} from "./executionArtifact.js";
import type {
  IncrementalChangeStalenessReferenceComparisonV2,
  IncrementalChangeStalenessRefreshExecutionV2,
  IncrementalChangeStalenessScenarioExecutionV2,
  IncrementalChangeStalenessTreatmentExecutionV2
} from "./executionV2.js";
import type { IncrementalChangeStalenessIndexRole } from "./treatmentSession.js";

// ---------------------------------------------------------------------------
// v0.6.3 Batch 3 -- persisted four-treatment execution artifact. A distinct schema from V1 written to the
// same canonical filename; the schemaVersion is the discriminator. Bounded structured evidence only:
// never raw retrieved context bodies, graph artifacts, or file contents. Descriptive counts, no ranking.
// ---------------------------------------------------------------------------

export const INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2 = "my-dev-kit-lab-incremental-change-staleness-execution-v2";

type TreatmentId = IncrementalChangeStalenessV2TreatmentId;
type PartialTreatmentId = "changed-files-refresh" | "affected-neighborhood-refresh";
type Equivalence = "equivalent" | "different" | "unknown";

const PARTIAL_IDS: readonly PartialTreatmentId[] = ["changed-files-refresh", "affected-neighborhood-refresh"];
const REQUESTED_SCOPE: Record<PartialTreatmentId, "changed-files" | "affected-neighborhood"> = {
  "changed-files-refresh": "changed-files",
  "affected-neighborhood-refresh": "affected-neighborhood"
};
const COMPARISON_CANDIDATE_ORDER: readonly TreatmentId[] = ["stale-index", "changed-files-refresh", "affected-neighborhood-refresh"];

export type IncrementalChangeStalenessTreatmentSummaryV2 = {
  treatmentId: TreatmentId;
  treatmentIntent: IncrementalChangeStalenessV2TreatmentIntent;
  status: "completed" | "partial" | "failed";
  failureReason: string | null;
  activeIndexPhase: IncrementalChangeStalenessIndexRole;
  baselineFreshness: IndexFreshnessAssessmentV1;
  refreshedFreshness: IndexFreshnessAssessmentV1 | null;
  refreshExecution: IncrementalChangeStalenessRefreshExecutionV2;
  affectedNeighborhood: AffectedNeighborhoodAssessmentV1;
  retrieval: IncrementalChangeStalenessRetrievalSummaryV1;
  fakeAgent: IncrementalChangeStalenessFakeAgentSummaryV1;
  requiredFileEvidence: RequiredFileEvidenceV1;
};

export type IncrementalChangeStalenessLifecycleSummaryV2 = {
  controlledFilePaths: string[];
  treatmentIntents: Record<TreatmentId, IncrementalChangeStalenessV2TreatmentIntent>;
  /** Each other treatment compared to the stale-index reference (a comparison reference only). */
  preMutationEquivalence: Record<Exclude<TreatmentId, "stale-index">, Equivalence>;
  postMutationEquivalence: Record<Exclude<TreatmentId, "stale-index">, Equivalence>;
  baselineFreshnessStatus: Record<TreatmentId, IndexFreshnessAssessmentV1["status"]>;
  /** Only treatments that built a refreshed index. */
  refreshedFreshnessStatus: Partial<Record<TreatmentId, IndexFreshnessAssessmentV1["status"]>>;
  partialRealization: Record<PartialTreatmentId, "APPLIED_PARTIAL" | "FALLBACK_FULL">;
  indexInvocationCounts: Record<TreatmentId, number>;
  freshnessAssessmentCounts: Record<TreatmentId, number>;
  totalIndexInvocationCount: number;
  totalFreshnessAssessmentCount: number;
  myDevKitVersion: string | null;
  sourceRoots: string[];
};

export type IncrementalChangeStalenessScenarioArtifactRecordV2 = {
  scenarioId: string;
  category: string;
  benchmarkProjectId: string;
  baseCaseId: string;
  answerPolicy: string;
  query: string | null;
  expectedFiles: string[];
  expectedSymbols: string[];
  status: "ready" | "failed";
  failureReason: string | null;
  lifecycle: IncrementalChangeStalenessLifecycleSummaryV2 | null;
  /** Empty for a failed scenario; otherwise exactly four records in fixed order. */
  treatments: IncrementalChangeStalenessTreatmentSummaryV2[];
  /** Exactly three comparisons against full-refresh in fixed order. */
  referenceComparisons: IncrementalChangeStalenessReferenceComparisonV2[];
};

export type IncrementalChangeStalenessExecutionSummaryV2 = {
  scenarioCount: number;
  readyScenarioCount: number;
  failedScenarioCount: number;
  staleObservedRegressionCount: number;
  staleNoObservedRegressionCount: number;
  staleInconclusiveCount: number;
  changedFilesAppliedPartialCount: number;
  changedFilesFallbackFullCount: number;
  affectedNeighborhoodAppliedPartialCount: number;
  affectedNeighborhoodFallbackFullCount: number;
  changedFilesObservedRegressionRelativeToFullCount: number;
  changedFilesNoObservedRegressionRelativeToFullCount: number;
  changedFilesInconclusiveCount: number;
  changedFilesNotComparableCount: number;
  affectedNeighborhoodObservedRegressionRelativeToFullCount: number;
  affectedNeighborhoodNoObservedRegressionRelativeToFullCount: number;
  affectedNeighborhoodInconclusiveCount: number;
  affectedNeighborhoodNotComparableCount: number;
};

export type IncrementalChangeStalenessExecutionArtifactV2 = {
  schemaVersion: typeof INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2;
  runId: string;
  pluginId: string;
  scenarios: IncrementalChangeStalenessScenarioArtifactRecordV2[];
  summary: IncrementalChangeStalenessExecutionSummaryV2;
};

function record<T>(build: (treatmentId: TreatmentId) => T): Record<TreatmentId, T> {
  return Object.fromEntries(INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS.map((id) => [id, build(id)])) as Record<TreatmentId, T>;
}

function summarizeTreatmentV2(treatment: IncrementalChangeStalenessTreatmentExecutionV2): IncrementalChangeStalenessTreatmentSummaryV2 {
  return {
    treatmentId: treatment.treatmentId,
    treatmentIntent: treatment.treatmentIntent,
    status: treatment.status,
    failureReason: treatment.failureReason,
    activeIndexPhase: treatment.activeIndexPhase,
    baselineFreshness: structuredClone(treatment.baselineFreshness),
    refreshedFreshness: treatment.refreshedFreshness ? structuredClone(treatment.refreshedFreshness) : null,
    refreshExecution: structuredClone(treatment.refreshExecution),
    affectedNeighborhood: structuredClone(treatment.affectedNeighborhood),
    // Bounded status/telemetry only; never embeds retrieval.contextText.
    retrieval: summarizeRetrieval(treatment),
    fakeAgent: summarizeFakeAgent(treatment),
    requiredFileEvidence: summarizeRequiredFileEvidence(treatment.requiredFileEvidence)
  };
}

function summarizeLifecycleV2(execution: IncrementalChangeStalenessScenarioExecutionV2): IncrementalChangeStalenessLifecycleSummaryV2 | null {
  const session = execution.session;
  if (!session) return null;
  const refreshedStatus: Partial<Record<TreatmentId, IndexFreshnessAssessmentV1["status"]>> = {};
  for (const id of INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS) {
    const freshness = session.treatments[id].refreshedFreshness;
    if (freshness) refreshedStatus[id] = freshness.status;
  }
  return {
    controlledFilePaths: [...session.controlledChangedPaths],
    treatmentIntents: record((id) => INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS[id]),
    preMutationEquivalence: {
      "changed-files-refresh": session.preMutationEquivalence["changed-files-refresh"].result,
      "affected-neighborhood-refresh": session.preMutationEquivalence["affected-neighborhood-refresh"].result,
      "full-refresh": session.preMutationEquivalence["full-refresh"].result
    },
    postMutationEquivalence: {
      "changed-files-refresh": session.postMutationEquivalence["changed-files-refresh"].result,
      "affected-neighborhood-refresh": session.postMutationEquivalence["affected-neighborhood-refresh"].result,
      "full-refresh": session.postMutationEquivalence["full-refresh"].result
    },
    baselineFreshnessStatus: record((id) => session.treatments[id].changeAuthority.postMutationBaselineFreshness.status),
    refreshedFreshnessStatus: refreshedStatus,
    partialRealization: {
      "changed-files-refresh": session.treatments["changed-files-refresh"].refreshRealization,
      "affected-neighborhood-refresh": session.treatments["affected-neighborhood-refresh"].refreshRealization
    },
    indexInvocationCounts: record((id) => session.treatments[id].indexInvocationCount),
    freshnessAssessmentCounts: record((id) => session.treatments[id].freshnessAssessmentCount),
    totalIndexInvocationCount: session.totalIndexInvocationCount,
    totalFreshnessAssessmentCount: session.totalFreshnessAssessmentCount,
    myDevKitVersion: session.toolIdentity.version ?? null,
    sourceRoots: [...session.baseCase.sourceRoots]
  };
}

function summarizeScenarioV2(execution: IncrementalChangeStalenessScenarioExecutionV2): IncrementalChangeStalenessScenarioArtifactRecordV2 {
  return {
    scenarioId: execution.scenarioId,
    category: execution.category,
    benchmarkProjectId: execution.benchmarkProjectId,
    baseCaseId: execution.baseCaseId,
    answerPolicy: execution.answerPolicy,
    query: execution.query,
    expectedFiles: sortedUnique(execution.expectedFiles),
    expectedSymbols: sortedUnique(execution.expectedSymbols),
    status: execution.status,
    failureReason: execution.failureReason,
    lifecycle: summarizeLifecycleV2(execution),
    treatments: execution.treatments.map(summarizeTreatmentV2),
    referenceComparisons: structuredClone(execution.referenceComparisons)
  };
}

function partialComparison(scenario: IncrementalChangeStalenessScenarioArtifactRecordV2, candidate: PartialTreatmentId) {
  const found = scenario.referenceComparisons.find((comparison) => comparison.candidateTreatmentId === candidate);
  return found && found.kind === "partial-refresh" ? found : null;
}

function countPartial(
  scenarios: readonly IncrementalChangeStalenessScenarioArtifactRecordV2[],
  candidate: PartialTreatmentId,
  classification: PartialRefreshReferenceClassificationV2
): number {
  return scenarios.filter((scenario) => partialComparison(scenario, candidate)?.classification === classification).length;
}

function countRealization(scenarios: readonly IncrementalChangeStalenessScenarioArtifactRecordV2[], candidate: PartialTreatmentId, realization: "APPLIED_PARTIAL" | "FALLBACK_FULL"): number {
  return scenarios.filter((scenario) => scenario.treatments.find((treatment) => treatment.treatmentId === candidate)?.refreshExecution.realization === realization).length;
}

function summarizeV2(scenarios: readonly IncrementalChangeStalenessScenarioArtifactRecordV2[]): IncrementalChangeStalenessExecutionSummaryV2 {
  const staleClass = (scenario: IncrementalChangeStalenessScenarioArtifactRecordV2) => {
    const stale = scenario.referenceComparisons.find((comparison) => comparison.candidateTreatmentId === "stale-index");
    return stale && stale.kind === "stale-risk" ? stale.comparison.staleRiskClassification : null;
  };
  return {
    scenarioCount: scenarios.length,
    readyScenarioCount: scenarios.filter((scenario) => scenario.status === "ready").length,
    failedScenarioCount: scenarios.filter((scenario) => scenario.status === "failed").length,
    staleObservedRegressionCount: scenarios.filter((scenario) => staleClass(scenario) === "observed-stale-regression").length,
    staleNoObservedRegressionCount: scenarios.filter((scenario) => staleClass(scenario) === "no-observed-stale-regression").length,
    staleInconclusiveCount: scenarios.filter((scenario) => staleClass(scenario) === "inconclusive").length,
    changedFilesAppliedPartialCount: countRealization(scenarios, "changed-files-refresh", "APPLIED_PARTIAL"),
    changedFilesFallbackFullCount: countRealization(scenarios, "changed-files-refresh", "FALLBACK_FULL"),
    affectedNeighborhoodAppliedPartialCount: countRealization(scenarios, "affected-neighborhood-refresh", "APPLIED_PARTIAL"),
    affectedNeighborhoodFallbackFullCount: countRealization(scenarios, "affected-neighborhood-refresh", "FALLBACK_FULL"),
    changedFilesObservedRegressionRelativeToFullCount: countPartial(scenarios, "changed-files-refresh", "observed-regression-relative-to-full"),
    changedFilesNoObservedRegressionRelativeToFullCount: countPartial(scenarios, "changed-files-refresh", "no-observed-regression-relative-to-full"),
    changedFilesInconclusiveCount: countPartial(scenarios, "changed-files-refresh", "inconclusive"),
    changedFilesNotComparableCount: countPartial(scenarios, "changed-files-refresh", "not-comparable-as-partial-refresh"),
    affectedNeighborhoodObservedRegressionRelativeToFullCount: countPartial(scenarios, "affected-neighborhood-refresh", "observed-regression-relative-to-full"),
    affectedNeighborhoodNoObservedRegressionRelativeToFullCount: countPartial(scenarios, "affected-neighborhood-refresh", "no-observed-regression-relative-to-full"),
    affectedNeighborhoodInconclusiveCount: countPartial(scenarios, "affected-neighborhood-refresh", "inconclusive"),
    affectedNeighborhoodNotComparableCount: countPartial(scenarios, "affected-neighborhood-refresh", "not-comparable-as-partial-refresh")
  };
}

function contradiction(scenarioId: string, message: string): never {
  throw new Error(`Contradictory v2 execution evidence for scenario ${scenarioId}: ${message}`);
}

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Rejects internally contradictory evidence; called before anything is built or written. Unavailable/null
 * evidence is preserved, never coerced.
 */
export function validateIncrementalChangeStalenessScenarioRecordV2(scenario: IncrementalChangeStalenessScenarioArtifactRecordV2): void {
  const id = scenario.scenarioId;

  // Comparisons: exactly three, fixed order, explicit identities, reference is full-refresh, never full vs full.
  if (!sameList(scenario.referenceComparisons.map((comparison) => comparison.candidateTreatmentId), COMPARISON_CANDIDATE_ORDER)) {
    contradiction(id, "reference comparisons must be exactly stale-index, changed-files-refresh, affected-neighborhood-refresh in order.");
  }
  for (const comparison of scenario.referenceComparisons) {
    if (comparison.referenceTreatmentId !== "full-refresh") contradiction(id, `${comparison.candidateTreatmentId} comparison references ${comparison.referenceTreatmentId}, not full-refresh.`);
    if ((comparison.candidateTreatmentId === "stale-index") !== (comparison.kind === "stale-risk")) {
      contradiction(id, `${comparison.candidateTreatmentId} comparison uses the wrong comparison kind (${comparison.kind}).`);
    }
  }

  // Stale comparison must use the unchanged stale-risk semantics.
  const stale = scenario.referenceComparisons[0];
  if (stale.kind === "stale-risk") {
    const expected = classifyStaleRisk(stale.comparison.correctnessRelation, stale.comparison.requiredFileEvidenceRelation);
    if (expected.staleRiskClassification !== stale.comparison.staleRiskClassification || !sameList(expected.reasonCodes, stale.comparison.reasonCodes)) {
      contradiction(id, "stale-index comparison does not follow the stale-risk classification rules.");
    }
  }

  // Treatment collection.
  if (scenario.treatments.length === 0) {
    if (scenario.status === "ready") contradiction(id, "a ready scenario must carry four treatment records.");
    for (const comparison of scenario.referenceComparisons) {
      if (comparison.kind === "partial-refresh" && comparison.refreshRealization !== null) {
        contradiction(id, `${comparison.candidateTreatmentId} carries a refresh realization although no treatment executed.`);
      }
    }
    return;
  }
  if (scenario.status !== "ready") contradiction(id, "a failed scenario must not carry treatment records.");
  if (!sameList(scenario.treatments.map((treatment) => treatment.treatmentId), INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS)) {
    contradiction(id, "treatments must be exactly stale-index, changed-files-refresh, affected-neighborhood-refresh, full-refresh, each once, in order.");
  }
  for (const treatment of scenario.treatments) {
    if (treatment.treatmentIntent !== INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS[treatment.treatmentId]) {
      contradiction(id, `${treatment.treatmentId} carries treatment intent ${treatment.treatmentIntent}.`);
    }
    const refresh = treatment.refreshExecution;
    if (treatment.treatmentId === "stale-index") {
      if (refresh.kind !== "no-refresh" || refresh.realization !== "NO_REFRESH" || refresh.incrementalRefresh !== null) contradiction(id, "stale-index must be no-refresh without incrementalRefresh evidence.");
      if (treatment.activeIndexPhase !== "baseline") contradiction(id, "stale-index active index must be the baseline.");
      if (treatment.refreshedFreshness !== null) contradiction(id, "stale-index has no refreshed freshness.");
    } else {
      if (treatment.activeIndexPhase !== "refreshed") contradiction(id, `${treatment.treatmentId} active index must be the refreshed index.`);
      if (treatment.refreshedFreshness === null) contradiction(id, `${treatment.treatmentId} is missing refreshed freshness.`);
    }
    if (treatment.treatmentId === "full-refresh") {
      if (refresh.kind !== "full" || refresh.realization !== "FULL_REFRESH" || refresh.incrementalRefresh !== null) contradiction(id, "full-refresh must be a full refresh without incrementalRefresh evidence.");
    }
    if (treatment.treatmentId === "changed-files-refresh" || treatment.treatmentId === "affected-neighborhood-refresh") {
      if (refresh.kind !== "incremental") contradiction(id, `${treatment.treatmentId} must be an incremental refresh.`);
      if (refresh.kind === "incremental") {
        const upstream = refresh.incrementalRefresh;
        if (upstream.requestedScope !== REQUESTED_SCOPE[treatment.treatmentId]) contradiction(id, `${treatment.treatmentId} requested scope ${upstream.requestedScope} does not match the treatment.`);
        if (refresh.realization === "APPLIED_PARTIAL" && (upstream.selectionStatus !== "applied" || upstream.appliedScope !== upstream.requestedScope)) {
          contradiction(id, `${treatment.treatmentId} is APPLIED_PARTIAL but upstream reported status=${upstream.selectionStatus} applied=${upstream.appliedScope}.`);
        }
        if (refresh.realization === "FALLBACK_FULL" && (upstream.selectionStatus !== "fallback-full" || upstream.appliedScope !== "full")) {
          contradiction(id, `${treatment.treatmentId} is FALLBACK_FULL but upstream reported status=${upstream.selectionStatus} applied=${upstream.appliedScope}.`);
        }
      }
    }
  }

  // Partial comparisons must agree with their treatment's realization and the frozen precedence.
  for (const candidate of PARTIAL_IDS) {
    const comparison = partialComparison(scenario, candidate);
    const treatment = scenario.treatments.find((entry) => entry.treatmentId === candidate);
    if (!comparison || !treatment || treatment.refreshExecution.kind !== "incremental") contradiction(id, `${candidate} comparison or treatment is missing.`);
    else {
      if (comparison.refreshRealization !== treatment.refreshExecution.realization) {
        contradiction(id, `${candidate} comparison realization ${comparison.refreshRealization} differs from the treatment realization ${treatment.refreshExecution.realization}.`);
      }
      const expected = classifyPartialRefreshAgainstFull({
        realization: treatment.refreshExecution.realization,
        correctnessRelation: comparison.correctnessRelation,
        requiredFileEvidenceRelation: comparison.requiredFileEvidenceRelation
      });
      if (expected.classification !== comparison.classification || !sameList(expected.reasonCodes, comparison.reasonCodes)) {
        contradiction(id, `${candidate} comparison does not follow the partial-refresh reference rules.`);
      }
    }
  }

  if (scenario.lifecycle) {
    for (const count of [...Object.values(scenario.lifecycle.indexInvocationCounts), ...Object.values(scenario.lifecycle.freshnessAssessmentCounts)]) {
      if (!Number.isInteger(count) || count < 0) contradiction(id, "lifecycle counts must be non-negative integers.");
    }
  } else {
    contradiction(id, "a ready scenario must carry a lifecycle summary.");
  }
}

export function validateIncrementalChangeStalenessExecutionArtifactV2(artifact: IncrementalChangeStalenessExecutionArtifactV2): void {
  if (artifact.schemaVersion !== INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2) {
    throw new Error(`Unexpected execution artifact schema ${String(artifact.schemaVersion)}.`);
  }
  for (const scenario of artifact.scenarios) validateIncrementalChangeStalenessScenarioRecordV2(scenario);
}

/**
 * Builds and validates the v2 artifact from already-executed scenario evidence, in the caller's canonical
 * scenario order. Throws on internal contradiction instead of serializing it.
 */
export function buildIncrementalChangeStalenessExecutionArtifactV2(args: {
  runId: string;
  pluginId: string;
  executions: readonly IncrementalChangeStalenessScenarioExecutionV2[];
}): IncrementalChangeStalenessExecutionArtifactV2 {
  const scenarios = args.executions.map(summarizeScenarioV2);
  const artifact: IncrementalChangeStalenessExecutionArtifactV2 = {
    schemaVersion: INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2,
    runId: args.runId,
    pluginId: args.pluginId,
    scenarios,
    summary: summarizeV2(scenarios)
  };
  validateIncrementalChangeStalenessExecutionArtifactV2(artifact);
  return artifact;
}

/** Writes to the canonical filename shared with v1; validates first so contradictory evidence is never serialized. */
export async function writeIncrementalChangeStalenessExecutionArtifactV2(outDir: string, artifact: IncrementalChangeStalenessExecutionArtifactV2): Promise<string> {
  validateIncrementalChangeStalenessExecutionArtifactV2(artifact);
  await mkdir(outDir, { recursive: true });
  const artifactPath = resolveWithinRoot(outDir, INCREMENTAL_CHANGE_STALENESS_EXECUTION_ARTIFACT_FILE);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
}

export type IncrementalChangeStalenessExecutionArtifactAny =
  | { version: "v1"; artifact: IncrementalChangeStalenessExecutionArtifactV1 }
  | { version: "v2"; artifact: IncrementalChangeStalenessExecutionArtifactV2 };

/** Discriminates V1 from V2 by schemaVersion only; historical V1 evidence is never converted to V2. */
export function parseIncrementalChangeStalenessExecutionArtifact(json: unknown): IncrementalChangeStalenessExecutionArtifactAny {
  const schemaVersion = json && typeof json === "object" ? (json as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (schemaVersion === INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION) {
    return { version: "v1", artifact: json as IncrementalChangeStalenessExecutionArtifactV1 };
  }
  if (schemaVersion === INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2) {
    return { version: "v2", artifact: json as IncrementalChangeStalenessExecutionArtifactV2 };
  }
  throw new Error(`Unrecognized incremental-change-staleness execution artifact schema: ${String(schemaVersion)}.`);
}

export async function readIncrementalChangeStalenessExecutionArtifact(artifactPath: string): Promise<IncrementalChangeStalenessExecutionArtifactAny> {
  return parseIncrementalChangeStalenessExecutionArtifact(JSON.parse(await readFile(artifactPath, "utf8")));
}
