// Read-only prompt-template comparison over already persisted agent-success-rate evidence. This module is pure:
// it receives validated side evidence and produces a deterministic report model. It never invokes a provider,
// never recalculates a task-success verdict, and never reads the filesystem.

import {
  CAMPAIGN_COMPONENTS,
  CAMPAIGN_IDENTITY_VERSION_V2,
  type CampaignIdentity
} from "../../experiments/plugins/agentSuccessRate/campaignIdentity.js";
import type { AgentSuccessRateExecutionArtifactV1 } from "../../experiments/plugins/agentSuccessRate/executionArtifact.js";
import type { AgentSuccessAttemptEvidenceV1, AgentSuccessTreatmentEvidenceV1 } from "../../experiments/plugins/agentSuccessRate/executionTypes.js";
import type { PromptContractV1 } from "../../experiments/plugins/agentSuccessRate/promptContract.js";

export const PROMPT_TEMPLATE_COMPARISON_SCHEMA = "prompt-template-comparison/1.0.0";
export const PROMPT_TEMPLATE_COMPARISON_JSON_FILE = "prompt-template-comparison.json";
export const PROMPT_TEMPLATE_COMPARISON_TEXT_FILE = "prompt-template-comparison.txt";
export const PROMPT_TEMPLATE_COMPARISON_HTML_FILE = "prompt-template-comparison.html";

export type PromptIdentityBasis = "campaign-identity-v2-verified-contract" | "legacy-v1-persisted-contract-artifacts" | "unverified";

/** Evidence for one side, already read and integrity-checked by the loader. */
export type PromptComparisonSideEvidence = {
  role: "baseline" | "candidate";
  identity: CampaignIdentity | null;
  promptBasis: PromptIdentityBasis;
  promptContract: PromptContractV1 | null;
  execution: AgentSuccessRateExecutionArtifactV1 | null;
  /** Bounded reasons the side as a whole could not be verified. */
  unverifiable: string[];
  /** unit key `<caseId>/<treatmentId>` -> reason its first-attempt prompt contract could not be verified. */
  unverifiedUnits: Map<string, string>;
  warnings: string[];
};

export type ComparabilityStatus = "COMPARABLE" | "INCOMPARABLE";
export type ComparisonCriterion = { id: string; status: "match" | "mismatch" | "unverifiable" | "not-required"; detail: string };

export type InvalidOutputStratum = {
  stratum: string;
  eligibleUnitCount: number;
  baseline: SideRate;
  candidate: SideRate;
  /** baseline rate minus candidate rate in percentage points; null when either rate is unavailable. */
  percentagePointDifference: number | null;
  availability: "available" | "unavailable";
  reason: string | null;
};

export type SideRate = {
  numerator: number;
  denominator: number;
  ratePercent: number | null;
  availability: "available" | "unavailable";
  reason: string | null;
  invalidByReason: Record<string, number>;
};

export type TaskSuccessStratum = {
  stratum: string;
  matchedUnitCount: number;
  unavailableUnitCount: number;
  initial: TaskSuccessBasis;
  final: TaskSuccessBasis;
};

export type TaskSuccessBasis = {
  baselineSuccessCount: number;
  candidateSuccessCount: number;
  denominator: number;
  bothSucceeded: number;
  onlyBaselineSucceeded: number;
  onlyCandidateSucceeded: number;
  neitherSucceeded: number;
};

export type PromptTemplateComparisonReportV1 = {
  schemaVersion: typeof PROMPT_TEMPLATE_COMPARISON_SCHEMA;
  reportKind: "prompt-template-comparison";
  comparison: { status: ComparabilityStatus; incomparabilityReasons: string[]; winner: null; basis: string };
  baseline: SideSummary;
  candidate: SideSummary;
  criteria: ComparisonCriterion[];
  cohort: {
    provider: string | null;
    matchedUnitCount: number;
    eligibleMatchedUnitCount: number;
    excludedUnitCount: number;
    exclusions: Array<{ unit: string; reason: string }>;
    exclusionReasonCounts: Record<string, number>;
    unknownOrUnavailableUnitCount: number;
    unmatchedCases: Array<{ caseId: string; reason: string }>;
  };
  invalidOutput: {
    metric: "invalid-eligible-first-attempt-responses / eligible-completed-first-attempt-responses";
    basis: "matched-first-attempt";
    strata: InvalidOutputStratum[];
    overall: InvalidOutputStratum | null;
    repairAttemptSummary: Array<{ attemptNumber: number; baselineEligible: number; baselineInvalid: number; candidateEligible: number; candidateInvalid: number; repairAllowance: number | null; note: string }>;
  };
  taskSuccess: { separateFromInvalidOutput: true; strata: TaskSuccessStratum[]; overall: TaskSuccessStratum | null };
  behavioralImprovement: { status: "VERIFIED" | "NOT_VERIFIED"; reason: string };
  provenance: { evidenceSource: "persisted-agent-success-rate-artifacts"; providerInvoked: false; generatedFrom: string[] };
  limitations: string[];
  warnings: string[];
};

