import type { AffectedNeighborhoodAssessmentV1 } from "../../../src/evaluation/affectedNeighborhood.js";

/**
 * A persisted-shape affected-neighborhood assessment: complete, fresh, no seeds, complete task
 * mapping over three task nodes, zero overlap (relationship unrelated / not-indicated). Tests
 * override only the fields under examination.
 */
export function makeAssessment(overrides: Partial<AffectedNeighborhoodAssessmentV1> = {}): AffectedNeighborhoodAssessmentV1 {
  return {
    schemaVersion: "my-dev-kit-lab-affected-neighborhood-assessment-v1",
    status: "complete",
    freshnessStatus: "fresh",
    seedMappingStatus: "complete",
    graphEvidenceStatus: "complete",
    neighborhoodStatus: "complete",
    changedFileCount: 0,
    changedSymbolCount: 0,
    seedNodeCount: 0,
    affectedNodeCount: 0,
    affectedEdgeCount: 0,
    affectedNodeIds: [],
    participatingEdgeIds: [],
    taskMapping: {
      status: "complete",
      expectedFiles: ["src/a.ts", "src/b.ts"],
      expectedSymbols: ["alpha"],
      resolvedFiles: [
        { path: "src/a.ts", nodeId: "file:src/a.ts" },
        { path: "src/b.ts", nodeId: "file:src/b.ts" },
      ],
      resolvedSymbols: [{ name: "alpha", nodeId: "symbol:src/a.ts#alpha" }],
      unresolvedCount: 0,
      unresolved: [],
      unresolvedTruncated: false,
      ambiguousCount: 0,
      ambiguousSymbols: [],
      ambiguousTruncated: false,
      duplicateEntryCount: 0,
      resolvedTaskNodeIds: ["file:src/a.ts", "file:src/b.ts", "symbol:src/a.ts#alpha"],
      resolvableTaskNodeCount: 3,
    },
    taskOverlapCount: 0,
    taskOverlapNodeIds: [],
    taskOverlapPercent: 0,
    relationship: "unrelated",
    reindexRecommendation: "not-indicated",
    warningCount: 0,
    warnings: [],
    warningsTruncated: false,
    ...overrides,
  };
}
