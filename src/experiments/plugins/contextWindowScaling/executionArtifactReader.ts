import { validateContextBudgets } from "./config.js";
import {
  CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION,
  type ContextWindowScalingExecutionArtifactV1,
} from "./executionArtifact.js";
import { CONTEXT_WINDOW_SCALING_PLUGIN_ID, CONTEXT_WINDOW_SCALING_TREATMENT_IDS } from "./metadata.js";

const MAX_REPORTED_PROBLEMS = 8;
const RUN_STATUSES = ["completed", "partial", "failed", "skipped"];
const AVAILABILITY = ["available", "unavailable"];
const EVALUATION_STATUSES = ["evaluated", "not-evaluated-no-fitting-budget", "unavailable"];
const RELEVANT_STATUSES = ["available", "unavailable", "not-applicable"];
const FIT_STATUSES = ["fits", "context-too-large", "unavailable"];
const CELL_EVALUATION_STATUSES = ["evaluated", "not-evaluated-context-too-large", "unavailable"];
const SUCCESS_REASONS = ["correctness-pass", "correctness-fail", "context-too-large", "evaluation-unavailable", "context-unavailable"];

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown) => typeof v === "string";
const isStrOrNull = (v: unknown) => v === null || typeof v === "string";
const isCount = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isCountOrNull = (v: unknown) => v === null || isCount(v);
const isNumOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const isStrArray = (v: unknown) => Array.isArray(v) && v.every((item) => typeof item === "string");
const isOneOf = (v: unknown, allowed: readonly string[]) => typeof v === "string" && allowed.includes(v);

/**
 * Structural validator for the persisted V1 execution artifact. It checks only what aggregation and
 * plotting need (closed enums, types, budget/cell agreement); it never repairs or coerces values.
 * Throws one Error listing bounded problems; returns the input, typed, when valid.
 */
