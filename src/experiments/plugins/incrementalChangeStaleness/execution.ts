import path from "node:path";
import { runAgentPrompt } from "../../../agents/index.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import {
  assessAffectedNeighborhood,
  mapAffectedNeighborhoodSeeds,
  type AffectedNeighborhoodAssessmentV1
} from "../../../evaluation/affectedNeighborhood.js";
import { classifyAgentRunOutcome } from "../../../evaluation/classifyAgentRunOutcome.js";
import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import { parseAgentAnswer } from "../../../evaluation/parseAgentAnswer.js";
import { readEvaluationCases } from "../../../evaluation/readEvaluationCases.js";
import { runMyDevKitRetrievalFromIndex } from "../../../evaluation/runMyDevKitRetrieval.js";
import { scoreCorrectness } from "../../../evaluation/scoreCorrectness.js";
import type { CorrectnessScore } from "../../../evaluation/controlledExperimentTypes.js";
import type { BenchmarkProjectProfile, BenchmarkTaskAnswerKey, EvaluationCase, MyDevKitRetrievalResult } from "../../../evaluation/types.js";
import { generatePromptVariants } from "../../../prompts/index.js";
import {
  buildRequiredFileEvidence,
  classifyStaleRisk,
  compareCorrectness,
  compareRequiredFileEvidence,
  type CorrectnessComparableV1,
  type CorrectnessRelationV1,
  type RequiredFileEvidenceRelationV1,
  type RequiredFileEvidenceV1,
  type StaleRiskClassificationResultV1
} from "./comparison.js";
import { WARM_INDEX_BENCHMARK_CASES_PATH } from "./scenarioCatalog.js";
import type {
  IncrementalChangeStalenessAnswerPolicy,
  IncrementalChangeStalenessScenario,
  IncrementalChangeStalenessScenarioCategory
} from "./scenarioTypes.js";
import type {
  IncrementalChangeStalenessBaseCaseIdentityV1,
  IncrementalChangeStalenessIndexEvidenceV1,
  IncrementalChangeStalenessIndexRole,
  IncrementalChangeStalenessLifecycleResultV1,
  IncrementalChangeStalenessScenarioSessionV1,
  IncrementalChangeStalenessTreatmentSessionV1
} from "./treatmentSession.js";
import type { IncrementalChangeStalenessTreatmentId, IncrementalChangeStalenessV2TreatmentId } from "./disposableTarget.js";

// ---------------------------------------------------------------------------
// v0.6.2 Batch 4 -- treatment retrieval, correctness, and required-file
// evidence. Reuses existing generic owners exactly (mapAffectedNeighborhoodSeeds
// / assessAffectedNeighborhood, runMyDevKitRetrievalFromIndex, scoreCorrectness,
// generatePromptVariants + runAgentPrompt("fake-agent") + parseAgentAnswer +
// classifyAgentRunOutcome). No new correctness/retrieval/fake-agent algorithm
// is introduced here.
// ---------------------------------------------------------------------------