export type SideSummary = {
  runId: string | null;
  completedAt: string | null;
  providerId: string | null;
  identityDigest: string | null;
  identitySchema: string | null;
  promptBasis: PromptIdentityBasis;
  templateId: string | null;
  promptContractDigest: string | null;
  promptContract: PromptContractV1 | null;
  repairAttempts: number | null;
  caseCount: number | null;
};

const TREATMENTS = ["raw-full-file", "context-pack"] as const;
const MAX_LISTED_EXCLUSIONS = 200;

type Classified = {
  eligible: boolean;
  invalid: boolean;
  /** Reason for exclusion, or the invalid reason when invalid, or "valid". */
  reason: string;
};

type UnitAttempt = { attempt: AgentSuccessAttemptEvidenceV1 | null; evidence: AgentSuccessTreatmentEvidenceV1; attemptNumber: number; taskSuccess: boolean | null };

function attemptsOf(treatment: AgentSuccessTreatmentEvidenceV1): UnitAttempt[] {
  if (treatment.attempts && treatment.attempts.length > 0) {
    return treatment.attempts.map((attempt) => ({ attempt, evidence: attempt.evidence, attemptNumber: attempt.attemptNumber, taskSuccess: attempt.taskSuccess }));
  }
  return [{ attempt: null, evidence: treatment, attemptNumber: 1, taskSuccess: null }];
}

/**
 * Classifies one attempt's response under the invalid-output definition. An attempt is eligible only when
 * persisted evidence proves a completed provider response, and invalid only when that evidence also proves a
 * contract violation. A provider status alone is never sufficient. Anything the evidence cannot establish is
 * excluded with an explicit reason: it is neither valid nor invalid and never enters the denominator.
 */
export function classifyResponseValidity(unit: UnitAttempt): Classified {
  const evidence = unit.evidence;
  const status = unit.attempt?.providerStatus ?? evidence.realAgent?.providerStatus ?? "not-invoked";
  const category = unit.attempt?.failureCategory ?? null;
  if (status === "not-invoked") return { eligible: false, invalid: false, reason: "provider-not-invoked" };
  if (status === "timeout") return { eligible: false, invalid: false, reason: "provider-timeout" };
  if (status === "agent-unavailable") return { eligible: false, invalid: false, reason: "provider-unavailable" };
  if (status === "agent-limit-reached") return { eligible: false, invalid: false, reason: "provider-limit-reached" };
  if (status === "failed" || status === "skipped") return { eligible: false, invalid: false, reason: "provider-failure" };
  // The provider run classifier's invalid-output status does not carry the application response contract result:
  // the response is not evaluated against the prompt contract in that case, so it proves no specific violation.
  if (status === "invalid-output") return { eligible: false, invalid: false, reason: "unverified-provider-invalid-output-status" };
  if (category === "infrastructure-failure" || category === "evidence-incomplete" || category === "integrity-unproven" || category === "context-unavailable" || category === "baseline-invalid" || category === "cleanup-failed") {
    return { eligible: false, invalid: false, reason: `unverified-${category}` };
  }
  if (status !== "completed") return { eligible: false, invalid: false, reason: "unverified-provider-status" };

  const real = evidence.realAgent;
  if (!real || real.providerInvoked !== true) return { eligible: false, invalid: false, reason: "missing-response-evidence" };
  const contractError = evidence.errors.find((error) => error.code.startsWith("OUTPUT_CONTRACT_"));
  if (!real.finalAnswerAvailable) {
    // A completed provider process with no usable final answer: invalid only when the persisted evidence names it.
    if (evidence.errors.some((error) => error.code === "PROVIDER_EMPTY_ANSWER")) return { eligible: true, invalid: true, reason: "provider-empty-answer" };
    return { eligible: false, invalid: false, reason: "missing-response-evidence" };
  }
  if (contractError) {
    if (!evidence.patch.attempted) return { eligible: false, invalid: false, reason: "missing-response-evidence" };
    return { eligible: true, invalid: true, reason: contractError.code };
  }
  if (!evidence.patch.attempted || evidence.patch.outcome === null) return { eligible: false, invalid: false, reason: "unverified-patch-pipeline-outcome" };
  if (evidence.patch.outcome === "parse-failure") return { eligible: true, invalid: true, reason: `malformed-diff${evidence.patch.code ? `:${evidence.patch.code}` : ""}` };
  // Policy rejection, git check/apply failure and failed task verification are well-formed responses.
  return { eligible: true, invalid: false, reason: "valid" };
}