export function parseContextWindowScalingExecutionArtifact(value: unknown): ContextWindowScalingExecutionArtifactV1 {
  if (!isObj(value)) {
    throw new Error("Invalid context-window-scaling execution artifact: expected a JSON object.");
  }
  if (value.schemaVersion !== CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION) {
    throw new Error(
      `Invalid context-window-scaling execution artifact: unsupported schemaVersion ${JSON.stringify(value.schemaVersion)}; expected ${CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION}.`
    );
  }
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(message);
  };
  const checkCorrectness = (correctness: unknown, at: string): void => {
    if (
      !isObj(correctness) ||
      !isOneOf(correctness.availability, AVAILABILITY) ||
      !isNumOrNull(correctness.score) ||
      !(correctness.pass === null || typeof correctness.pass === "boolean")
    ) {
      fail(`${at} is malformed.`);
    }
  };

  for (const field of ["runId", "pluginSchemaVersion", "startedAt", "completedAt"]) {
    if (!isStr(value[field])) fail(`${field} must be a string.`);
  }
  if (value.pluginId !== CONTEXT_WINDOW_SCALING_PLUGIN_ID) fail(`pluginId must be ${CONTEXT_WINDOW_SCALING_PLUGIN_ID}.`);
  if (!isObj(value.estimator) || !isStr(value.estimator.tokenCountMethod)) fail("estimator.tokenCountMethod must be a string.");

  let budgets: number[] = [];
  const budgetCheck = validateContextBudgets(value.contextBudgets);
  if (budgetCheck.errors.length > 0) {
    fail(`contextBudgets: ${budgetCheck.errors.join(" ")}`);
  } else if (budgetCheck.budgets.some((budget, index) => budget !== (value.contextBudgets as number[])[index])) {
    fail("contextBudgets must be in ascending order.");
  } else {
    budgets = budgetCheck.budgets;
  }

  const cases = value.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    fail("cases must be a non-empty array.");
  } else {
    cases.forEach((caseEvidence: unknown, caseIndex) => {
      const at = `cases[${caseIndex}]`;
      if (!isObj(caseEvidence)) return fail(`${at} must be an object.`);
      for (const field of ["caseId", "caseName", "benchmarkProject", "targetRoot"]) {
        if (!isStr(caseEvidence[field])) fail(`${at}.${field} must be a string.`);
      }
      if (!isStrOrNull(caseEvidence.taskLocality)) fail(`${at}.taskLocality must be a string or null.`);
      const treatments = caseEvidence.treatments;
      if (!Array.isArray(treatments)) return fail(`${at}.treatments must be an array.`);
      const ids = treatments.map((t: unknown) => (isObj(t) ? t.variantId : undefined));
      if (
        ids.length !== CONTEXT_WINDOW_SCALING_TREATMENT_IDS.length ||
        CONTEXT_WINDOW_SCALING_TREATMENT_IDS.some((id) => ids.filter((x) => x === id).length !== 1)
      ) {
        fail(`${at}.treatments must contain exactly ${CONTEXT_WINDOW_SCALING_TREATMENT_IDS.join(" and ")}.`);
      }
      treatments.forEach((treatment: unknown, treatmentIndex) => {
        const tat = `${at}.treatments[${treatmentIndex}]`;
        if (!isObj(treatment)) return fail(`${tat} must be an object.`);
        if (!isOneOf(treatment.status, RUN_STATUSES)) fail(`${tat}.status is not a known status.`);

        const context = treatment.context;
        if (!isObj(context)) {
          fail(`${tat}.context must be an object.`);
        } else {
          if (!isOneOf(context.status, AVAILABILITY)) fail(`${tat}.context.status is not a known status.`);
          if (!isCountOrNull(context.characterCount) || !isCountOrNull(context.estimatedTokens)) {
            fail(`${tat}.context counts must be nonnegative integers or null.`);
          }
          if (!isStrOrNull(context.tokenCountMethod) || !isStrOrNull(context.reason)) fail(`${tat}.context strings must be strings or null.`);
          if (!(context.observedFiles === null || isStrArray(context.observedFiles)) || !isStrArray(context.warnings)) {
            fail(`${tat}.context file/warning lists are malformed.`);
          }
          if (context.status === "available" && context.estimatedTokens === null) fail(`${tat}.context is available without estimatedTokens.`);
        }

        const evaluation = treatment.evaluation;
        if (!isObj(evaluation)) {
          fail(`${tat}.evaluation must be an object.`);
        } else {
          if (!isOneOf(evaluation.status, EVALUATION_STATUSES)) fail(`${tat}.evaluation.status is not a known status.`);
          if (!(evaluation.agentId === null || evaluation.agentId === "fake-agent")) fail(`${tat}.evaluation.agentId must be fake-agent or null.`);
          if (!isStrOrNull(evaluation.agentStatus) || !isStrOrNull(evaluation.reason)) fail(`${tat}.evaluation strings must be strings or null.`);
          if (!isCount(evaluation.evaluationCount)) fail(`${tat}.evaluation.evaluationCount must be a nonnegative integer.`);
          if (!isStrArray(evaluation.failureReasons) || !isStrArray(evaluation.warnings)) fail(`${tat}.evaluation lists must be string arrays.`);
          checkCorrectness(evaluation.correctness, `${tat}.evaluation.correctness`);
        }

        const relevant = treatment.relevantFileEvidence;
        if (!isObj(relevant)) {
          fail(`${tat}.relevantFileEvidence must be an object.`);
        } else {
          if (!isOneOf(relevant.status, RELEVANT_STATUSES)) fail(`${tat}.relevantFileEvidence.status is not a known status.`);
          if (!isStrArray(relevant.expectedRelevantFiles) || !isStrArray(relevant.omittedRelevantFiles)) {
            fail(`${tat}.relevantFileEvidence file lists must be string arrays.`);
          }
          if (!isCount(relevant.expectedRelevantFileCount)) fail(`${tat}.relevantFileEvidence.expectedRelevantFileCount must be a nonnegative integer.`);
          if (!isCountOrNull(relevant.observedExpectedFileCount) || !isCountOrNull(relevant.omittedRelevantFileCount)) {
            fail(`${tat}.relevantFileEvidence counts must be nonnegative integers or null.`);
          }
          if (!isStrOrNull(relevant.reason)) fail(`${tat}.relevantFileEvidence.reason must be a string or null.`);
        }

        const cells = treatment.budgetCells;
        if (!Array.isArray(cells)) {
          fail(`${tat}.budgetCells must be an array.`);
        } else {
          const cellBudgets = cells.map((cell: unknown) => (isObj(cell) ? cell.contextBudgetTokens : undefined));
          if (budgets.length > 0 && (cells.length !== budgets.length || budgets.some((b) => cellBudgets.filter((x) => x === b).length !== 1))) {
            fail(`${tat}.budgetCells do not match contextBudgets.`);
          }
          cells.forEach((cell: unknown, cellIndex) => {
            const cat = `${tat}.budgetCells[${cellIndex}]`;
            if (!isObj(cell)) return fail(`${cat} must be an object.`);
            if (!isOneOf(cell.contextFitStatus, FIT_STATUSES)) fail(`${cat}.contextFitStatus is not a known status.`);
            if (!isNumOrNull(cell.contextBudgetUtilizationPercent)) fail(`${cat}.contextBudgetUtilizationPercent must be a number or null.`);
            if (!isOneOf(cell.evaluationStatus, CELL_EVALUATION_STATUSES)) fail(`${cat}.evaluationStatus is not a known status.`);
            checkCorrectness(cell.correctness, `${cat}.correctness`);
            const success = cell.successEvidence;
            if (
              !isObj(success) ||
              !isOneOf(success.status, AVAILABILITY) ||
              !(success.success === null || typeof success.success === "boolean") ||
              !isOneOf(success.reason, SUCCESS_REASONS)
            ) {
              fail(`${cat}.successEvidence is malformed.`);
            }
          });
        }
        if (!Array.isArray(treatment.errors) || !treatment.errors.every((e: unknown) => isObj(e) && isStr(e.code) && isStr(e.message))) {
          fail(`${tat}.errors must be an array of { code, message }.`);
        }
      });
    });
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
    const extra = problems.length - shown.length;
    throw new Error(
      `Invalid context-window-scaling execution artifact: ${shown.join(" ")}${extra > 0 ? ` (${extra} more problem(s) omitted.)` : ""}`
    );
  }
  return value as unknown as ContextWindowScalingExecutionArtifactV1;
}
