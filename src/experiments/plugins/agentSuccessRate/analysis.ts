import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import {
  AGENT_SUCCESS_MEAN_SOURCES,
  AGENT_SUCCESS_METRIC_IDS,
  type AgentSuccessCaseAnalysisV1,
  type AgentSuccessComparisonV1,
  type AgentSuccessMeanId,
  type AgentSuccessMeanV1,
  type AgentSuccessMetricId,
  type AgentSuccessRateAnalysisV1,
  type AgentSuccessTreatmentAggregateV1,
  type AgentSuccessTreatmentAnalysisV1
} from "./analysisTypes.js";
import type { AgentSuccessCaseEvidenceV1, AgentSuccessTreatmentEvidenceV1, AgentSuccessVerificationCheckEvidenceV1 } from "./executionTypes.js";
import { AGENT_SUCCESS_RATE_EXECUTION_MODE, AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE, AGENT_SUCCESS_RATE_TREATMENT_IDS, type AgentSuccessExecutionMode } from "./metadata.js";
import { availableMetric, notApplicableMetric, ratioMetric, triMetric, unavailableMetric } from "./metrics.js";
import type { AgentSuccessMetricUnit, AgentSuccessMetricV1, Tri } from "./types.js";

export const AGENT_SUCCESS_RATE_LIMITATIONS: readonly string[] = [
  "Deterministic-fixture mode applies the same fixture patch to both treatment identities; the patch is not generated from any supplied context.",
  "contextEffectEvaluated is false: raw-full-file versus context-pack differences are pipeline diagnostics, not performance evidence.",
  "No coding agent runs, so no agent success rate, agent duration or provider token usage exists.",
  "Verification counts are command/check level; individual test counts are not inferred from command output.",
  "No weighted score, ranking, winner or significance claim is produced."
];

export const AGENT_SUCCESS_RATE_REAL_AGENT_LIMITATIONS: readonly string[] = [
  "Real-agent mode gives each treatment exactly one provider attempt; the provider generated its own patch from only the supplied treatment context.",
  "Task success is derived from trusted checks on the actual changed repository state; agent prose is never evidence of success.",
  "Matched-case comparisons are descriptive. A single run supports no causal, ranking, winner or statistical-significance claim.",
  "Estimated context tokens are size estimates of the supplied context and are not provider-reported token usage.",
  "Cases with an unavailable treatment verdict are excluded from matched metrics and reported separately.",
  "Verification counts are command/check level; individual test counts are not inferred from command output.",
  "No weighted score, ranking, winner or significance claim is produced."
];

type EvaluationState = "infrastructure-failure" | "baseline-invalid" | "no-answer" | "no-evidence" | "patch-failed" | "patched";

const STATE_REASON: Record<Exclude<EvaluationState, "patched">, string> = {
  "infrastructure-failure": "execution infrastructure failed before the attempt could be evaluated.",
  "baseline-invalid": "the benchmark baseline is not evaluable, so no implementation attempt was evaluated.",
  "no-answer": "the provider produced no usable answer, so no implementation attempt was evaluated.",
  "no-evidence": "required execution evidence is missing.",
  "patch-failed": "the fixture patch was not applied, so post-edit verification did not run."
};

function and3(...values: Tri[]): Tri {
  if (values.includes(false)) return false;
  if (values.includes("unknown")) return "unknown";
  return true;
}

function stateOf(evidence: AgentSuccessTreatmentEvidenceV1): EvaluationState {
  if (evidence.availability === "infrastructure-failure") return "infrastructure-failure";
  if (evidence.baselineAssessment === null || evidence.availability === "baseline-invalid" || !evidence.baselineAssessment.evaluable) return "baseline-invalid";
  if (!evidence.patch.attempted || evidence.patch.outcome === null) return evidence.realAgent ? "no-answer" : "no-evidence";
  return evidence.patch.outcome === "success" ? "patched" : "patch-failed";
}

/** passed -> true, failed -> false, timeout/error/missing -> unknown. */
function checkTri(result: AgentSuccessVerificationCheckEvidenceV1 | undefined): Tri {
  if (result === undefined) return "unknown";
  if (result.status === "passed") return true;
  if (result.status === "failed") return false;
  return "unknown";
}

/** Any failed -> false; else any missing/indeterminate -> unknown; else true. */
function allChecks(ids: readonly string[], results: ReadonlyMap<string, AgentSuccessVerificationCheckEvidenceV1>): Tri {
  return and3(...ids.map((id) => checkTri(results.get(id))));
}

