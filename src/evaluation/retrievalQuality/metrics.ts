import { compareCodeUnits } from "../indexSnapshot.js";
import type { EvaluationCaseInput } from "../types.js";
import { normalizeRetrievedRepositoryPath } from "./buildRetrievalEvidence.js";
import { hasFactMapping, interpretFactContextTarget, type InterpretedFactContextTarget } from "./factContextTargets.js";
import type {
  RetrievalEvidenceAvailability,
  RetrievalEvidenceV1,
  RetrievalQualityExpectationStatusV1,
  RetrievalQualityMetricsV1,
  RetrievalQualityRatioMetricV1
} from "./types.js";

export type CalculateRetrievalQualityMetricsInput = {
  evaluationCase: Pick<EvaluationCaseInput, "id" | "expectedFiles" | "expectedSymbols" | "answerKey">;
  retrieval: {
    retrievalEvidence?: RetrievalEvidenceV1;
    totalEstimatedTokens: number;
    tokenCountMethod: string;
  };
};

/** Already-normalized file/symbol identities; carries no command provenance and no strategy meaning. */
export type RetrievalQualityIdentityEvidence = {
  availability: RetrievalEvidenceAvailability;
  availabilityReason?: string;
  files: readonly string[];
  symbols: readonly { name: string; file?: string }[];
};

export type CalculateRetrievalQualityMetricsFromIdentityEvidenceInput = {
  evaluationCase: Pick<EvaluationCaseInput, "id" | "expectedFiles" | "expectedSymbols" | "answerKey">;
  retrieval: {
    identityEvidence?: RetrievalQualityIdentityEvidence;
    totalEstimatedTokens: number;
    tokenCountMethod: string;
  };
};

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort(compareCodeUnits);

function ratio(numerator: number, denominator: number, notApplicableReason: string): RetrievalQualityRatioMetricV1 {
  if (denominator === 0) {
    return { availability: "not-applicable", numerator: null, denominator: null, value: null, reason: notApplicableReason };
  }
  return { availability: "available", numerator, denominator, value: numerator / denominator, reason: null };
}

function unavailableRatio(reason: string): RetrievalQualityRatioMetricV1 {
  return { availability: "unavailable", numerator: null, denominator: null, value: null, reason };
}

type ResolvedExpectation = { ok: true; values: string[] } | { ok: false; reason: string };

function normalizeExpectedFiles(values: unknown): ResolvedExpectation {
  if (!Array.isArray(values)) return { ok: false, reason: "expected-files-missing" };
  const normalized: string[] = [];
  for (const value of values) {
    const path = normalizeRetrievedRepositoryPath(value);
    if (path === null) return { ok: false, reason: "unsafe-expected-file-identity" };
    normalized.push(path);
  }
  return { ok: true, values: sortedUnique(normalized) };
}

function normalizeExpectedSymbols(values: unknown): ResolvedExpectation {
  if (!Array.isArray(values)) return { ok: false, reason: "expected-symbols-missing" };
  if (values.some((value) => typeof value !== "string" || value.length === 0)) return { ok: false, reason: "invalid-expected-symbol" };
  return { ok: true, values: sortedUnique(values as string[]) };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * The answer key is the semantic source of relevance. A top-level expectation that is also present must agree
 * with it after normalization; disagreement is never silently reconciled.
 */
function resolveExpectation(
  topLevel: unknown,
  answerKeyValues: unknown,
  hasAnswerKey: boolean,
  normalize: (values: unknown) => ResolvedExpectation,
  mismatchReason: string
): ResolvedExpectation {
  if (!hasAnswerKey) return normalize(topLevel);
  const fromKey = normalize(answerKeyValues);
  if (!fromKey.ok) return fromKey;
  if (Array.isArray(topLevel)) {
    const fromTop = normalize(topLevel);
    if (!fromTop.ok) return fromTop;
    if (!sameSet(fromTop.values, fromKey.values)) return { ok: false, reason: mismatchReason };
  }
  return fromKey;
}

const expectationStatus = (resolved: ResolvedExpectation): RetrievalQualityExpectationStatusV1 =>
  resolved.ok ? { availability: "available", reason: null } : { availability: "unavailable", reason: resolved.reason };

type FactCoverageOutcome =
  | { kind: "unavailable"; reason: string }
  | { kind: "not-applicable"; reason: string }
  | { kind: "computed"; covered: string[]; uncovered: string[]; total: number };

/** Symbol name -> normalized files it was retrieved from. Symbols without file identity cannot satisfy a file-specific target. */
function symbolFilesByName(evidence: RetrievalQualityIdentityEvidence): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>();
  for (const symbol of evidence.symbols) {
    if (symbol.file === undefined) continue;
    const files = byName.get(symbol.name) ?? new Set<string>();
    files.add(symbol.file);
    byName.set(symbol.name, files);
  }
  return byName;
}

