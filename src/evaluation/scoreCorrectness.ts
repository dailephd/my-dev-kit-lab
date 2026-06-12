import type { BenchmarkTaskAnswerKey } from "./types.js";
import type { CorrectnessScore, ExperimentRunStatus, ParsedAgentAnswer } from "./controlledExperimentTypes.js";

export const CORRECTNESS_FORMULA =
  "correctnessScore = 0.25 * fileMatchScore + 0.25 * symbolMatchScore + 0.50 * factMatchScore; empty file or symbol categories are neutral at 1.0.";

export function scoreCorrectness(args: {
  caseId: string;
  answerKey: BenchmarkTaskAnswerKey;
  parsedAnswer: ParsedAgentAnswer;
  status?: ExperimentRunStatus;
}): CorrectnessScore {
  const failureReasons: string[] = [];
  if (args.status && args.status !== "completed" && args.status !== "invalid-output") {
    failureReasons.push(statusFailureReason(args.status));
  }
  if (args.parsedAnswer.parseStatus === "failed") {
    failureReasons.push("invalid output");
  }

  const expectedFilesFound = countMatches(args.answerKey.expectedFiles, args.parsedAnswer.relevantFiles);
  const expectedSymbolsFound = countMatches(args.answerKey.expectedSymbols, args.parsedAnswer.relevantSymbols);
  const factMatches = matchFacts(args.answerKey, args.parsedAnswer.expectedFactsFound, args.parsedAnswer.answerText);
  const requiredFactsTotal = args.answerKey.expectedFacts.filter((fact) => fact.required).length;
  const requiredFactsFound = factMatches.filter((fact) => fact.required).length;
  const optionalFactsTotal = args.answerKey.expectedFacts.length - requiredFactsTotal;
  const optionalFactsFound = factMatches.filter((fact) => !fact.required).length;

  const fileMatchScore = categoryScore(expectedFilesFound, args.answerKey.expectedFiles.length);
  const symbolMatchScore = categoryScore(expectedSymbolsFound, args.answerKey.expectedSymbols.length);
  const factMatchScore = weightedFactScore(args.answerKey, factMatches.map((fact) => fact.id));
  const correctnessScore = round(0.25 * fileMatchScore + 0.25 * symbolMatchScore + 0.5 * factMatchScore);
  const foundFactCount = factMatches.length;

  for (const fact of args.answerKey.expectedFacts.filter((fact) => fact.required)) {
    if (!factMatches.some((match) => match.id === fact.id)) {
      failureReasons.push(`missing required fact: ${fact.id}`);
    }
  }
  if (foundFactCount < args.answerKey.minimumCorrectFacts) {
    failureReasons.push(`too few facts found: ${foundFactCount}/${args.answerKey.minimumCorrectFacts}`);
  }
  if (args.answerKey.expectedFiles.length > 0 && expectedFilesFound < args.answerKey.expectedFiles.length) {
    failureReasons.push("missing expected file");
  }
  if (args.answerKey.expectedSymbols.length > 0 && expectedSymbolsFound < args.answerKey.expectedSymbols.length) {
    failureReasons.push("missing expected symbol");
  }
  if (correctnessScore < 0.7) {
    failureReasons.push("score below threshold");
  }

  const passed =
    failureReasons.length === 0 &&
    requiredFactsFound === requiredFactsTotal &&
    foundFactCount >= args.answerKey.minimumCorrectFacts &&
    correctnessScore >= 0.7;

  return {
    caseId: args.caseId,
    fileMatchScore,
    symbolMatchScore,
    factMatchScore,
    correctnessScore,
    requiredFactsFound,
    requiredFactsTotal,
    optionalFactsFound,
    optionalFactsTotal,
    expectedFilesFound,
    expectedFilesTotal: args.answerKey.expectedFiles.length,
    expectedSymbolsFound,
    expectedSymbolsTotal: args.answerKey.expectedSymbols.length,
    passed,
    failureReasons: unique(failureReasons),
    formula: CORRECTNESS_FORMULA
  };
}

function statusFailureReason(status: ExperimentRunStatus): string {
  if (status === "agent-limit-reached") return "agent limit reached";
  if (status === "agent-unavailable") return "agent unavailable";
  if (status === "timeout") return "timeout";
  if (status === "failed") return "agent run failed";
  if (status === "skipped") return "agent run skipped";
  if (status === "invalid-output") return "invalid output";
  return status;
}

function countMatches(expected: string[], actual: string[]): number {
  return expected.filter((item) => {
    const expectedNormalized = normalize(item);
    const expectedPath = normalizePath(item);
    return actual.some((candidate) => {
      const actualNormalized = normalize(candidate);
      const actualPath = normalizePath(candidate);
      return (
        actualNormalized === expectedNormalized ||
        actualNormalized.includes(expectedNormalized) ||
        expectedNormalized.includes(actualNormalized) ||
        actualPath === expectedPath ||
        actualPath.endsWith(`/${expectedPath}`) ||
        expectedPath.endsWith(`/${actualPath}`)
      );
    });
  }).length;
}

function matchFacts(answerKey: BenchmarkTaskAnswerKey, expectedFactsFound: string[], answerText: string) {
  const found = new Set(expectedFactsFound.map(normalize));
  const normalizedAnswer = normalize(answerText);
  return answerKey.expectedFacts.filter((fact) => {
    const factId = normalize(fact.id);
    const factText = normalize(fact.text);
    return found.has(factId) || found.has(factText) || normalizedAnswer.includes(factId) || normalizedAnswer.includes(factText);
  });
}

function weightedFactScore(answerKey: BenchmarkTaskAnswerKey, factIds: string[]): number {
  if (answerKey.expectedFacts.length === 0) {
    return 1;
  }
  const found = new Set(factIds);
  const totalWeight = answerKey.expectedFacts.reduce((sum, fact) => sum + fact.weight, 0);
  if (totalWeight === 0) {
    return 1;
  }
  return round(answerKey.expectedFacts.filter((fact) => found.has(fact.id)).reduce((sum, fact) => sum + fact.weight, 0) / totalWeight);
}

function categoryScore(found: number, total: number): number {
  return total === 0 ? 1 : round(found / total);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePath(value: string): string {
  return value.toLowerCase().replace(/\\/g, "/").replace(/^\.?\//, "").trim();
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