function unitKey(caseId: string, treatmentId: string): string {
  return `${caseId}/${treatmentId}`;
}

function sorted<T>(values: Iterable<T>, key: (value: T) => string): T[] {
  return [...values].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function summarize(side: PromptComparisonSideEvidence): SideSummary {
  const identity = side.identity;
  const contract = side.promptContract;
  return {
    runId: side.execution?.runId ?? null,
    completedAt: side.execution?.completedAt ?? null,
    providerId: identity?.config.providerId ?? side.execution?.realAgent?.providerId ?? null,
    identityDigest: identity?.digest ?? null,
    identitySchema: identity?.schemaVersion ?? null,
    promptBasis: side.promptBasis,
    templateId: contract?.templateId ?? null,
    promptContractDigest: identity && identity.schemaVersion === CAMPAIGN_IDENTITY_VERSION_V2 ? identity.promptContractDigest : null,
    promptContract: contract ? structuredClone(contract) : null,
    repairAttempts: identity?.config.repairAttempts ?? null,
    caseCount: identity?.selected.length ?? null
  };
}

function emptyRate(reason: string): SideRate {
  return { numerator: 0, denominator: 0, ratePercent: null, availability: "unavailable", reason, invalidByReason: {} };
}

function rate(invalid: number, eligible: number, byReason: Record<string, number>): SideRate {
  if (eligible === 0) return { numerator: invalid, denominator: 0, ratePercent: null, availability: "unavailable", reason: "no eligible completed responses in the matched cohort", invalidByReason: byReason };
  return { numerator: invalid, denominator: eligible, ratePercent: (invalid / eligible) * 100, availability: "available", reason: null, invalidByReason: byReason };
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function stratumOf(name: string, units: Array<{ base: Classified; cand: Classified }>): InvalidOutputStratum {
  const baseReasons: Record<string, number> = {};
  const candReasons: Record<string, number> = {};
  let baseInvalid = 0;
  let candInvalid = 0;
  for (const unit of units) {
    if (unit.base.invalid) {
      baseInvalid += 1;
      baseReasons[unit.base.reason] = (baseReasons[unit.base.reason] ?? 0) + 1;
    }
    if (unit.cand.invalid) {
      candInvalid += 1;
      candReasons[unit.cand.reason] = (candReasons[unit.cand.reason] ?? 0) + 1;
    }
  }
  const baseline = rate(baseInvalid, units.length, sortedRecord(baseReasons));
  const candidate = rate(candInvalid, units.length, sortedRecord(candReasons));
  const available = baseline.availability === "available" && candidate.availability === "available";
  return {
    stratum: name,
    eligibleUnitCount: units.length,
    baseline,
    candidate,
    percentagePointDifference: available ? (baseline.ratePercent as number) - (candidate.ratePercent as number) : null,
    availability: available ? "available" : "unavailable",
    reason: available ? null : "no eligible matched units: the rate is unavailable, not zero percent"
  };
}

function taskBasis(pairs: Array<[boolean, boolean]>): TaskSuccessBasis {
  const result: TaskSuccessBasis = { baselineSuccessCount: 0, candidateSuccessCount: 0, denominator: pairs.length, bothSucceeded: 0, onlyBaselineSucceeded: 0, onlyCandidateSucceeded: 0, neitherSucceeded: 0 };
  for (const [base, cand] of pairs) {
    if (base) result.baselineSuccessCount += 1;
    if (cand) result.candidateSuccessCount += 1;
    if (base && cand) result.bothSucceeded += 1;
    else if (base) result.onlyBaselineSucceeded += 1;
    else if (cand) result.onlyCandidateSucceeded += 1;
    else result.neitherSucceeded += 1;
  }
  return result;
}

const SAME_TEMPLATE_LIMITATION = "Baseline and candidate use the same prompt template; no template effect is tested by this comparison.";

function compareIdentities(base: CampaignIdentity, cand: CampaignIdentity, contractBase: PromptContractV1, contractCand: PromptContractV1): { criteria: ComparisonCriterion[]; matchedCases: string[]; unmatchedCases: Array<{ caseId: string; reason: string }>; sameSelection: boolean } {
  const criteria: ComparisonCriterion[] = [];
  const add = (id: string, ok: boolean, detail: string): void => {
    criteria.push({ id, status: ok ? "match" : "mismatch", detail });
  };
  add("provider", base.config.providerId === cand.config.providerId, `baseline ${base.config.providerId}, candidate ${cand.config.providerId}`);
  add("repair-allowance", base.config.repairAttempts === cand.config.repairAttempts, `baseline ${base.config.repairAttempts}, candidate ${cand.config.repairAttempts}`);
  add("timeout", base.config.timeoutMs === cand.config.timeoutMs, `baseline ${base.config.timeoutMs} ms, candidate ${cand.config.timeoutMs} ms`);
  add("treatment-order", JSON.stringify(base.treatmentOrder) === JSON.stringify(cand.treatmentOrder), "fixed raw-full-file / context-pack order");
  for (const field of ["lengthMode", "explanationMode", "toolUseMode", "maxCommandCount", "providerId"] as const) {
    add(`prompt-${field}`, contractBase[field] === contractCand[field], `baseline ${String(contractBase[field])}, candidate ${String(contractCand[field])}`);
  }
  criteria.push({
    id: "prompt-template",
    status: "not-required",
    detail: `independent variable: baseline ${contractBase.templateId}, candidate ${contractCand.templateId}; renderer digests may differ`
  });

  const candById = new Map(cand.selected.map((row) => [row.caseId, row]));
  const baseIds = new Set(base.selected.map((row) => row.caseId));
  const matched: string[] = [];
  const unmatched: Array<{ caseId: string; reason: string }> = [];
  for (const row of base.selected) {
    const other = candById.get(row.caseId);
    if (!other) unmatched.push({ caseId: row.caseId, reason: "case-missing-in-candidate" });
    else if (other.projectId !== row.projectId) unmatched.push({ caseId: row.caseId, reason: "benchmark-project-mismatch" });
    else if (other.taskDigest !== row.taskDigest) unmatched.push({ caseId: row.caseId, reason: "task-digest-mismatch" });
    else matched.push(row.caseId);
  }
  for (const row of cand.selected) if (!baseIds.has(row.caseId)) unmatched.push({ caseId: row.caseId, reason: "case-missing-in-baseline" });
  unmatched.sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : a.reason < b.reason ? -1 : 1));
  const sameSelection = unmatched.length === 0;
  add("matched-cases", matched.length > 0, `${matched.length} case(s) share project and task digest`);

  for (const name of CAMPAIGN_COMPONENTS) {
    const a = base.components[name].digest;
    const b = cand.components[name].digest;
    const wholeCampaign = name === "corpus" || name === "tasks" || name === "projects" || name === "checks" || name === "behavior";
    if (wholeCampaign && !sameSelection) {
      criteria.push({ id: `component-${name}`, status: "not-required", detail: "selections differ; per-case task digests are compared instead" });
    } else if (a === null || b === null) {
      // A provider build observed on neither side is permitted; one-sided or other missing evidence cannot certify a match.
      if (a === null && b === null && name === "providerBuild") criteria.push({ id: `component-${name}`, status: "not-required", detail: "provider build not observed on either side" });
      else criteria.push({ id: `component-${name}`, status: "unverifiable", detail: "component digest missing on at least one side" });
    } else add(`component-${name}`, a === b, a === b ? "digests equal" : "digests differ");
  }
  return { criteria, matchedCases: matched, unmatchedCases: unmatched, sameSelection };
}