function calculateFactCoverage(answerKey: EvaluationCaseInput["answerKey"], evidence: RetrievalQualityIdentityEvidence, retrievedFiles: ReadonlySet<string>): FactCoverageOutcome {
  if (!answerKey || typeof answerKey !== "object") return { kind: "unavailable", reason: "answer-key-missing" };
  const facts: unknown = answerKey.expectedFacts;
  if (!Array.isArray(facts)) return { kind: "unavailable", reason: "expected-facts-invalid" };
  const factIds: string[] = [];
  for (const fact of facts) {
    const id = typeof fact === "object" && fact !== null ? (fact as { id?: unknown }).id : undefined;
    if (typeof id !== "string" || id.length === 0 || factIds.includes(id)) {
      return { kind: "unavailable", reason: "expected-facts-invalid" };
    }
    factIds.push(id);
  }
  if (factIds.length === 0) return { kind: "not-applicable", reason: "no-expected-facts" };

  const targets: unknown = answerKey.expectedContextTargets;
  if (!Array.isArray(targets)) return { kind: "unavailable", reason: "fact-context-mapping-unavailable" };

  const known = new Set(factIds);
  const targetsByFact = new Map<string, InterpretedFactContextTarget[]>(factIds.map((id) => [id, []]));
  for (const target of targets) {
    if (!hasFactMapping(target)) continue;
    const required = (target as { required?: unknown }).required !== false;
    const interpretation = interpretFactContextTarget(target, known);
    if (!interpretation.ok) {
      // An invalid optional target cannot gate coverage; an invalid required one makes the mapping untrustworthy.
      if (required) return { kind: "unavailable", reason: "fact-context-mapping-invalid" };
      continue;
    }
    if (!interpretation.target.required) continue;
    for (const id of interpretation.target.factIds) targetsByFact.get(id)?.push(interpretation.target);
  }
  if (factIds.some((id) => (targetsByFact.get(id) ?? []).length === 0)) {
    return { kind: "unavailable", reason: "fact-context-mapping-unavailable" };
  }

  const symbolFiles = symbolFilesByName(evidence);
  const isCovered = (target: InterpretedFactContextTarget): boolean =>
    retrievedFiles.has(target.file) && target.symbols.every((symbol) => symbolFiles.get(symbol)?.has(target.file) === true);
  const covered = factIds.filter((id) => (targetsByFact.get(id) ?? []).every(isCovered));
  const coveredSet = new Set(covered);
  return {
    kind: "computed",
    covered: sortedUnique(covered),
    uncovered: sortedUnique(factIds.filter((id) => !coveredSet.has(id))),
    total: factIds.length
  };
}

function evidenceReason(evidence: RetrievalQualityIdentityEvidence | undefined): string | null {
  if (evidence === undefined) return "retrieval-evidence-missing";
  if (evidence.availability === "partial") return "retrieval-evidence-partial";
  if (evidence.availability === "unavailable") return "retrieval-evidence-unavailable";
  return null;
}

