import path from "node:path";
import {
  calculateProjectComplexityScore,
  computeProjectComplexityMetrics,
  PROJECT_COMPLEXITY_FORMULA,
} from "../../../evaluation/projectComplexity.js";
import { buildProjectFileTree } from "../../../evaluation/projectFileTree.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../evaluation/types.js";

/**
 * The fixed scaling project has no entry in the shared benchmark-project-profiles contract. The
 * existing prompt owner requires a profile per case, so a missing one is derived in memory from
 * the existing file-tree and complexity owners. Supplied profiles always win; nothing is written.
 */
export type ScalingProjectProfileOptions = {
  /**
   * Repository-relative regular files that are the only files the derived profiles may list or open (a local
   * subject's Batch 1 eligible files). Absent for bundled and synthetic subjects, which keep the legacy walk.
   */
  eligibleFiles?: readonly string[];
};

export function resolveScalingProjectProfiles(
  cases: readonly EvaluationCase[],
  supplied: readonly BenchmarkProjectProfile[],
  options: ScalingProjectProfileOptions = {}
): BenchmarkProjectProfile[] {
  const profiles = [...supplied];
  const known = new Set(profiles.map((profile) => profile.projectId));
  for (const evaluationCase of cases) {
    const profileId = evaluationCase.projectProfileRef ?? evaluationCase.benchmarkProject;
    if (known.has(profileId)) continue;
    known.add(profileId);
    profiles.push(deriveProfile(profileId, evaluationCase, cases, options));
  }
  return profiles;
}

function deriveProfile(
  profileId: string,
  evaluationCase: EvaluationCase,
  cases: readonly EvaluationCase[],
  options: ScalingProjectProfileOptions
): BenchmarkProjectProfile {
  const siblings = cases.filter((candidate) => (candidate.projectProfileRef ?? candidate.benchmarkProject) === profileId);
  const fileTree = buildProjectFileTree(
    evaluationCase.absoluteTargetRoot,
    options.eligibleFiles === undefined ? {} : { allowedRelativeFiles: options.eligibleFiles }
  );
  const average = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
  const complexityMetrics = computeProjectComplexityMetrics(evaluationCase.absoluteTargetRoot, fileTree, {
    taskCount: siblings.length,
    expectedRelevantFilesAverage: average(siblings.map((candidate) => candidate.expectedFiles.length)),
    expectedRelevantSymbolsAverage: average(siblings.map((candidate) => candidate.expectedSymbols.length)),
  });
  const languages = [
    ...new Set(fileTree.entries.map((entry) => entry.language).filter((language): language is string => Boolean(language))),
  ].sort();
  return {
    projectId: profileId,
    displayName: profileId,
    description: "Profile derived in memory for the context-window-scaling fixed corpus.",
    languageMix: languages.length <= 1 ? `single-language ${languages[0] ?? "unknown"}` : "multi-language",
    primaryLanguage: languages[0] ?? "unknown",
    languages,
    complexityLevel: "large",
    complexityScore: calculateProjectComplexityScore(complexityMetrics),
    complexityMetrics,
    complexityFormula: PROJECT_COMPLEXITY_FORMULA,
    rootPath: path.posix.normalize(evaluationCase.targetRoot.replace(/\\/g, "/")),
    sourceRoots: [...evaluationCase.sourceRoots],
    testRoots: ["tests"],
    fileTree,
    benchmarkPurpose: "Context-window scaling evaluation.",
    expectedUseCases: ["context budget fit evaluation"],
  };
}
