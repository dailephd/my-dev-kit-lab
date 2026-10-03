import type { SyntheticRepositoryCaseSpecV1, SyntheticRepositoryPlanV1 } from "../../../src/evaluation/syntheticRepository/index.js";

/**
 * Independent test oracle helpers for the synthetic repository planner. Nothing here imports production
 * planning logic, so graph and path claims are checked by a second, separately written implementation.
 */

export function makeCase(overrides: Partial<SyntheticRepositoryCaseSpecV1> = {}): SyntheticRepositoryCaseSpecV1 {
  return {
    id: "case-1",
    language: "typescript",
    seed: "oracle-seed",
    sourceFileCount: 4,
    moduleDepth: 2,
    internalImportCount: 3,
    symbolCount: 8,
    testFileCount: 2,
    taskLocality: "localized",
    repeatedPatternCount: 3,
    ...overrides,
  };
}

export function makeConfig(cases: unknown[]): { schemaVersion: string; cases: unknown[] } {
  return { schemaVersion: "1.0.0", cases };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export type OracleGraphReport = {
  edgeCount: number;
  selfEdges: number;
  duplicateEdges: number;
  danglingEndpoints: number;
  acyclic: boolean;
  longestChainModules: number;
};

/** Longest dependency chain counted in modules, found by memoized depth-first search with cycle detection. */
export function analyzeImportGraph(plan: SyntheticRepositoryPlanV1): OracleGraphReport {
  const ids = new Set(plan.modules.map((module) => module.moduleId));
  const outgoing = new Map<string, string[]>();
  for (const id of ids) outgoing.set(id, []);
  const seen = new Set<string>();
  let selfEdges = 0;
  let duplicateEdges = 0;
  let danglingEndpoints = 0;
  for (const edge of plan.importEdges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      danglingEndpoints += 1;
      continue;
    }
    if (edge.from === edge.to) selfEdges += 1;
    const key = `${edge.from} -> ${edge.to}`;
    if (seen.has(key)) duplicateEdges += 1;
    seen.add(key);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const state = new Map<string, "visiting" | "done">();
  const longest = new Map<string, number>();
  let acyclic = true;
  const visit = (id: string): number => {
    const known = longest.get(id);
    if (known !== undefined) return known;
    if (state.get(id) === "visiting") {
      acyclic = false;
      return 0;
    }
    state.set(id, "visiting");
    let best = 1;
    for (const next of outgoing.get(id) ?? []) best = Math.max(best, 1 + visit(next));
    state.set(id, "done");
    longest.set(id, best);
    return best;
  };
  let longestChainModules = 0;
  for (const id of ids) longestChainModules = Math.max(longestChainModules, visit(id));
  return {
    edgeCount: plan.importEdges.length,
    selfEdges,
    duplicateEdges,
    danglingEndpoints,
    acyclic,
    longestChainModules,
  };
}

export function allPlannedPaths(plan: SyntheticRepositoryPlanV1): string[] {
  return [...plan.modules.map((module) => module.path), ...plan.testFiles.map((test) => test.path)];
}

/** True for a relative POSIX-style logical path with no "." / ".." / empty segments, drive or UNC form. */
export function isSafeLogicalPath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes(":")) return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
