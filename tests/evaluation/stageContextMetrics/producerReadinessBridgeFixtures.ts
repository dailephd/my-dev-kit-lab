// v0.4.4 Batch 3: deterministic historical producer-to-readiness fixture family.
// Built from the real, already-tracked my-dev-kit ContextCapsule fixture (Batch 1/2
// convention: tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/
// complete-v1.0.0.json) plus the Batch 1 supplemental-text builder, rather than 20
// separate static files -- deep-cloned per case so no variant mutates a shared object
// (section 10.6). Local, network-independent, no random IDs, no current timestamps.
import { readFileSync } from "node:fs";
import type { ContextCapsule, OrchestratorContextReadinessResultV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";
import { buildValidSupplementalContextText } from "../upstreamArtifacts/supplementalContextFixtures.js";
import { validateSupplementalContextDocumentV1 } from "../../../src/evaluation/upstreamArtifacts/validateSupplementalContextDocumentV1.js";
import type { SupplementalContextDocumentKind } from "../../../src/evaluation/upstreamArtifacts/index.js";

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";

// v0.4.4 Batch 3 fixture family manifest (section 10.3). Kept as a plain in-memory
// constant (builder convention) rather than a separate manifest.json.
export const PRODUCER_READINESS_FIXTURE_MANIFEST = {
  fixtureFamilyId: "stage-context-v044-producer-readiness",
  schemaVersion: "1.0.0",
  frozenMyDevKitCommit: "b689229cc06304edd93da8a2a1942b7ec1c24957",
  frozenOrchestratorCommit: "bc08a05d3b52a629e7e4504372af199c324c4ae4",
  canonicalRepositoryIdentity: "Z:/fixture/project",
  targetIdentity: "fixture-target",
  runIdentity: "run-v044-fixture-001",
  stageIdentity: "stage.feature.implementation",
  caseIds: [
    "CASE-V044-001",
    "CASE-V044-002",
    "CASE-V044-003",
    "CASE-V044-004",
    "CASE-V044-005",
    "CASE-V044-006",
    "CASE-V044-007",
    "CASE-V044-008",
    "CASE-V044-009",
    "CASE-V044-010",
    "CASE-V044-011",
    "CASE-V044-012",
    "CASE-V044-013",
    "CASE-V044-014",
    "CASE-V044-015",
    "CASE-V044-016",
    "CASE-V044-017",
    "CASE-V044-018",
    "CASE-V044-019",
    "CASE-V044-020"
  ]
} as const;

function loadBaseCapsule(): ContextCapsule {
  return JSON.parse(readFileSync(CAPSULE_FIXTURE_PATH, "utf8")) as ContextCapsule;
}

// Deep clone via JSON round-trip: ContextCapsule/RetrievalAuditRecord are pure JSON-shaped
// data, so this is a safe, dependency-free way to guarantee no variant mutates the base
// (section 10.6 / TST-B3-005).
function cloneCapsule(capsule: ContextCapsule): ContextCapsule {
  return JSON.parse(JSON.stringify(capsule)) as ContextCapsule;
}

export function buildCanonicalCapsule(overrides: (capsule: ContextCapsule) => void = () => {}): ContextCapsule {
  const capsule = cloneCapsule(loadBaseCapsule());
  capsule.index.projectRoot = PRODUCER_READINESS_FIXTURE_MANIFEST.canonicalRepositoryIdentity;
  overrides(capsule);
  return capsule;
}

export function buildSupplementalDocument(
  kind: SupplementalContextDocumentKind,
  metadataOverrides: Record<string, string | undefined> = {},
  sectionOverrides: Record<string, string | undefined> = {}
) {
  const text = buildValidSupplementalContextText(kind, {
    metadata: { "Index identity": PRODUCER_READINESS_FIXTURE_MANIFEST.canonicalRepositoryIdentity, ...metadataOverrides },
    sections: sectionOverrides
  });
  const artifactKind = {
    "implementation-context-packet": "orchestrator-implementation-context-packet-v1",
    "implementation-context-retrieval-report": "orchestrator-implementation-context-retrieval-report-v1",
    "test-context-packet": "orchestrator-test-context-packet-v1",
    "test-context-retrieval-report": "orchestrator-test-context-retrieval-report-v1"
  }[kind] as Parameters<typeof validateSupplementalContextDocumentV1>[0];
  const result = validateSupplementalContextDocumentV1(artifactKind, kind, text, `fixture:${kind}`);
  if (!result.ok) throw new Error(`Fixture supplemental document construction failed unexpectedly for kind "${kind}": ${result.message}`);
  return result.artifact;
}

export function buildReadinessResult(overrides: Partial<OrchestratorContextReadinessResultV1> = {}): OrchestratorContextReadinessResultV1 {
  return {
    schemaVersion: "1.0.0",
    kind: "implementation",
    role: "implementation",
    decision: "ready",
    classification: "ready",
    stageId: PRODUCER_READINESS_FIXTURE_MANIFEST.stageIdentity,
    packetPath: "fixture:implementation-context-packet",
    reportPath: "fixture:implementation-context-retrieval-report",
    issues: [],
    warnings: [],
    blockingIssueCodes: [],
    affectedResponsibilityIds: [],
    evaluatedFreshness: "fresh",
    evaluatedAdequacy: "sufficient",
    requiredEvidenceTruncated: "no",
    readyWithAssumptions: false,
    provenanceSummary: "resolved from populated packet/report pair",
    indexIdentity: PRODUCER_READINESS_FIXTURE_MANIFEST.canonicalRepositoryIdentity,
    ...overrides
  };
}
