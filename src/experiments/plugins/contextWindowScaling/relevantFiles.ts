export type RelevantFileEvidenceStatus = "available" | "unavailable" | "not-applicable";

/**
 * v0.7.0 "relevant file" means only a file listed by the benchmark expected-file contract.
 * This is expected-minus-observed evidence, not retrieval precision or recall.
 */
export type RelevantFileEvidence = {
  status: RelevantFileEvidenceStatus;
  expectedRelevantFiles: string[];
  expectedRelevantFileCount: number;
  observedExpectedFileCount: number | null;
  omittedRelevantFileCount: number | null;
  omittedRelevantFiles: string[];
  reason: string | null;
};

/**
 * Bounded repository-relative identity: "\" becomes "/", leading "./" is removed, case is kept.
 * Returns null for absolute paths, drive paths, parent traversal, empty segments, or oversized values.
 */
export function normalizeRepositoryRelativePath(value: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) {
    return null;
  }
  let normalized = value.replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return null;
  }
  if (normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    return null;
  }
  return normalized;
}

/** observedFiles === null means observed-file provenance is unavailable. */
export function computeRelevantFileEvidence(args: {
  expectedFiles: readonly string[];
  observedFiles: readonly string[] | null;
}): RelevantFileEvidence {
  if (args.expectedFiles.length === 0) {
    return {
      status: "not-applicable",
      expectedRelevantFiles: [],
      expectedRelevantFileCount: 0,
      observedExpectedFileCount: null,
      omittedRelevantFileCount: null,
      omittedRelevantFiles: [],
      reason: "No expected relevant files are defined for this case.",
    };
  }
  const expected: string[] = [];
  for (const file of args.expectedFiles) {
    const normalized = normalizeRepositoryRelativePath(file);
    if (normalized === null) {
      return unavailable([...args.expectedFiles], "An expected relevant file is not a bounded repository-relative path.");
    }
    if (!expected.includes(normalized)) {
      expected.push(normalized);
    }
  }
  if (args.observedFiles === null) {
    return unavailable(expected, "Observed-file provenance is unavailable.");
  }
  const observed = new Set<string>();
  for (const file of args.observedFiles) {
    const normalized = normalizeRepositoryRelativePath(file);
    if (normalized === null) {
      return unavailable(expected, "An observed file is not a bounded repository-relative path.");
    }
    observed.add(normalized);
  }
  const omitted = expected.filter((file) => !observed.has(file));
  return {
    status: "available",
    expectedRelevantFiles: expected,
    expectedRelevantFileCount: expected.length,
    observedExpectedFileCount: expected.length - omitted.length,
    omittedRelevantFileCount: omitted.length,
    omittedRelevantFiles: omitted,
    reason: null,
  };
}

function unavailable(expected: string[], reason: string): RelevantFileEvidence {
  return {
    status: "unavailable",
    expectedRelevantFiles: expected,
    expectedRelevantFileCount: expected.length,
    observedExpectedFileCount: null,
    omittedRelevantFileCount: null,
    omittedRelevantFiles: [],
    reason,
  };
}