function byId(results: readonly AgentSuccessVerificationCheckEvidenceV1[] | undefined): Map<string, AgentSuccessVerificationCheckEvidenceV1> {
  return new Map((results ?? []).map((result) => [result.checkId, result]));
}

function duration(id: AgentSuccessMetricId, value: number | null): AgentSuccessMetricV1 {
  return value !== null && Number.isFinite(value) && value >= 0
    ? availableMetric(id, value, "ms")
    : unavailableMetric(id, "ms", "the duration was not measured.");
}

/**
 * The single owner of per-case/per-treatment scientific values. Inputs are the validated task and normalized execution
 * evidence only; agent prose and fixture notes are never consulted.
 */
export function analyzeAgentSuccessTreatment(task: AgentSuccessTaskV1, evidence: AgentSuccessTreatmentEvidenceV1): AgentSuccessTreatmentAnalysisV1 {
  const state = stateOf(evidence);
  const gate =
    state === "patched" ? null : state === "patch-failed" && evidence.realAgent ? "the provider patch was not applied, so post-edit verification did not run." : STATE_REASON[state];
  const m: Partial<Record<AgentSuccessMetricId, AgentSuccessMetricV1>> = {};
  const un = (id: AgentSuccessMetricId, unit: AgentSuccessMetricUnit, reason: string): AgentSuccessMetricV1 => unavailableMetric(id, unit, reason);

  const post = evidence.postEditVerification;
  const postTask = byId(post?.taskResults);
  const postRegression = byId(post?.regressionResults);
  const postAll = new Map([...postTask, ...postRegression]);
  const baselineRegressionPassed = new Set((evidence.baselineVerification?.regressionResults ?? []).filter((r) => r.status === "passed").map((r) => r.checkId));
  const postEvidenceMissing = state === "patched" && post === null ? "post-edit verification evidence is missing." : null;

  // --- verification-derived tri-states (only meaningful once a patch was applied) ---
  const taskIds = task.taskChecks.map((c) => c.id);
  const regressionIds = task.regressionChecks.filter((c) => baselineRegressionPassed.has(c.id)).map((c) => c.id);
  const patched = state === "patched" && post !== null;
  const taskChecksTri: Tri = patched ? allChecks(taskIds, postTask) : "unknown";
  const regressionTri: Tri = patched ? allChecks(regressionIds, postRegression) : "unknown";
  const factState = (fact: AgentSuccessTaskV1["behaviorFacts"][number]): Tri => (patched ? allChecks(fact.verificationCheckIds, postAll) : "unknown");
  const requiredFacts = task.behaviorFacts.filter((fact) => fact.required);
  const optionalFacts = task.behaviorFacts.filter((fact) => !fact.required);
  const requiredStates = requiredFacts.map(factState);
  const optionalStates = optionalFacts.map(factState);
  const requiredTri = and3(...requiredStates);
  const integrity = evidence.protectedIntegrity.status;
  const integrityTri: Tri = integrity === "intact" ? true : integrity === "mutated" ? false : "unknown";
  const patchApplied = state === "patched";

  const reasonFor = (fallback: string): string => gate ?? postEvidenceMissing ?? fallback;

  // --- task success ---
  m.patchApplied = state === "patched" || state === "patch-failed" ? availableMetric("patchApplied", patchApplied, "boolean") : un("patchApplied", "boolean", gate ?? STATE_REASON["no-evidence"]);
  if (state === "patch-failed") {
    m.taskChecksPassed = un("taskChecksPassed", "boolean", gate as string);
    m.regressionSafe = un("regressionSafe", "boolean", gate as string);
    m.requiredFactsSatisfied = un("requiredFactsSatisfied", "boolean", gate as string);
  } else {
    m.taskChecksPassed = triMetric("taskChecksPassed", taskChecksTri, reasonFor("a task check was missing or indeterminate."));
    m.regressionSafe = triMetric("regressionSafe", regressionTri, reasonFor("a regression check was missing or indeterminate."));
    m.requiredFactsSatisfied = triMetric("requiredFactsSatisfied", requiredTri, reasonFor("a required fact's check evidence was missing or indeterminate."));
  }
  m.protectedIntegrity =
    state === "baseline-invalid" || state === "infrastructure-failure" || state === "no-evidence" || state === "no-answer"
      ? un("protectedIntegrity", "boolean", gate as string)
      : triMetric("protectedIntegrity", integrityTri, "protected-file integrity could not be proven.");

  const resolved: Tri = state === "patched" ? and3(true, taskChecksTri, requiredTri) : state === "patch-failed" ? false : "unknown";
  const success: Tri = state === "patched" ? and3(resolved, regressionTri, integrityTri) : state === "patch-failed" ? false : "unknown";
  m.taskResolved = triMetric("taskResolved", resolved, gate ?? "a task check or required fact could not be determined.");
  m.taskSuccess = triMetric("taskSuccess", success, gate ?? "a component of task success could not be determined.");

  // --- behavior facts ---
  const determinate = (states: readonly Tri[]): boolean => states.every((s) => s !== "unknown");
  const count = (states: readonly Tri[]): number => states.filter((s) => s === true).length;
  m.requiredFactsTotal = availableMetric("requiredFactsTotal", requiredFacts.length, "count");
  m.optionalFactsTotal = availableMetric("optionalFactsTotal", optionalFacts.length, "count");
  m.requiredFactsSatisfiedCount = determinate(requiredStates) && patched ? availableMetric("requiredFactsSatisfiedCount", count(requiredStates), "count") : un("requiredFactsSatisfiedCount", "count", reasonFor("a required fact could not be determined."));
  m.optionalFactsSatisfiedCount = determinate(optionalStates) && patched ? availableMetric("optionalFactsSatisfiedCount", count(optionalStates), "count") : un("optionalFactsSatisfiedCount", "count", reasonFor("an optional fact could not be determined."));
  m.requiredFactCoverage =
    requiredFacts.length === 0
      ? notApplicableMetric("requiredFactCoverage", "ratio", "the task defines no required facts.")
      : determinate(requiredStates) && patched
        ? ratioMetric("requiredFactCoverage", count(requiredStates), requiredFacts.length, "no required facts.")
        : un("requiredFactCoverage", "ratio", reasonFor("a required fact could not be determined."));
  const allStates = [...requiredStates, ...optionalStates];
  m.factCoverage =
    task.behaviorFacts.length === 0
      ? notApplicableMetric("factCoverage", "ratio", "the task defines no behavior facts.")
      : determinate(allStates) && patched
        ? ratioMetric("factCoverage", count(allStates), task.behaviorFacts.length, "no facts.")
        : un("factCoverage", "ratio", reasonFor("a behavior fact could not be determined."));

  // --- check-level counts ---
  const taskComplete = patched && taskIds.every((id) => postTask.has(id) && postTask.get(id)!.status !== "timeout" && postTask.get(id)!.status !== "error");
  const regressionAll = task.regressionChecks.map((c) => c.id);
  const regressionComplete = patched && regressionAll.every((id) => postRegression.has(id) && postRegression.get(id)!.status !== "timeout" && postRegression.get(id)!.status !== "error");
  const passedOf = (ids: readonly string[], results: ReadonlyMap<string, AgentSuccessVerificationCheckEvidenceV1>): number => ids.filter((id) => results.get(id)?.status === "passed").length;
  const checkReason = (kind: string): string => reasonFor(`a ${kind} check was missing, timed out or errored; complete check evidence is required.`);
  if (taskComplete) {
    m.taskCheckPassedCount = availableMetric("taskCheckPassedCount", passedOf(taskIds, postTask), "count");
    m.taskCheckTotalCount = availableMetric("taskCheckTotalCount", taskIds.length, "count");
    m.taskCheckPassRate = ratioMetric("taskCheckPassRate", passedOf(taskIds, postTask), taskIds.length, "the task defines no task checks.");
  } else {
    m.taskCheckPassedCount = un("taskCheckPassedCount", "count", checkReason("task"));
    m.taskCheckTotalCount = un("taskCheckTotalCount", "count", checkReason("task"));
    m.taskCheckPassRate = un("taskCheckPassRate", "ratio", checkReason("task"));
  }
  if (regressionComplete) {
    m.regressionCheckPassedCount = availableMetric("regressionCheckPassedCount", passedOf(regressionAll, postRegression), "count");
    m.regressionCheckTotalCount = availableMetric("regressionCheckTotalCount", regressionAll.length, "count");
    m.regressionCheckPassRate = ratioMetric("regressionCheckPassRate", passedOf(regressionAll, postRegression), regressionAll.length, "the task defines no regression checks.");
    m.regressionFailureCount = availableMetric(
      "regressionFailureCount",
      regressionIds.filter((id) => postRegression.get(id)?.status === "failed").length,
      "count"
    );
  } else {
    for (const id of ["regressionCheckPassedCount", "regressionCheckTotalCount", "regressionFailureCount"] as const) m[id] = un(id, "count", checkReason("regression"));
    m.regressionCheckPassRate = un("regressionCheckPassRate", "ratio", checkReason("regression"));
  }

  // --- edit quality and blast radius (ChangeSet evidence only) ---
  const change = patched ? evidence.change : null;
  const changeReason = reasonFor("change evidence was not captured.");
  const expected = new Set(task.expectedEditFiles);
  const allowed = new Set(task.allowedEditFiles);
  m.expectedEditFileCount = availableMetric("expectedEditFileCount", expected.size, "count");
  if (change === null) {
    for (const id of ["expectedEditFilesChangedCount", "allowedEditChangedFileCount", "unexpectedChangedFileCount", "changedFileCount", "addedFileCount", "modifiedFileCount", "deletedFileCount", "linesAdded", "linesDeleted", "totalChurn"] as const) {
      m[id] = un(id, id.startsWith("lines") || id === "totalChurn" ? "lines" : "count", changeReason);
    }
    m.expectedEditCoverage = un("expectedEditCoverage", "ratio", changeReason);
    m.editScopePrecision = un("editScopePrecision", "ratio", changeReason);
    m.relativeChurn = un("relativeChurn", "ratio", changeReason);
  } else {
    const paths = change.changedFiles.map((file) => file.relativePath);
    const expectedChanged = paths.filter((p) => expected.has(p)).length;
    const allowedChanged = paths.filter((p) => allowed.has(p)).length;
    const statusCount = (status: string): number => change.changedFiles.filter((file) => file.status === status).length;
    m.expectedEditFilesChangedCount = availableMetric("expectedEditFilesChangedCount", expectedChanged, "count");
    m.expectedEditCoverage = ratioMetric("expectedEditCoverage", expectedChanged, expected.size, "the task expects no edited files.");
    m.allowedEditChangedFileCount = availableMetric("allowedEditChangedFileCount", allowedChanged, "count");
    m.unexpectedChangedFileCount = availableMetric("unexpectedChangedFileCount", paths.length - allowedChanged, "count");
    m.editScopePrecision = ratioMetric("editScopePrecision", allowedChanged, paths.length, "no files were changed.");
    m.changedFileCount = availableMetric("changedFileCount", paths.length, "count");
    m.addedFileCount = availableMetric("addedFileCount", statusCount("added"), "count");
    m.modifiedFileCount = availableMetric("modifiedFileCount", statusCount("modified"), "count");
    m.deletedFileCount = availableMetric("deletedFileCount", statusCount("deleted"), "count");
    const hasBinary = change.changedFiles.some((file) => file.additions === null || file.deletions === null);
    if (hasBinary) {
      const reason = "a changed file has no line counts (binary); line metrics are not estimated.";
      m.linesAdded = un("linesAdded", "lines", reason);
      m.linesDeleted = un("linesDeleted", "lines", reason);
      m.totalChurn = un("totalChurn", "lines", reason);
      m.relativeChurn = un("relativeChurn", "ratio", reason);
    } else {
      const added = change.changedFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0);
      const deleted = change.changedFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
      m.linesAdded = availableMetric("linesAdded", added, "lines");
      m.linesDeleted = availableMetric("linesDeleted", deleted, "lines");
      m.totalChurn = availableMetric("totalChurn", added + deleted, "lines");
      const baseLines = evidence.baselineTextLineCount;
      m.relativeChurn =
        baseLines === null
          ? un("relativeChurn", "ratio", "the baseline text-line count could not be determined.")
          : ratioMetric("relativeChurn", added + deleted, baseLines, "the baseline has no text lines.");
    }
  }
  m.baselineTextLineCount =
    evidence.baselineTextLineCount === null
      ? un("baselineTextLineCount", "lines", "the baseline text-line count could not be determined.")
      : availableMetric("baselineTextLineCount", evidence.baselineTextLineCount, "lines");

  // --- protected edits: actual mutation vs. attempted ---
  const mutationEvaluable = (state === "patched" || state === "patch-failed") && integrity !== "unproven";
  m.protectedMutationCount = mutationEvaluable
    ? availableMetric("protectedMutationCount", evidence.protectedIntegrity.mutatedPaths.length, "count")
    : un("protectedMutationCount", "count", gate ?? "protected-file integrity could not be proven.");
  m.attemptedProtectedEditCount = evidence.patch.attempted
    ? availableMetric("attemptedProtectedEditCount", evidence.patch.attemptedProtectedPaths.length, "count")
    : un("attemptedProtectedEditCount", "count", "no patch was attempted.");

  // --- time and tokens ---
  const real = evidence.realAgent;
  if (!real) {
    m.agentDurationMs = un("agentDurationMs", "ms", "deterministic-fixture mode runs no agent.");
    m.agentTotalTokens = un("agentTotalTokens", "tokens", "deterministic-fixture mode has no provider token usage.");
  } else {
    m.agentDurationMs = real.providerInvoked ? duration("agentDurationMs", evidence.timing.agentDurationMs) : un("agentDurationMs", "ms", "no provider attempt ran.");
    const usage = evidence.agentTokenUsage;
    m.agentTotalTokens =
      usage !== null && usage.totalTokens !== null
        ? availableMetric("agentTotalTokens", usage.totalTokens, "tokens")
        : un(
            "agentTotalTokens",
            "tokens",
            usage === null ? "no provider attempt ran." : `the provider reported no total token usage (source: ${usage.source}, reliability: ${usage.reliability}).`
          );
  }
  m.baselineVerificationDurationMs = duration("baselineVerificationDurationMs", evidence.timing.baselineVerificationDurationMs);
  m.patchPipelineDurationMs = duration("patchPipelineDurationMs", evidence.timing.patchPipelineDurationMs);
  m.postEditVerificationDurationMs = duration("postEditVerificationDurationMs", evidence.timing.postEditVerificationDurationMs);
  m.evaluationDurationMs = duration("evaluationDurationMs", evidence.timing.evaluationDurationMs);

  const metrics = {} as Record<AgentSuccessMetricId, AgentSuccessMetricV1>;
  for (const id of AGENT_SUCCESS_METRIC_IDS) {
    const metric = m[id];
    if (!metric) throw new Error(`Agent success analysis did not produce metric ${id}.`);
    metrics[id] = metric;
  }
  return { treatmentId: evidence.treatmentId, caseId: task.id, executionStatus: evidence.status, evidenceAvailability: evidence.availability, metrics };
}