/** Builds the deterministic comparison model. Never throws for unverifiable evidence: that is INCOMPARABLE. */
export function buildPromptTemplateComparison(baseline: PromptComparisonSideEvidence, candidate: PromptComparisonSideEvidence): PromptTemplateComparisonReportV1 {
  const reasons: string[] = [];
  const warnings = [...baseline.warnings.map((w) => `baseline: ${w}`), ...candidate.warnings.map((w) => `candidate: ${w}`)];
  const limitations: string[] = [
    "Rates are descriptive observations over a finite matched cohort; no significance test, composite score or winner is produced.",
    "Task correctness is reported separately and is read from persisted verdicts; it is not recalculated.",
    "Deterministic fixtures can establish calculation correctness but not real-provider behavior."
  ];
  for (const side of [baseline, candidate]) {
    for (const reason of side.unverifiable) reasons.push(`${side.role}: ${reason}`);
    if (side.identity === null && side.unverifiable.length === 0) reasons.push(`${side.role}: campaign identity could not be verified`);
    if (side.promptContract === null || side.promptBasis === "unverified") reasons.push(`${side.role}: prompt template identity could not be established`);
    if (side.execution === null && !side.unverifiable.some((reason) => reason.includes("execution"))) reasons.push(`${side.role}: execution evidence is unavailable`);
  }

  let criteria: ComparisonCriterion[] = [];
  let matchedCases: string[] = [];
  let unmatchedCases: Array<{ caseId: string; reason: string }> = [];
  if (reasons.length === 0) {
    const base = baseline.identity as CampaignIdentity;
    const cand = candidate.identity as CampaignIdentity;
    const outcome = compareIdentities(base, cand, baseline.promptContract as PromptContractV1, candidate.promptContract as PromptContractV1);
    criteria = outcome.criteria;
    matchedCases = outcome.matchedCases;
    unmatchedCases = outcome.unmatchedCases;
    if (base.config.providerId === "deterministic-fixture") reasons.push("deterministic-fixture evidence has no prompt template to compare");
    for (const criterion of criteria) {
      if (criterion.status === "mismatch") reasons.push(`${criterion.id}: ${criterion.detail}`);
      if (criterion.status === "unverifiable") reasons.push(`${criterion.id}: ${criterion.detail}`);
    }
    if ((baseline.promptContract as PromptContractV1).templateId === (candidate.promptContract as PromptContractV1).templateId) limitations.push(SAME_TEMPLATE_LIMITATION);
    if (baseline.promptBasis === "legacy-v1-persisted-contract-artifacts" || candidate.promptBasis === "legacy-v1-persisted-contract-artifacts") {
      limitations.push("A legacy V1 campaign identity does not bind a prompt contract; its template is established only from the persisted per-attempt prompt-contract.json artifacts of this run, which agree and match the legacy default.");
    }
  }

  const status: ComparabilityStatus = reasons.length === 0 ? "COMPARABLE" : "INCOMPARABLE";
  const baseSummary = summarize(baseline);
  const candSummary = summarize(candidate);
  const header = {
    schemaVersion: PROMPT_TEMPLATE_COMPARISON_SCHEMA as typeof PROMPT_TEMPLATE_COMPARISON_SCHEMA,
    reportKind: "prompt-template-comparison" as const,
    baseline: baseSummary,
    candidate: candSummary,
    criteria,
    provenance: { evidenceSource: "persisted-agent-success-rate-artifacts" as const, providerInvoked: false as const, generatedFrom: ["agent-success-rate-execution.json", "campaign identity checkpoint", "prompt-contract.json", "agent-success-rate-analysis.json"] },
    behavioralImprovement: {
      status: "NOT_VERIFIED" as const,
      reason: "Observed real-provider improvement requires separately authorized paired provider evidence under compatible conditions; none was evaluated."
    },
    warnings,
    limitations
  };

  if (status === "INCOMPARABLE") {
    return {
      ...header,
      comparison: { status, incomparabilityReasons: reasons.slice(0, 50), winner: null, basis: "no winner is declared for incomparable evidence" },
      cohort: { provider: baseSummary.providerId, matchedUnitCount: 0, eligibleMatchedUnitCount: 0, excludedUnitCount: 0, exclusions: [], exclusionReasonCounts: {}, unknownOrUnavailableUnitCount: 0, unmatchedCases },
      invalidOutput: {
        metric: "invalid-eligible-first-attempt-responses / eligible-completed-first-attempt-responses",
        basis: "matched-first-attempt",
        strata: [],
        overall: null,
        repairAttemptSummary: []
      },
      taskSuccess: { separateFromInvalidOutput: true, strata: [], overall: null }
    };
  }

  // ---- COMPARABLE: match units, classify first attempts, aggregate by treatment stratum ----
  const baseExec = baseline.execution as AgentSuccessRateExecutionArtifactV1;
  const candExec = candidate.execution as AgentSuccessRateExecutionArtifactV1;
  const baseCases = new Map(baseExec.cases.map((c) => [c.caseId, c]));
  const candCases = new Map(candExec.cases.map((c) => [c.caseId, c]));
  const exclusions: Array<{ unit: string; reason: string }> = [];
  const exclusionCounts: Record<string, number> = {};
  const exclude = (unit: string, reason: string): void => {
    exclusions.push({ unit, reason });
    exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1;
  };

  type Matched = { treatment: string; key: string; base: Classified; cand: Classified; baseUnit: UnitAttempt[]; candUnit: UnitAttempt[] };
  const matchedUnits: Matched[] = [];
  let unknownUnits = 0;
  let matchedUnitCount = 0;
  for (const caseId of sorted(matchedCases, (value) => value)) {
    for (const treatment of TREATMENTS) {
      const key = unitKey(caseId, treatment);
      const b = baseCases.get(caseId)?.treatments.find((t) => t.treatmentId === treatment);
      const c = candCases.get(caseId)?.treatments.find((t) => t.treatmentId === treatment);
      if (!b || !c) {
        exclude(key, "execution-evidence-missing");
        unknownUnits += 1;
        continue;
      }
      matchedUnitCount += 1;
      const baseUnit = attemptsOf(b);
      const candUnit = attemptsOf(c);
      const baseUnverified = baseline.unverifiedUnits.get(key);
      const candUnverified = candidate.unverifiedUnits.get(key);
      if (baseUnverified || candUnverified) {
        exclude(key, `${baseUnverified ? "baseline" : "candidate"}:${baseUnverified ?? candUnverified}`);
        unknownUnits += 1;
        continue;
      }
      const baseClass = classifyResponseValidity(baseUnit[0] as UnitAttempt);
      const candClass = classifyResponseValidity(candUnit[0] as UnitAttempt);
      if (!baseClass.eligible || !candClass.eligible) {
        exclude(key, !baseClass.eligible ? `baseline:${baseClass.reason}` : `candidate:${candClass.reason}`);
        if (baseClass.reason.startsWith("unverified") || candClass.reason.startsWith("unverified") || baseClass.reason === "missing-response-evidence" || candClass.reason === "missing-response-evidence") unknownUnits += 1;
        continue;
      }
      matchedUnits.push({ treatment, key, base: baseClass, cand: candClass, baseUnit, candUnit });
    }
  }

  const strata: InvalidOutputStratum[] = TREATMENTS.map((treatment) => stratumOf(treatment, matchedUnits.filter((unit) => unit.treatment === treatment)));
  const overall = stratumOf("all-treatments", matchedUnits);
  if (strata.some((stratum) => stratum.eligibleUnitCount === 0) && overall.eligibleUnitCount > 0) {
    warnings.push("Overall figures omit a treatment stratum with no eligible units; read the per-treatment strata.");
  }

  // Repair attempts keep their attempt number and policy; they are never attributed to the initial response.
  const repairAllowance = (baseline.identity as CampaignIdentity).config.repairAttempts;
  const repairSummary: PromptTemplateComparisonReportV1["invalidOutput"]["repairAttemptSummary"] = [];
  for (const attemptNumber of [2, 3]) {
    let baseEligible = 0;
    let baseInvalid = 0;
    let candEligible = 0;
    let candInvalid = 0;
    for (const unit of matchedUnits) {
      const b = unit.baseUnit.find((u) => u.attemptNumber === attemptNumber);
      const c = unit.candUnit.find((u) => u.attemptNumber === attemptNumber);
      if (b) {
        const cls = classifyResponseValidity(b);
        if (cls.eligible) {
          baseEligible += 1;
          if (cls.invalid) baseInvalid += 1;
        }
      }
      if (c) {
        const cls = classifyResponseValidity(c);
        if (cls.eligible) {
          candEligible += 1;
          if (cls.invalid) candInvalid += 1;
        }
      }
    }
    if (baseEligible + candEligible > 0) {
      repairSummary.push({
        attemptNumber,
        baselineEligible: baseEligible,
        baselineInvalid: baseInvalid,
        candidateEligible: candEligible,
        candidateInvalid: candInvalid,
        repairAllowance,
        note: "repair-attempt responses; unmatched across sides and not part of the primary first-attempt comparison"
      });
    }
  }

  // Task success: read persisted verdicts for matched units; determinate on both sides only.
  const verdicts = (units: UnitAttempt[]): { initial: boolean | null; final: boolean | null } => ({
    initial: units[0]?.attempt ? units[0].taskSuccess : null,
    final: units.length > 0 && units[units.length - 1]?.attempt ? (units[units.length - 1] as UnitAttempt).taskSuccess : null
  });
  const taskStrata: TaskSuccessStratum[] = [];
  const allInitial: Array<[boolean, boolean]> = [];
  const allFinal: Array<[boolean, boolean]> = [];
  let allUnavailable = 0;
  let allMatched = 0;
  for (const treatment of TREATMENTS) {
    const initial: Array<[boolean, boolean]> = [];
    const final: Array<[boolean, boolean]> = [];
    let unavailable = 0;
    let matchedCount = 0;
    for (const caseId of sorted(matchedCases, (value) => value)) {
      const b = baseCases.get(caseId)?.treatments.find((t) => t.treatmentId === treatment);
      const c = candCases.get(caseId)?.treatments.find((t) => t.treatmentId === treatment);
      if (!b || !c) continue;
      matchedCount += 1;
      const bv = verdicts(attemptsOf(b));
      const cv = verdicts(attemptsOf(c));
      if (bv.final === null || cv.final === null || bv.initial === null || cv.initial === null) {
        unavailable += 1;
        continue;
      }
      initial.push([bv.initial, cv.initial]);
      final.push([bv.final, cv.final]);
    }
    taskStrata.push({ stratum: treatment, matchedUnitCount: matchedCount, unavailableUnitCount: unavailable, initial: taskBasis(initial), final: taskBasis(final) });
    allInitial.push(...initial);
    allFinal.push(...final);
    allUnavailable += unavailable;
    allMatched += matchedCount;
  }
  const taskOverall: TaskSuccessStratum | null =
    allMatched > 0 ? { stratum: "all-treatments", matchedUnitCount: allMatched, unavailableUnitCount: allUnavailable, initial: taskBasis(allInitial), final: taskBasis(allFinal) } : null;

  const listed = sorted(exclusions, (value) => `${value.unit}\u0000${value.reason}`);
  if (listed.length > MAX_LISTED_EXCLUSIONS) warnings.push(`Exclusion list truncated to ${MAX_LISTED_EXCLUSIONS} of ${listed.length} entries; counts are complete.`);
  return {
    ...header,
    warnings,
    comparison: {
      status,
      incomparabilityReasons: [],
      winner: null,
      basis: `matched ${matchedCases.length} case(s) over ${TREATMENTS.length} treatments; prompt template is the independent variable`
    },
    cohort: {
      provider: baseSummary.providerId,
      matchedUnitCount,
      eligibleMatchedUnitCount: matchedUnits.length,
      excludedUnitCount: exclusions.length,
      exclusions: listed.slice(0, MAX_LISTED_EXCLUSIONS),
      exclusionReasonCounts: sortedRecord(exclusionCounts),
      unknownOrUnavailableUnitCount: unknownUnits,
      unmatchedCases
    },
    invalidOutput: {
      metric: "invalid-eligible-first-attempt-responses / eligible-completed-first-attempt-responses",
      basis: "matched-first-attempt",
      strata,
      overall,
      repairAttemptSummary: repairSummary
    },
    taskSuccess: { separateFromInvalidOutput: true, strata: taskStrata, overall: taskOverall }
  };
}