/**
 * Pure per-case retrieval-quality calculation. Formulas are planner-frozen:
 * file precision = |R_file ∩ E_file| / |R_file|; file recall = |R_file ∩ E_file| / |E_file|;
 * irrelevant context ratio = |R_file - E_file| / |R_file|; symbol precision/recall use the same set formulas
 * over exact unique symbol names; fact coverage = covered facts / expected facts, unweighted and derived only
 * from explicit `factIds` target mappings. No input is mutated and nothing is read from disk or text.
 * Unavailable or not-applicable results are never converted to zero.
 */
export function calculateRetrievalQualityMetrics(input: CalculateRetrievalQualityMetricsInput): RetrievalQualityMetricsV1 {
  const evidence = input.retrieval.retrievalEvidence;
  return calculateRetrievalQualityMetricsFromIdentityEvidence({
    evaluationCase: input.evaluationCase,
    retrieval: {
      identityEvidence:
        evidence === undefined
          ? undefined
          : {
              availability: evidence.availability,
              ...(evidence.availabilityReason !== undefined ? { availabilityReason: evidence.availabilityReason } : {}),
              files: evidence.files.map((file) => file.path),
              symbols: evidence.symbols.map((symbol) => ({
                name: symbol.name,
                ...(symbol.file !== undefined ? { file: symbol.file } : {})
              }))
            },
      totalEstimatedTokens: input.retrieval.totalEstimatedTokens,
      tokenCountMethod: input.retrieval.tokenCountMethod
    }
  });
}

/**
 * Single mathematical owner for retrieval-quality calculation. Applies the v0.8.0 formulas and availability
 * semantics to already-normalized identity evidence, so any evidence contract can be scored identically.
 */
