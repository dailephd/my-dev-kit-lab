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

const FORBIDDEN_IMPORT_SNIPPETS = ["my-dev-kit-v1", "my-dev-kit-orchestrator", "from \"../../"];

const FORBIDDEN_POLICY_FUNCTION_NAMES = [
  "evaluateContextReadiness",
  "evaluateRunContextReadiness",
  "assertRawEvidenceParity",
  "findRawEvidenceParityIssues",
  "findCapsuleAuditInconsistencies",
  "computeCriticalResponsibilitySummary",
  "allCriticalResponsibilitiesFullyMapped"
];

describe("Batch 1 reader/selector independence", () => {
  it.each(BATCH_1_SOURCE_FILES)("%s does not import outside this repository or reference upstream policy functions", (relativePath) => {
    const importLines = readFileSync(relativePath, "utf8")
      .split(/\r\n|\n/)
      .filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      for (const forbidden of FORBIDDEN_IMPORT_SNIPPETS) {
        expect(line).not.toContain(forbidden);
      }
      for (const fn of FORBIDDEN_POLICY_FUNCTION_NAMES) {
        expect(line).not.toContain(fn);
      }
    }
  });
});
