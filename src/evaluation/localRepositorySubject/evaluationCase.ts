import type { EvaluationCase } from "../types.js";
import { logicalTargetRootForSubject } from "./types.js";
import type { LocalRepositorySubjectConfigV1 } from "./types.js";

/**
 * Adapts a validated local-subject config to existing EvaluationCase objects in memory. The logical targetRoot is
 * the durable identity; absoluteTargetRoot is the only place the physical repository path appears.
 */
export function buildLocalRepositorySubjectEvaluationCases(
  config: LocalRepositorySubjectConfigV1,
  repositoryRoot: string
): EvaluationCase[] {
  const targetRoot = logicalTargetRootForSubject(config.subjectId);
  return config.cases.map((subjectCase) => {
    const evaluationCase: EvaluationCase = {
      id: subjectCase.id,
      title: subjectCase.title,
      benchmarkProject: config.subjectId,
      targetRoot,
      sourceRoots: [...subjectCase.sourceRoots],
      query: subjectCase.query,
      expectedFiles: [...subjectCase.expectedFiles],
      expectedSymbols: [...subjectCase.expectedSymbols],
      rawIncludeGlobs: [...subjectCase.rawIncludeGlobs],
      absoluteTargetRoot: repositoryRoot,
    };
    if (subjectCase.answerKey !== undefined) evaluationCase.answerKey = structuredClone(subjectCase.answerKey);
    if (subjectCase.expectedFacts !== undefined) evaluationCase.expectedFacts = structuredClone(subjectCase.expectedFacts);
    if (subjectCase.taskLocality !== undefined) evaluationCase.taskLocality = subjectCase.taskLocality;
    if (subjectCase.promptComplexityHint !== undefined) evaluationCase.promptComplexityHint = subjectCase.promptComplexityHint;
    if (subjectCase.projectComplexityRelevance !== undefined) {
      evaluationCase.projectComplexityRelevance = subjectCase.projectComplexityRelevance;
    }
    if (subjectCase.notes !== undefined) evaluationCase.notes = subjectCase.notes;
    return evaluationCase;
  });
}
