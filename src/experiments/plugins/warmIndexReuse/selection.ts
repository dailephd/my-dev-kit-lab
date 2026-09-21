import path from "node:path";
import type { EvaluationCase } from "../../../evaluation/types.js";
import { sanitizePathSegment } from "../../outputPaths.js";

export type WarmIndexProjectGroup = {
  benchmarkProject: string;
  /** Output path segment for this project; always contains the sanitized project ID. */
  projectSegment: string;
  targetRoot: string;
  sourceRoots: readonly string[];
  cases: EvaluationCase[];
  /** Structural errors (disagreeing target/source roots). A group with errors must not be indexed. */
  structuralErrors: string[];
};

/**
 * Keeps source case order, applies case-ID then benchmark-project filters, and fails clearly for
 * unknown requested IDs or an empty selection.
 */
export function selectWarmIndexCases(
  cases: readonly EvaluationCase[],
  filters: { caseIds?: readonly string[]; benchmarkProjects?: readonly string[] }
): EvaluationCase[] {
  const knownCaseIds = new Set(cases.map((evaluationCase) => evaluationCase.id));
  const missingCases = (filters.caseIds ?? []).filter((caseId) => !knownCaseIds.has(caseId));
  if (missingCases.length > 0) {
    throw new Error(`Evaluation case not found: ${missingCases.join(", ")}`);
  }
  const knownProjects = new Set(cases.map((evaluationCase) => evaluationCase.benchmarkProject));
  const missingProjects = (filters.benchmarkProjects ?? []).filter((project) => !knownProjects.has(project));
  if (missingProjects.length > 0) {
    throw new Error(`Benchmark project not found: ${missingProjects.join(", ")}`);
  }

  const selected = cases
    .filter((evaluationCase) => !filters.caseIds?.length || filters.caseIds.includes(evaluationCase.id))
    .filter(
      (evaluationCase) =>
        !filters.benchmarkProjects?.length || filters.benchmarkProjects.includes(evaluationCase.benchmarkProject)
    );
  if (selected.length === 0) {
    throw new Error(
      `No evaluation cases matched the requested filters (cases: ${(filters.caseIds ?? []).join(", ") || "any"}; ` +
        `benchmark projects: ${(filters.benchmarkProjects ?? []).join(", ") || "any"}).`
    );
  }
  return selected;
}

/**
 * Groups cases by benchmarkProject in first-seen order, keeping task order within a group. Cases
 * that share a project but disagree on target root or ordered source roots make the group
 * structurally invalid rather than silently picking one configuration.
 */
export function groupWarmIndexCases(cases: readonly EvaluationCase[]): WarmIndexProjectGroup[] {
  const groups = new Map<string, WarmIndexProjectGroup>();
  for (const evaluationCase of cases) {
    let group = groups.get(evaluationCase.benchmarkProject);
    if (!group) {
      group = {
        benchmarkProject: evaluationCase.benchmarkProject,
        projectSegment: safeOutputSegment(evaluationCase.benchmarkProject, "benchmark project"),
        targetRoot: evaluationCase.absoluteTargetRoot,
        sourceRoots: Object.freeze([...evaluationCase.sourceRoots]),
        cases: [],
        structuralErrors: [],
      };
      groups.set(evaluationCase.benchmarkProject, group);
    } else {
      if (path.resolve(group.targetRoot) !== path.resolve(evaluationCase.absoluteTargetRoot)) {
        group.structuralErrors.push(
          `Case ${evaluationCase.id} target root ${evaluationCase.absoluteTargetRoot} differs from ${group.targetRoot} for benchmark project ${group.benchmarkProject}.`
        );
      }
      if (evaluationCase.sourceRoots.join("\u0000") !== group.sourceRoots.join("\u0000")) {
        group.structuralErrors.push(
          `Case ${evaluationCase.id} source roots [${evaluationCase.sourceRoots.join(", ")}] differ from [${group.sourceRoots.join(", ")}] for benchmark project ${group.benchmarkProject}.`
        );
      }
    }
    group.cases.push(evaluationCase);
  }

  const result = [...groups.values()];
  assertUniqueSegments(result.map((group) => [group.benchmarkProject, group.projectSegment]), "benchmark project");
  for (const group of result) {
    assertUniqueSegments(
      group.cases.map((evaluationCase) => [evaluationCase.id, taskOutputSegment(evaluationCase.id)]),
      "case"
    );
  }
  return result;
}

export function taskOutputSegment(caseId: string): string {
  return safeOutputSegment(caseId, "case");
}

// Reuses the shared experiment path-segment sanitizer and additionally rejects dot-only segments,
// which the sanitizer preserves and which would resolve outside the intended directory.
function safeOutputSegment(value: string, label: string): string {
  const segment = sanitizePathSegment(value);
  if (/^\.+$/.test(segment)) {
    throw new Error(`Unsafe ${label} ID for an output path segment: ${JSON.stringify(value)}`);
  }
  return segment;
}

function assertUniqueSegments(entries: Array<[string, string]>, label: string): void {
  const owners = new Map<string, string>();
  for (const [id, segment] of entries) {
    const owner = owners.get(segment);
    if (owner !== undefined && owner !== id) {
      throw new Error(`The ${label} IDs ${owner} and ${id} map to the same output path segment "${segment}".`);
    }
    owners.set(segment, id);
  }
}