function mean(id: AgentSuccessMeanId, caseIds: readonly string[], treatment: readonly AgentSuccessTreatmentAnalysisV1[], allTreatments: readonly (readonly AgentSuccessTreatmentAnalysisV1[])[]): AgentSuccessMeanV1 {
  const sourceMetricId = AGENT_SUCCESS_MEAN_SOURCES[id];
  const matched = caseIds.filter((caseId) => allTreatments.every((series) => series.find((entry) => entry.caseId === caseId)?.metrics[sourceMetricId].availability === "available"));
  const unit = treatment[0]?.metrics[sourceMetricId].unit ?? "count";
  if (matched.length === 0) {
    return { sourceMetricId, matchedCaseIds: [], metric: unavailableMetric(id, unit, "no case has available evidence for this quantity in every treatment.") };
  }
  const values = matched.map((caseId) => treatment.find((entry) => entry.caseId === caseId)!.metrics[sourceMetricId].value as number);
  return { sourceMetricId, matchedCaseIds: matched, metric: availableMetric(id, values.reduce((sum, value) => sum + value, 0) / values.length, unit) };
}

/**
 * Per-case analysis plus unweighted aggregates. Means are taken over matched cases only (available for every
 * treatment); unavailable values are never converted to zero. No composite, ranking or winner is produced.
 */
