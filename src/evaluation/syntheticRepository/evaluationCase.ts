import { describeSyntheticTask } from "./layout.js";
import type { SyntheticRepositoryManifestV1 } from "./manifest.js";
import type { SyntheticRepositoryPlanV1 } from "./types.js";
import type { BenchmarkTaskAnswerKey, EvaluationCase } from "../types.js";

/** The plan's answer key expressed in the existing benchmark answer-key vocabulary (no second correctness contract). */
export function buildSyntheticAnswerKey(plan: SyntheticRepositoryPlanV1): BenchmarkTaskAnswerKey {
  const { factTextById } = describeSyntheticTask(plan);
  return {
    expectedFiles: [...plan.answerKey.expectedFiles],
    expectedSymbols: [...plan.answerKey.expectedSymbols],
    expectedFacts: plan.answerKey.facts.map((fact) => ({
      id: fact.factId,
      text: factTextById.get(fact.factId) as string,
      weight: fact.weight,
      required: fact.required,
    })),
    expectedContextTargets: plan.answerKey.expectedContextTargets.map((target) => ({
      file: target.file,
      symbols: [...target.symbols],
      required: target.required,
    })),
    minimumCorrectFacts: plan.answerKey.minimumCorrectFacts,
  };
}

/**
 * Builds the existing EvaluationCase directly in memory (never through readEvaluationCases, which owns
 * repository-contained JSON cases). `targetRoot` is the stable logical root from the manifest; only
 * `absoluteTargetRoot` carries the physical generated repository directory.
 */
export function buildSyntheticEvaluationCase(
  plan: SyntheticRepositoryPlanV1,
  manifest: SyntheticRepositoryManifestV1,
  repositoryRoot: string
): EvaluationCase {
  const text = describeSyntheticTask(plan);
  return {
    id: plan.task.taskId,
    title: text.title,
    benchmarkProject: plan.logicalProjectId,
    targetRoot: manifest.logicalTargetRoot,
    sourceRoots: [...manifest.sourceRoots],
    query: text.query,
    expectedFiles: [...plan.answerKey.expectedFiles],
    expectedSymbols: [...plan.answerKey.expectedSymbols],
    rawIncludeGlobs: [...manifest.rawIncludeGlobs],
    answerKey: buildSyntheticAnswerKey(plan),
    taskLocality: plan.task.locality,
    absoluteTargetRoot: repositoryRoot,
  };
}