const SCOREABLE_STATUSES = new Set(["completed", "invalid-output"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Query / answer-key resolution (frozen batch prompt section 7-9).
// ---------------------------------------------------------------------------

export type IncrementalChangeStalenessResolvedQueryAnswerV1 = {
  query: string;
  answerKey: BenchmarkTaskAnswerKey;
  expectedFiles: string[];
  expectedSymbols: string[];
};

/**
 * Resolves one scenario's query/answer key. `inherit` reuses the referenced base case's existing
 * query/answer key unchanged; `scenario` uses the scenario's own post-mutation query/answer key.
 * The two are never merged. Reads the same canonical benchmark-case contract the lifecycle already
 * validated against; never mutates it.
 */
export async function resolveIncrementalChangeStalenessQueryAndAnswer(options: {
  scenario: IncrementalChangeStalenessScenario;
  repoRoot: string;
}): Promise<IncrementalChangeStalenessResolvedQueryAnswerV1> {
  const { scenario, repoRoot } = options;
  if (scenario.answerPolicy === "scenario") {
    if (!scenario.scenarioQuery || !scenario.scenarioAnswerKey) {
      throw new Error(`Scenario ${scenario.id}: answerPolicy is "scenario" but scenarioQuery/scenarioAnswerKey are missing.`);
    }
    return {
      query: scenario.scenarioQuery,
      answerKey: scenario.scenarioAnswerKey,
      expectedFiles: [...scenario.scenarioAnswerKey.expectedFiles],
      expectedSymbols: [...scenario.scenarioAnswerKey.expectedSymbols]
    };
  }
  const cases = await readEvaluationCases(path.resolve(repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), repoRoot);
  const baseCase = cases.find((candidate) => candidate.id === scenario.baseCaseId);
  if (!baseCase) {
    throw new Error(`Scenario ${scenario.id}: base case ${scenario.baseCaseId} was not found for query/answer resolution.`);
  }
  if (!baseCase.answerKey) {
    throw new Error(`Scenario ${scenario.id}: base case ${scenario.baseCaseId} declares no answerKey for the "inherit" answer policy.`);
  }
  return {
    query: baseCase.query,
    answerKey: baseCase.answerKey,
    expectedFiles: [...baseCase.answerKey.expectedFiles],
    expectedSymbols: [...baseCase.answerKey.expectedSymbols]
  };
}

// ---------------------------------------------------------------------------
// Derived in-memory task descriptor (section 9). Never written to disk and
// never replaces the canonical benchmark case/answer-key files.
// ---------------------------------------------------------------------------

/**
 * Builds one in-memory `EvaluationCase`-shaped task descriptor: identity/project/source ownership
 * comes from the canonical base case; query and expected files/symbols come from the resolved
 * query/answer. Used for affected-neighborhood task mapping, treatment retrieval, and fake-agent
 * prompt generation; it is never materialized as a benchmark case file.
 */
export function buildIncrementalChangeStalenessDerivedTask(args: {
  scenario: IncrementalChangeStalenessScenario;
  baseEvaluationCase: EvaluationCase;
  resolved: IncrementalChangeStalenessResolvedQueryAnswerV1;
}): EvaluationCase {
  const base = args.baseEvaluationCase;
  return {
    ...base,
    id: `${args.scenario.id}:${base.id}`,
    title: `${args.scenario.id} (${base.title})`,
    query: args.resolved.query,
    expectedFiles: [...args.resolved.expectedFiles],
    expectedSymbols: [...args.resolved.expectedSymbols],
    answerKey: args.resolved.answerKey,
    projectProfileRef: base.projectProfileRef ?? base.benchmarkProject
  };
}

// ---------------------------------------------------------------------------
// Affected-neighborhood execution (sections 10-14, 56).
// ---------------------------------------------------------------------------

/**
 * Assesses one treatment's affected neighborhood using its BASELINE change authority (never the
 * refreshed graph, even for full-refresh): the baseline index's snapshot/graph plus the treatment's
 * already-established post-mutation baseline freshness.
 */
export function assessIncrementalChangeStalenessAffectedNeighborhood(
  treatment: {
    readonly changeAuthority: {
      readonly baselineIndex: Pick<IncrementalChangeStalenessIndexEvidenceV1<IncrementalChangeStalenessV2TreatmentId>, "snapshot" | "graph">;
      readonly postMutationBaselineFreshness: IndexFreshnessAssessmentV1;
    };
  },
  derivedTask: Pick<EvaluationCase, "expectedFiles" | "expectedSymbols">
): AffectedNeighborhoodAssessmentV1 {
  const changeAuthority = treatment.changeAuthority;
  const seedMapping = mapAffectedNeighborhoodSeeds({
    indexSnapshot: changeAuthority.baselineIndex.snapshot,
    freshness: changeAuthority.postMutationBaselineFreshness,
    graph: changeAuthority.baselineIndex.graph
  });
  return assessAffectedNeighborhood({ graph: changeAuthority.baselineIndex.graph, seedMapping, task: derivedTask });
}

export type AffectedNeighborhoodSymmetryResultV1 = { symmetric: true } | { symmetric: false; reason: string };

const SYMMETRIC_NUMERIC_FIELDS = [
  "changedFileCount",
  "changedSymbolCount",
  "affectedNodeCount",
  "affectedEdgeCount",
  "taskOverlapCount",
  "taskOverlapPercent"
] as const;

/**
 * Section 13: requires equality of assessment status, relationship, reindexRecommendation, and the
 * availability/value of all six numeric metrics between the two treatment baselines. Does not
 * require raw graph identity or absolute paths to match.
 */
export function checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry(
  stale: AffectedNeighborhoodAssessmentV1,
  fullRefresh: AffectedNeighborhoodAssessmentV1
): AffectedNeighborhoodSymmetryResultV1 {
  const mismatches: string[] = [];
  if (stale.status !== fullRefresh.status) mismatches.push(`status (${stale.status} vs ${fullRefresh.status})`);
  if (stale.relationship !== fullRefresh.relationship) mismatches.push(`relationship (${stale.relationship} vs ${fullRefresh.relationship})`);
  if (stale.reindexRecommendation !== fullRefresh.reindexRecommendation) {
    mismatches.push(`reindexRecommendation (${stale.reindexRecommendation} vs ${fullRefresh.reindexRecommendation})`);
  }
  for (const field of SYMMETRIC_NUMERIC_FIELDS) {
    if (stale[field] !== fullRefresh[field]) {
      mismatches.push(`${field} (${String(stale[field])} vs ${String(fullRefresh[field])})`);
    }
  }
  if (mismatches.length === 0) return { symmetric: true };
  return { symmetric: false, reason: `Affected-neighborhood assessments are asymmetric: ${mismatches.join("; ")}.` };
}

// ---------------------------------------------------------------------------
// Treatment retrieval (sections 16-20, 24-29).
// ---------------------------------------------------------------------------

export type IncrementalChangeStalenessRetrievalStatus = "completed" | "skipped" | "failed";

/** Same classification rule as the existing warm-index-reuse execution owner. */
export function classifyIncrementalChangeStalenessRetrieval(result: MyDevKitRetrievalResult): IncrementalChangeStalenessRetrievalStatus {
  if (!result.skipped) return "completed";
  return result.commands.some((command) => !command.ok) ? "failed" : "skipped";
}

export async function runIncrementalChangeStalenessTreatmentRetrieval(args: {
  derivedTask: EvaluationCase;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
}): Promise<MyDevKitRetrievalResult> {
  return runMyDevKitRetrievalFromIndex({
    evaluationCase: args.derivedTask,
    kitCommand: args.kitCommand,
    indexDir: args.indexDir,
    commandsDir: args.commandsDir,
    requireKit: false
  });
}

/**
 * Section 27: a `failed` retrieval status means the actual-files-read set cannot be trusted as
 * complete (unknown); `completed` and `skipped` (search ran and legitimately found no candidate)
 * both provide a complete, trustworthy files-read set, possibly empty.
 */
export function buildIncrementalChangeStalenessRequiredFileEvidence(args: {
  requiredFiles: readonly string[];
  retrieval: MyDevKitRetrievalResult | null;
}): RequiredFileEvidenceV1 {
  if (!args.retrieval) {
    return buildRequiredFileEvidence({
      requiredFiles: args.requiredFiles,
      observedFiles: [],
      observedFilesComplete: false,
      unknownReason: "No retrieval was attempted for this treatment."
    });
  }
  const status = classifyIncrementalChangeStalenessRetrieval(args.retrieval);
  return buildRequiredFileEvidence({
    requiredFiles: args.requiredFiles,
    observedFiles: args.retrieval.filesRead,
    observedFilesComplete: status !== "failed",
    unknownReason:
      status === "failed"
        ? `Retrieval failed (${args.retrieval.warnings.join(" ") || "my-dev-kit retrieval command failed."}); the actual-files-read set is incomplete.`
        : undefined
  });
}

// ---------------------------------------------------------------------------
// Deterministic fake-agent evaluation (section 21) -- composed directly from
// the existing generic owners (generatePromptVariants, runAgentPrompt with
// agentId "fake-agent", parseAgentAnswer, classifyAgentRunOutcome,
// scoreCorrectness). No new scoring/classification algorithm.
// ---------------------------------------------------------------------------

export type IncrementalChangeStalenessFakeAgentEvidenceV1 = {
  status: string;
  correctness: {
    available: boolean;
    score: number | null;
    passed: boolean | null;
    failureReasons: string[];
  };
  /** Full bounded correctness detail (matched/missing fact counts); null when not scoreable. */
  correctnessDetail: CorrectnessScore | null;
  durationMs: number | null;
  warnings: string[];
  errors: string[];
};

export async function runIncrementalChangeStalenessFakeAgent(args: {
  derivedTask: EvaluationCase;
  projectProfiles: readonly BenchmarkProjectProfile[];
  outDir: string;
  cwd: string;
  runId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<IncrementalChangeStalenessFakeAgentEvidenceV1> {
  try {
    const [promptVariant] = generatePromptVariants({
      cases: [args.derivedTask],
      projectProfiles: [...args.projectProfiles],
      strategies: ["my-dev-kit-guided"],
      complexityLevels: ["short"]
    });
    if (!promptVariant) {
      throw new Error(`Failed to generate a fake-agent prompt for case ${args.derivedTask.id}.`);
    }
    const agentRunResult = await runAgentPrompt({
      runId: args.runId,
      agentId: "fake-agent",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: args.cwd,
      outDir: args.outDir,
      env: args.env
    });
    const parsedAnswer = parseAgentAnswer({
      text: agentRunResult.finalAnswerText,
      answerKey: promptVariant.expectedAnswerKey,
      tokenUsage: agentRunResult.tokenUsage
    });
    const classification = classifyAgentRunOutcome({ agentRunResult, parsedAnswer });
    const correctness = scoreCorrectness({
      caseId: args.derivedTask.id,
      answerKey: promptVariant.expectedAnswerKey,
      parsedAnswer,
      status: classification.status
    });
    const scoreable = SCOREABLE_STATUSES.has(classification.status) && Number.isFinite(correctness.correctnessScore);
    return {
      status: classification.status,
      correctness: {
        available: scoreable,
        score: scoreable ? correctness.correctnessScore : null,
        passed: scoreable ? correctness.passed : null,
        failureReasons: [...correctness.failureReasons]
      },
      correctnessDetail: scoreable ? correctness : null,
      durationMs: agentRunResult.durationMs,
      warnings: [...classification.warnings],
      errors: [...classification.errors]
    };
  } catch (error) {
    return {
      status: "failed",
      correctness: { available: false, score: null, passed: null, failureReasons: [] },
      correctnessDetail: null,
      durationMs: null,
      warnings: [],
      errors: [errorMessage(error)]
    };
  }
}

// ---------------------------------------------------------------------------
// Per-treatment execution result and orchestration (sections 36-41).
// ---------------------------------------------------------------------------

export type IncrementalChangeStalenessTreatmentExecutionStatus = "completed" | "partial" | "failed";

export type IncrementalChangeStalenessTreatmentExecutionV1 = {
  treatmentId: IncrementalChangeStalenessTreatmentId;
  status: IncrementalChangeStalenessTreatmentExecutionStatus;
  failureReason: string | null;
  activeIndexPhase: IncrementalChangeStalenessIndexRole;
  baselineFreshness: IndexFreshnessAssessmentV1;
  affectedNeighborhood: AffectedNeighborhoodAssessmentV1;
  retrieval: MyDevKitRetrievalResult | null;
  retrievalStatus: IncrementalChangeStalenessRetrievalStatus | "not-run";
  fakeAgent: IncrementalChangeStalenessFakeAgentEvidenceV1 | null;
  requiredFileEvidence: RequiredFileEvidenceV1;
};

export function correctnessComparable(fakeAgent: IncrementalChangeStalenessFakeAgentEvidenceV1 | null): CorrectnessComparableV1 {
  if (!fakeAgent || !fakeAgent.correctness.available || fakeAgent.correctness.score === null) {
    return { available: false };
  }
  return { available: true, score: fakeAgent.correctness.score };
}

export type IncrementalChangeStalenessComparisonV1 = {
  correctnessRelation: CorrectnessRelationV1;
  requiredFileEvidenceRelation: RequiredFileEvidenceRelationV1;
  staleRiskClassification: StaleRiskClassificationResultV1["staleRiskClassification"];
  reasonCodes: string[];
};

export type IncrementalChangeStalenessScenarioExecutionV1 = {
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
  session: IncrementalChangeStalenessScenarioSessionV1 | null;
  stale: IncrementalChangeStalenessTreatmentExecutionV1 | null;
  fullRefresh: IncrementalChangeStalenessTreatmentExecutionV1 | null;
  comparison: IncrementalChangeStalenessComparisonV1;
};

export const INCONCLUSIVE_NO_EXECUTION: IncrementalChangeStalenessComparisonV1 = {
  correctnessRelation: "unknown",
  requiredFileEvidenceRelation: "unknown",
  staleRiskClassification: "inconclusive",
  reasonCodes: ["correctness-unavailable", "required-file-evidence-unavailable"]
};

export type IncrementalChangeStalenessExecutionDeps = {
  runRetrieval: typeof runIncrementalChangeStalenessTreatmentRetrieval;
  runFakeAgent: typeof runIncrementalChangeStalenessFakeAgent;
};

export const defaultIncrementalChangeStalenessExecutionDeps: IncrementalChangeStalenessExecutionDeps = {
  runRetrieval: runIncrementalChangeStalenessTreatmentRetrieval,
  runFakeAgent: runIncrementalChangeStalenessFakeAgent
};

/**
 * Retrieval + deterministic fake-agent + required-file evidence for ONE treatment against its own active
 * index. Shared by the v0.6.2 two-treatment path and the v0.6.3 four-treatment path; takes only the
 * lifecycle-provided facts it needs so it never reaches into another treatment's state.
 */
export async function executeTreatmentEvaluation<T extends IncrementalChangeStalenessV2TreatmentId>(args: {
  treatmentId: T;
  baselineFreshness: IndexFreshnessAssessmentV1;
  activeIndexPhase: IncrementalChangeStalenessIndexRole;
  activeIndexDir: string;
  derivedTask: EvaluationCase;
  affectedNeighborhood: AffectedNeighborhoodAssessmentV1;
  requiredFiles: readonly string[];
  kitCommand: string;
  retrievalCommandsDir: string;
  agentOutDir: string;
  projectProfiles: readonly BenchmarkProjectProfile[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  deps: IncrementalChangeStalenessExecutionDeps;
}): Promise<{
  treatmentId: T;
  status: IncrementalChangeStalenessTreatmentExecutionStatus;
  failureReason: string | null;
  activeIndexPhase: IncrementalChangeStalenessIndexRole;
  baselineFreshness: IndexFreshnessAssessmentV1;
  affectedNeighborhood: AffectedNeighborhoodAssessmentV1;
  retrieval: MyDevKitRetrievalResult | null;
  retrievalStatus: IncrementalChangeStalenessRetrievalStatus | "not-run";
  fakeAgent: IncrementalChangeStalenessFakeAgentEvidenceV1 | null;
  requiredFileEvidence: RequiredFileEvidenceV1;
}> {
  let retrieval: MyDevKitRetrievalResult | null = null;
  let retrievalStatus: IncrementalChangeStalenessRetrievalStatus | "not-run" = "not-run";
  let failureReason: string | null = null;
  try {
    retrieval = await args.deps.runRetrieval({
      derivedTask: args.derivedTask,
      kitCommand: args.kitCommand,
      indexDir: args.activeIndexDir,
      commandsDir: args.retrievalCommandsDir
    });
    retrievalStatus = classifyIncrementalChangeStalenessRetrieval(retrieval);
  } catch (error) {
    failureReason = `Treatment retrieval threw: ${errorMessage(error)}`;
    retrievalStatus = "failed";
  }

  let fakeAgent: IncrementalChangeStalenessFakeAgentEvidenceV1 | null = null;
  if (retrieval !== null) {
    fakeAgent = await args.deps.runFakeAgent({
      derivedTask: args.derivedTask,
      projectProfiles: args.projectProfiles,
      outDir: args.agentOutDir,
      cwd: args.cwd,
      runId: `${args.derivedTask.id}.${args.treatmentId}`,
      env: args.env
    });
  }

  const requiredFileEvidence = buildIncrementalChangeStalenessRequiredFileEvidence({
    requiredFiles: args.requiredFiles,
    retrieval
  });

  const status: IncrementalChangeStalenessTreatmentExecutionStatus =
    retrievalStatus === "failed" || fakeAgent?.status === "failed"
      ? "partial"
      : retrievalStatus === "completed" && fakeAgent && fakeAgent.correctness.available
        ? "completed"
        : "partial";

  return {
    treatmentId: args.treatmentId,
    status,
    failureReason,
    activeIndexPhase: args.activeIndexPhase,
    baselineFreshness: args.baselineFreshness,
    affectedNeighborhood: args.affectedNeighborhood,
    retrieval,
    retrievalStatus,
    fakeAgent,
    requiredFileEvidence
  };
}

async function executeOneTreatment(args: {
  session: IncrementalChangeStalenessScenarioSessionV1;
  treatmentId: IncrementalChangeStalenessTreatmentId;
  derivedTask: EvaluationCase;
  affectedNeighborhood: AffectedNeighborhoodAssessmentV1;
  requiredFiles: readonly string[];
  kitCommand: string;
  retrievalCommandsDir: string;
  agentOutDir: string;
  projectProfiles: readonly BenchmarkProjectProfile[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  deps: IncrementalChangeStalenessExecutionDeps;
}): Promise<IncrementalChangeStalenessTreatmentExecutionV1> {
  const treatment = args.session.treatments[args.treatmentId];
  return executeTreatmentEvaluation({
    treatmentId: args.treatmentId,
    baselineFreshness: treatment.changeAuthority.postMutationBaselineFreshness,
    activeIndexPhase: treatment.activeRetrieval.role,
    activeIndexDir: treatment.activeRetrieval.index.indexDir,
    derivedTask: args.derivedTask,
    affectedNeighborhood: args.affectedNeighborhood,
    requiredFiles: args.requiredFiles,
    kitCommand: args.kitCommand,
    retrievalCommandsDir: args.retrievalCommandsDir,
    agentOutDir: args.agentOutDir,
    projectProfiles: args.projectProfiles,
    cwd: args.cwd,
    env: args.env,
    deps: args.deps
  });
}

/** Resolves the scenario's query/answer and derives the one in-memory task shared by every matched treatment. */
export async function resolveIncrementalChangeStalenessScenarioTask(options: {
  repoRoot: string;
  scenario: IncrementalChangeStalenessScenario;
}): Promise<{ resolved: IncrementalChangeStalenessResolvedQueryAnswerV1; derivedTask: EvaluationCase }> {
  const { scenario } = options;
  const resolved = await resolveIncrementalChangeStalenessQueryAndAnswer({ scenario, repoRoot: options.repoRoot });
  const cases = await readEvaluationCases(path.resolve(options.repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), options.repoRoot);
  const baseEvaluationCase = cases.find((candidate) => candidate.id === scenario.baseCaseId);
  if (!baseEvaluationCase) {
    throw new Error(`Scenario ${scenario.id}: base case ${scenario.baseCaseId} was not found for task-descriptor construction.`);
  }
  return { resolved, derivedTask: buildIncrementalChangeStalenessDerivedTask({ scenario, baseEvaluationCase, resolved }) };
}

/**
 * Executes the frozen Batch 4 order (section 36) for one ready lifecycle session: resolve query and
 * answer, derive the task descriptor, assess both treatments' affected neighborhoods from BASELINE
 * change authority, verify symmetry, then run stale retrieval/fake-agent/correctness/required-file
 * evidence, then full-refresh, then compare and classify. A lifecycle that is not `ready` is
 * reported as a failed scenario execution with no fabricated treatment evidence (section 39).
 */
export async function executeIncrementalChangeStalenessScenario(options: {
  repoRoot: string;
  scenario: IncrementalChangeStalenessScenario;
  lifecycle: IncrementalChangeStalenessLifecycleResultV1;
  baseCase: IncrementalChangeStalenessBaseCaseIdentityV1;
  projectProfiles: readonly BenchmarkProjectProfile[];
  runOwnedRoot: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  deps?: Partial<IncrementalChangeStalenessExecutionDeps>;
}): Promise<IncrementalChangeStalenessScenarioExecutionV1> {
  const deps: IncrementalChangeStalenessExecutionDeps = { ...defaultIncrementalChangeStalenessExecutionDeps, ...options.deps };
  const scenario = options.scenario;

  if (options.lifecycle.status !== "ready") {
    // Section 39: scenario-level failure; no treatment execution, comparison stays inconclusive.
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
      stale: null,
      fullRefresh: null,
      comparison: INCONCLUSIVE_NO_EXECUTION
    };
  }

  const session = options.lifecycle.session;
  const { resolved, derivedTask } = await resolveIncrementalChangeStalenessScenarioTask({ repoRoot: options.repoRoot, scenario });

  const staleAffected = assessIncrementalChangeStalenessAffectedNeighborhood(session.treatments["stale-index"], derivedTask);
  const fullAffected = assessIncrementalChangeStalenessAffectedNeighborhood(session.treatments["full-refresh"], derivedTask);
  const symmetry = checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry(staleAffected, fullAffected);

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

  if (!symmetry.symmetric) {
    return {
      ...scenarioBase,
      status: "failed",
      failureReason: `AFFECTED_NEIGHBORHOOD_ASYMMETRY: ${symmetry.reason}`,
      stale: null,
      fullRefresh: null,
      comparison: INCONCLUSIVE_NO_EXECUTION
    };
  }

  const retrievalCommandsDir = (treatmentId: IncrementalChangeStalenessTreatmentId) =>
    resolveWithinRoot(options.runOwnedRoot, path.join("commands", scenario.id, treatmentId, "retrieval"));
  const agentOutDir = (treatmentId: IncrementalChangeStalenessTreatmentId) =>
    resolveWithinRoot(options.runOwnedRoot, path.join("agents", scenario.id, treatmentId));

  // Stale-index runs first, deterministically, before full-refresh (section 37).
  const stale = await executeOneTreatment({
    session,
    treatmentId: "stale-index",
    derivedTask,
    affectedNeighborhood: staleAffected,
    requiredFiles: resolved.expectedFiles,
    kitCommand: session.kitCommand,
    retrievalCommandsDir: retrievalCommandsDir("stale-index"),
    agentOutDir: agentOutDir("stale-index"),
    projectProfiles: options.projectProfiles,
    cwd: options.cwd,
    env: options.env,
    deps
  });
  const fullRefresh = await executeOneTreatment({
    session,
    treatmentId: "full-refresh",
    derivedTask,
    affectedNeighborhood: fullAffected,
    requiredFiles: resolved.expectedFiles,
    kitCommand: session.kitCommand,
    retrievalCommandsDir: retrievalCommandsDir("full-refresh"),
    agentOutDir: agentOutDir("full-refresh"),
    projectProfiles: options.projectProfiles,
    cwd: options.cwd,
    env: options.env,
    deps
  });

  const correctnessRelation = compareCorrectness(correctnessComparable(stale.fakeAgent), correctnessComparable(fullRefresh.fakeAgent));
  const requiredFileEvidenceRelation = compareRequiredFileEvidence(stale.requiredFileEvidence, fullRefresh.requiredFileEvidence);
  const classification = classifyStaleRisk(correctnessRelation, requiredFileEvidenceRelation);

  return {
    ...scenarioBase,
    status: "ready",
    failureReason: null,
    stale,
    fullRefresh,
    comparison: {
      correctnessRelation,
      requiredFileEvidenceRelation,
      staleRiskClassification: classification.staleRiskClassification,
      reasonCodes: classification.reasonCodes
    }
  };
}