export function analyzeAgentSuccessRate(
  tasks: readonly AgentSuccessTaskV1[],
  caseEvidence: readonly AgentSuccessCaseEvidenceV1[],
  executionMode: AgentSuccessExecutionMode = AGENT_SUCCESS_RATE_EXECUTION_MODE
): AgentSuccessRateAnalysisV1 {
  if (tasks.length !== caseEvidence.length || tasks.some((task, index) => caseEvidence[index]?.caseId !== task.id)) {
    throw new Error("Agent success analysis requires case evidence in the same order as the selected tasks.");
  }
  const cases: AgentSuccessCaseAnalysisV1[] = tasks.map((task, index) => {
    const evidence = caseEvidence[index]!;
    if (evidence.treatments.length !== AGENT_SUCCESS_RATE_TREATMENT_IDS.length || evidence.treatments.some((t, i) => t.treatmentId !== AGENT_SUCCESS_RATE_TREATMENT_IDS[i])) {
      throw new Error(`Agent success analysis requires both treatments in fixed order for case ${task.id}.`);
    }
    return { caseId: task.id, benchmarkProject: task.benchmarkProject, treatments: evidence.treatments.map((t) => analyzeAgentSuccessTreatment(task, t)) };
  });

  const series = AGENT_SUCCESS_RATE_TREATMENT_IDS.map((_, treatmentIndex) => cases.map((c) => c.treatments[treatmentIndex]!));
  const caseIds = cases.map((c) => c.caseId);
  const aggregates: AgentSuccessTreatmentAggregateV1[] = AGENT_SUCCESS_RATE_TREATMENT_IDS.map((treatmentId, treatmentIndex) => {
    const own = series[treatmentIndex]!;
    const evaluable = own.filter((entry) => entry.metrics.taskSuccess.availability === "available");
    const successful = evaluable.filter((entry) => entry.metrics.taskSuccess.value === true);
    const rate = (id: string): AgentSuccessMetricV1 =>
      evaluable.length === 0 ? unavailableMetric(id, "ratio", "no case has a determinate task-success verdict for this treatment.") : availableMetric(id, successful.length / evaluable.length, "ratio");
    const means = {} as Record<AgentSuccessMeanId, AgentSuccessMeanV1>;
    for (const meanId of Object.keys(AGENT_SUCCESS_MEAN_SOURCES) as AgentSuccessMeanId[]) means[meanId] = mean(meanId, caseIds, own, series);
    return {
      treatmentId,
      evaluableCaseCount: evaluable.length,
      successfulCaseCount: successful.length,
      taskSuccessRate: rate("taskSuccessRate"),
      initialAttemptSuccessRate: rate("initialAttemptSuccessRate"),
      agentTokenMeasurementsAvailable: own.filter((entry) => entry.metrics.agentTotalTokens.availability === "available").length,
      agentTokenMeasurementsUnavailable: own.filter((entry) => entry.metrics.agentTotalTokens.availability !== "available").length,
      means
    };
  });

  if (executionMode === AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE) {
    const comparison = buildComparison(cases);
    return {
      executionMode,
      contextEffectEvaluated: comparison.matchedCaseIds.length > 0,
      treatmentOrder: [...AGENT_SUCCESS_RATE_TREATMENT_IDS],
      caseCount: cases.length,
      cases,
      aggregates,
      limitations: [...AGENT_SUCCESS_RATE_REAL_AGENT_LIMITATIONS],
      comparison
    };
  }
  return {
    executionMode: AGENT_SUCCESS_RATE_EXECUTION_MODE,
    contextEffectEvaluated: false,
    treatmentOrder: [...AGENT_SUCCESS_RATE_TREATMENT_IDS],
    caseCount: cases.length,
    cases,
    aggregates,
    limitations: [...AGENT_SUCCESS_RATE_LIMITATIONS]
  };
}