export function calculateRetrievalQualityMetricsFromIdentityEvidence(
  input: CalculateRetrievalQualityMetricsFromIdentityEvidenceInput
): RetrievalQualityMetricsV1 {
  const { evaluationCase, retrieval } = input;
  const evidence = retrieval.identityEvidence;
  const evidenceBlocked = evidenceReason(evidence);
  const answerKey = evaluationCase.answerKey;
  const hasAnswerKey = answerKey !== undefined && answerKey !== null && typeof answerKey === "object";

  const expectedFiles = resolveExpectation(
    evaluationCase.expectedFiles,
    hasAnswerKey ? answerKey.expectedFiles : undefined,
    hasAnswerKey,
    normalizeExpectedFiles,
    "expected-files-answer-key-mismatch"
  );
  const expectedSymbols = resolveExpectation(
    evaluationCase.expectedSymbols,
    hasAnswerKey ? answerKey.expectedSymbols : undefined,
    hasAnswerKey,
    normalizeExpectedSymbols,
    "expected-symbols-answer-key-mismatch"
  );

  const usable = evidenceBlocked === null && evidence !== undefined ? evidence : undefined;
  const retrievedFiles = usable ? sortedUnique(usable.files) : undefined;
  const retrievedSymbols = usable ? sortedUnique(usable.symbols.map((symbol) => symbol.name)) : undefined;

  // ---- files
  let file: RetrievalQualityMetricsV1["file"] = {
    relevantRetrievedFiles: null,
    irrelevantRetrievedFiles: null,
    missedFiles: null,
    missedFileCount: null,
    precision: unavailableRatio(evidenceBlocked ?? (expectedFiles.ok ? "unavailable" : expectedFiles.reason)),
    recall: unavailableRatio(evidenceBlocked ?? (expectedFiles.ok ? "unavailable" : expectedFiles.reason))
  };
  let irrelevantContextRatio = unavailableRatio(evidenceBlocked ?? (expectedFiles.ok ? "unavailable" : expectedFiles.reason));
  if (retrievedFiles !== undefined && expectedFiles.ok) {
    const expected = new Set(expectedFiles.values);
    const retrieved = new Set(retrievedFiles);
    const relevant = retrievedFiles.filter((path) => expected.has(path));
    const irrelevant = retrievedFiles.filter((path) => !expected.has(path));
    const missed = expectedFiles.values.filter((path) => !retrieved.has(path));
    file = {
      relevantRetrievedFiles: relevant,
      irrelevantRetrievedFiles: irrelevant,
      missedFiles: missed,
      missedFileCount: missed.length,
      precision: ratio(relevant.length, retrievedFiles.length, "no-retrieved-files"),
      recall: ratio(relevant.length, expectedFiles.values.length, "no-expected-files")
    };
    irrelevantContextRatio = ratio(irrelevant.length, retrievedFiles.length, "no-retrieved-files");
  }

  // ---- symbols (exact unique names)
  let symbol: RetrievalQualityMetricsV1["symbol"] = {
    relevantRetrievedSymbols: null,
    irrelevantRetrievedSymbols: null,
    missedSymbols: null,
    missedSymbolCount: null,
    precision: unavailableRatio(evidenceBlocked ?? (expectedSymbols.ok ? "unavailable" : expectedSymbols.reason)),
    recall: unavailableRatio(evidenceBlocked ?? (expectedSymbols.ok ? "unavailable" : expectedSymbols.reason))
  };
  if (retrievedSymbols !== undefined && expectedSymbols.ok) {
    const expected = new Set(expectedSymbols.values);
    const retrieved = new Set(retrievedSymbols);
    const relevant = retrievedSymbols.filter((name) => expected.has(name));
    const missed = expectedSymbols.values.filter((name) => !retrieved.has(name));
    symbol = {
      relevantRetrievedSymbols: relevant,
      irrelevantRetrievedSymbols: retrievedSymbols.filter((name) => !expected.has(name)),
      missedSymbols: missed,
      missedSymbolCount: missed.length,
      precision: ratio(relevant.length, retrievedSymbols.length, "no-retrieved-symbols"),
      recall: ratio(relevant.length, expectedSymbols.values.length, "no-expected-symbols")
    };
  }

  // ---- facts
  let fact: RetrievalQualityMetricsV1["fact"] = {
    coveredFactIds: null,
    uncoveredFactIds: null,
    uncoveredFactCount: null,
    coverage: unavailableRatio(evidenceBlocked ?? "unavailable")
  };
  if (usable !== undefined && retrievedFiles !== undefined) {
    const outcome = calculateFactCoverage(answerKey, usable, new Set(retrievedFiles));
    if (outcome.kind === "computed") {
      fact = {
        coveredFactIds: outcome.covered,
        uncoveredFactIds: outcome.uncovered,
        uncoveredFactCount: outcome.uncovered.length,
        coverage: ratio(outcome.covered.length, outcome.total, "no-expected-facts")
      };
    } else {
      fact = { ...fact, coverage: outcome.kind === "unavailable" ? unavailableRatio(outcome.reason) : { availability: "not-applicable", numerator: null, denominator: null, value: null, reason: outcome.reason } };
    }
  }

  const tokensValid = typeof retrieval.totalEstimatedTokens === "number" && Number.isFinite(retrieval.totalEstimatedTokens) && retrieval.totalEstimatedTokens >= 0;
  return {
    schemaVersion: "retrieval-quality-metrics-v1",
    caseId: evaluationCase.id,
    evidence: {
      availability: evidence === undefined ? "missing" : evidence.availability,
      reason: evidence === undefined ? "retrieval-evidence-missing" : (evidence.availabilityReason ?? null)
    },
    expectations: { files: expectationStatus(expectedFiles), symbols: expectationStatus(expectedSymbols) },
    file,
    symbol,
    fact,
    irrelevantContextRatio,
    retrievedTokenCount: tokensValid ? retrieval.totalEstimatedTokens : null,
    tokenCountMethod: tokensValid && typeof retrieval.tokenCountMethod === "string" ? retrieval.tokenCountMethod : null
  };
}
