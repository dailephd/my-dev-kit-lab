import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// TST-B1-027: no Batch 1 reader/selector imports or invokes upstream producer
// owner-selection, allocation, parity, readiness, or issue-prioritization functions.
// Verified structurally: none of the new modules import from outside this repo, and
// none reference the specific upstream policy-owning function names.
const BATCH_1_SOURCE_FILES = [
  "src/evaluation/upstreamArtifacts/supplementalContextTypes.ts",
  "src/evaluation/upstreamArtifacts/supplementalContextTextParser.ts",
  "src/evaluation/upstreamArtifacts/validateSupplementalContextDocumentV1.ts",
  "src/evaluation/upstreamArtifacts/readImplementationContextPacketV1.ts",
  "src/evaluation/upstreamArtifacts/readImplementationContextRetrievalReportV1.ts",
  "src/evaluation/upstreamArtifacts/readTestContextPacketV1.ts",
  "src/evaluation/upstreamArtifacts/readTestContextRetrievalReportV1.ts",
  "src/evaluation/upstreamArtifacts/orchestratorContextReadinessResultV1.ts"
];

// v0.4.4 Batch 2/3: the metric calculators, the bridge evaluator, and the strategy
// integration points that consume them. These legitimately import across this repo's own
// directory tree (e.g. "../../../evaluation/..."), so the forbidden-pattern check below is
// scoped to literal upstream-repository indicators and absolute paths, not generic
// relative-traversal depth (see BATCH_1 vs BATCH_2_3 pattern sets).
const BATCH_2_3_SOURCE_FILES = [
  "src/evaluation/stageContextMetrics/calculateOwnerMetrics.ts",
  "src/evaluation/stageContextMetrics/calculateAllocationMetrics.ts",
  "src/evaluation/stageContextMetrics/calculateTruncationClassification.ts",
  "src/evaluation/stageContextMetrics/calculateSupplementalRawAgreement.ts",
  "src/evaluation/stageContextMetrics/calculateReadinessAgreement.ts",
  "src/evaluation/stageContextMetrics/calculateCriticalityMetrics.ts",
  "src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.ts",
  "src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.ts",
  "src/experiments/plugins/contextStrategyComparison/runV043StageContextStrategyWithAssurance.ts"
];

const FORBIDDEN_POLICY_FUNCTION_NAMES = [
  "evaluateContextReadiness",
  "evaluateRunContextReadiness",
  "assertRawEvidenceParity",
  "findRawEvidenceParityIssues",
  "findCapsuleAuditInconsistencies",
  "computeCriticalResponsibilitySummary",
  "allCriticalResponsibilitiesFullyMapped"
];

// Literal upstream-repository path indicators and absolute-path prefixes. Never a valid
// substring of an intra-repo relative import in this codebase.
const FORBIDDEN_UPSTREAM_PATH_SNIPPETS = [
  "my-dev-kit-v1",
  "my-dev-kit-orchestrator",
  "from \"Z:",
  "from \"/",
  "from \"C:"
];

function checkFileIndependence(relativePath: string): void {
  const importLines = readFileSync(relativePath, "utf8")
    .split(/\r\n|\n/)
    .filter((line) => /^\s*import\b/.test(line));
  for (const line of importLines) {
    for (const forbidden of FORBIDDEN_UPSTREAM_PATH_SNIPPETS) {
      expect(line).not.toContain(forbidden);
    }
    for (const fn of FORBIDDEN_POLICY_FUNCTION_NAMES) {
      expect(line).not.toContain(fn);
    }
  }
}

describe("Batch 1 reader/selector independence", () => {
  it.each(BATCH_1_SOURCE_FILES)("%s does not import outside this repository or reference upstream policy functions", (relativePath) => {
    checkFileIndependence(relativePath);
  });
});

describe("Batch 2/3 metric calculator, bridge evaluator, and strategy integration independence", () => {
  it.each(BATCH_2_3_SOURCE_FILES)("%s does not import outside this repository or reference upstream policy functions", (relativePath) => {
    checkFileIndependence(relativePath);
  });
});