/** Descriptive matched-case accounting: only cases with a determinate verdict for every treatment are matched. */
function buildComparison(cases: readonly AgentSuccessCaseAnalysisV1[]): AgentSuccessComparisonV1 {
  const matchedCaseIds: string[] = [];
  const incompleteCases: AgentSuccessComparisonV1["incompleteCases"] = [];
  const pairedOutcomes = { bothSucceeded: 0, onlyRawFullFileSucceeded: 0, onlyContextPackSucceeded: 0, neitherSucceeded: 0 };
  for (const entry of cases) {
    const unavailableTreatmentIds = entry.treatments.filter((t) => t.metrics.taskSuccess.availability !== "available").map((t) => t.treatmentId);
    if (unavailableTreatmentIds.length > 0) {
      incompleteCases.push({ caseId: entry.caseId, unavailableTreatmentIds });
      continue;
    }
    matchedCaseIds.push(entry.caseId);
    const raw = entry.treatments[0]!.metrics.taskSuccess.value === true;
    const pack = entry.treatments[1]!.metrics.taskSuccess.value === true;
    if (raw && pack) pairedOutcomes.bothSucceeded += 1;
    else if (raw) pairedOutcomes.onlyRawFullFileSucceeded += 1;
    else if (pack) pairedOutcomes.onlyContextPackSucceeded += 1;
    else pairedOutcomes.neitherSucceeded += 1;
  }
  return { basis: "matched-evaluable-cases", matchedCaseIds, incompleteCases, pairedOutcomes };
}
