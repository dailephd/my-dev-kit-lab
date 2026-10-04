import { normalizeRetrievedRepositoryPath } from "./buildRetrievalEvidence.js";
import { hasFactMapping, interpretFactContextTarget } from "./factContextTargets.js";
import type { EvaluationCaseInput } from "../types.js";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

function normalizedSet(values: unknown, normalize: (value: unknown) => string | null): Set<string> | undefined {
  if (!Array.isArray(values)) return undefined;
  const result = new Set<string>();
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized === null) return undefined;
    result.add(normalized);
  }
  return result;
}

const plainString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/**
 * Ground-truth completeness for one retrieval-precision-recall case. Returns bounded error strings that never
 * echo unsafe values. This rule set applies only to corpora that opt into retrieval-precision-recall; it is not
 * a global answer-key rule.
 */
export function validateRetrievalPrecisionRecallCase(evaluationCase: Pick<EvaluationCaseInput, "id" | "expectedFiles" | "expectedSymbols" | "answerKey">): string[] {
  const label = `retrieval-precision-recall case ${typeof evaluationCase.id === "string" ? evaluationCase.id : "<unknown>"}`;
  const answerKey = asRecord(evaluationCase.answerKey);
  if (!answerKey) return [`${label}: answerKey is required.`];

  const errors: string[] = [];
  const expectedFiles = normalizedSet(answerKey.expectedFiles, normalizeRetrievedRepositoryPath);
  const expectedSymbols = normalizedSet(answerKey.expectedSymbols, plainString);
  if (expectedFiles === undefined || expectedFiles.size === 0) errors.push(`${label}: answerKey.expectedFiles must be a nonempty array of safe repository-relative paths.`);
  if (expectedSymbols === undefined || expectedSymbols.size === 0) errors.push(`${label}: answerKey.expectedSymbols must be a nonempty array of nonempty strings.`);

  const topFiles = normalizedSet(evaluationCase.expectedFiles, normalizeRetrievedRepositoryPath);
  const topSymbols = normalizedSet(evaluationCase.expectedSymbols, plainString);
  const sameSet = (left: Set<string> | undefined, right: Set<string> | undefined) =>
    left !== undefined && right !== undefined && left.size === right.size && [...left].every((value) => right.has(value));
  if (expectedFiles !== undefined && !sameSet(topFiles, expectedFiles)) errors.push(`${label}: expectedFiles must agree with answerKey.expectedFiles.`);
  if (expectedSymbols !== undefined && !sameSet(topSymbols, expectedSymbols)) errors.push(`${label}: expectedSymbols must agree with answerKey.expectedSymbols.`);

  const facts = answerKey.expectedFacts;
  const factIds: string[] = [];
  if (!Array.isArray(facts) || facts.length === 0) {
    errors.push(`${label}: answerKey.expectedFacts must be a nonempty array.`);
  } else {
    for (const fact of facts) {
      const id = asRecord(fact)?.id;
      if (typeof id !== "string" || id.length === 0 || factIds.includes(id)) {
        errors.push(`${label}: answerKey.expectedFacts must have unique nonempty ids.`);
        break;
      }
      factIds.push(id);
    }
  }

  const targets = answerKey.expectedContextTargets;
  if (!Array.isArray(targets) || targets.length === 0) {
    errors.push(`${label}: answerKey.expectedContextTargets is required for fact coverage.`);
    return errors;
  }
  const known = new Set(factIds);
  const requiredMappedFacts = new Set<string>();
  targets.forEach((target, index) => {
    const targetLabel = `${label}: answerKey.expectedContextTargets[${index}]`;
    const record = asRecord(target);
    if (!record) {
      errors.push(`${targetLabel}: target must be an object.`);
      return;
    }
    if (hasFactMapping(target)) {
      const interpretation = interpretFactContextTarget(target, known);
      if (!interpretation.ok) {
        errors.push(`${targetLabel}: ${interpretation.problem}.`);
        return;
      }
      if (interpretation.target.required) interpretation.target.factIds.forEach((id) => requiredMappedFacts.add(id));
    }
    // No hidden expectation outside the answer key, mapped or not.
    const file = normalizeRetrievedRepositoryPath(record.file);
    if (file === null) {
      errors.push(`${targetLabel}: file must be a safe repository-relative path.`);
    } else if (expectedFiles !== undefined && !expectedFiles.has(file)) {
      errors.push(`${targetLabel}: file must be listed in answerKey.expectedFiles.`);
    }
    if (Array.isArray(record.symbols) && expectedSymbols !== undefined) {
      for (const symbol of record.symbols) {
        if (typeof symbol !== "string" || !expectedSymbols.has(symbol)) {
          errors.push(`${targetLabel}: every symbol must be listed in answerKey.expectedSymbols.`);
          break;
        }
      }
    }
  });
  for (const id of factIds) {
    if (!requiredMappedFacts.has(id)) errors.push(`${label}: expected fact ${id} has no required fact-mapped context target.`);
  }
  return errors;
}

/** Validates every case of a production retrieval-precision-recall corpus; case ids must be unique. */
export function validateRetrievalPrecisionRecallCorpus(cases: readonly Pick<EvaluationCaseInput, "id" | "expectedFiles" | "expectedSymbols" | "answerKey">[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const evaluationCase of cases) {
    if (seen.has(evaluationCase.id)) errors.push(`retrieval-precision-recall corpus: duplicate case id ${evaluationCase.id}.`);
    seen.add(evaluationCase.id);
    errors.push(...validateRetrievalPrecisionRecallCase(evaluationCase));
  }
  return errors;
}

/**
 * Per-case issue counts without any identity text. Use this, never the detailed messages, when reporting about an
 * external private subject: the detailed messages may name expected facts.
 */
export function summarizeRetrievalGroundTruthIssuesSafely(
  cases: readonly Pick<EvaluationCaseInput, "id" | "expectedFiles" | "expectedSymbols" | "answerKey">[]
): { caseId: string; issueCount: number }[] {
  return cases
    .map((evaluationCase) => ({ caseId: evaluationCase.id, issueCount: validateRetrievalPrecisionRecallCase(evaluationCase).length }))
    .filter((entry) => entry.issueCount > 0);
}
