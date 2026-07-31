// v0.4.5 Batch 4: machine-readable provenance manifest for a frozen ecosystem
// context-integrity fixture (a failed real run, or a corrected replay). One manifest
// describes one fixture directory's tracked files with their original and copied SHA-256
// hashes, artifact roles, and evaluation use -- so hash verification, path safety, and
// provenance auditing never depend on the original absolute Windows source path.
export type EcosystemFixtureArtifactRole =
  | "producer-request"
  | "context-capsule"
  | "retrieval-audit-record"
  | "supplemental-packet"
  | "supplemental-report"
  | "workflow-instruction-packet"
  | "prompt"
  | "implementation-report"
  | "test-implementation-report"
  | "verification-report"
  | "judge-report"
  | "final-report"
  | "run-metadata"
  | "run-integrity-evidence"
  | "artifact-state"
  | "status-capture"
  | "check-capture"
  | "command-transcript"
  | "provenance-identity"
  | "expected-output"
  | "tool-version"
  | "unrelated-investigation-artifact"
  | "duplicate"
  | "unknown";

export interface EcosystemFixtureArtifactEntryV1 {
  originalRelativePath: string;
  fixtureRelativePath: string;
  role: EcosystemFixtureArtifactRole;
  originalSha256: string;
  copiedSha256: string;
  byteExact: boolean;
  derived: boolean;
  derivationSources: string[];
  normalizationApplied: string[];
  evaluationUse: boolean;
  provenanceOnly: boolean;
}

export interface EcosystemFixtureExcludedArtifactEntryV1 {
  originalRelativePath: string;
  originalSha256: string;
  originalSizeBytes: number;
  role: EcosystemFixtureArtifactRole;
  exclusionReason: string;
}

export interface EcosystemFixtureUpstreamIdentityV1 {
  repository: string;
  branch: string | null;
  commit: string | null;
  packageName: string | null;
  packageVersion: string | null;
}

export interface EcosystemFixtureManifestV1 {
  manifestSchemaVersion: "1.0.0";
  fixtureId: string;
  description: string;
  sourceEvidenceRoot: string;
  myDevKit: EcosystemFixtureUpstreamIdentityV1;
  orchestrator: EcosystemFixtureUpstreamIdentityV1;
  runId: string | null;
  targetRepositoryIdentity: string | null;
  activeIndexIdentity: string | null;
  expectedOldRunOutcome: string | null;
  generatedAt: string;
  artifacts: EcosystemFixtureArtifactEntryV1[];
  excludedArtifacts: EcosystemFixtureExcludedArtifactEntryV1[];
}
