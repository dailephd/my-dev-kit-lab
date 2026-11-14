import type { TutorialRunStatus } from "../../tutorial/types.js";
/** ECO-00 objects are consumed unchanged; Lab qualification is a separate record. */
export type Eco00Subject = { schemaVersion: "1.0.0"; authority: string; namespace: string; value: string; repository?: { owner: string; name: string; commit?: string } };
export type Eco00Environment = { schemaVersion: "1.0.0"; environmentId: string; dimensions: Record<string, string> };
export type Eco00NativeReference = { schemaVersion: "1.0.0"; producer: { packageName: string; packageVersion: string }; artifactKind: string; artifactSchemaVersion?: string; locator: { kind: "path" | "uri" | "opaque-id"; value: string }; integrity?: { sha256: string } };
export type Eco00Envelope = { schemaVersion: "1.0.0"; evidenceId: string; capabilityId: string; subject: Eco00Subject; nativeArtifact: Eco00NativeReference; freshness: "current" | "stale" | "partially-stale" | "unknown" | "not-applicable"; environment?: Eco00Environment; observedAt?: string };
export type Eco00Requirement = { schemaVersion: "1.0.0"; requirementId: string; capabilityId: string; criticality: "critical" | "noncritical"; acceptedArtifactKinds: string[]; responsibility?: Eco00Subject };
export type Eco00Bundle = { schemaVersion: "1.0.0"; bundleId: string; status: "supported" | "tested" | "certified" | "active"; components: Array<{ packageName: string; packageVersion: string; commit?: string; artifactSha256?: string }>; contracts: Array<{ contractId: string; schemaVersion: string }>; testEvidenceRefs?: string[]; certificationProfile?: string; supersedesBundleId?: string };
export type LabSelectedInputsV1 = { paths: string[]; exclusions: string[]; policyId: string; relevantIgnoredPaths: string[] };
export type LabSubjectBindingV1 = {
  subject: Eco00Subject;
  source: { repositoryRootIdentity: string; commitShaOrNull: string | null; sourceManifestSha256OrNull: string | null; dirtyTrackedState: string; selectedUntrackedState: string; selectionDigest: string; completeness: "complete" | "incomplete" | "unverifiable" };
  environment: { canonicalECO00EnvironmentOrNull: Eco00Environment | null; nodeVersion: string; platform: string; architecture: string; environmentSelectionDigest: string };
  runtime: { buildIdentityOrNull: string | null; sourceToRuntimeBinding: "verified" | "unverified" | "not-applicable"; corroboration: string[] };
  provenance: "declared" | "independently-corroborated" | "unverified";
};
export type LabEvidenceRequirementV1 = {
  requirementId: string; capabilityId: string; criticality: "critical" | "noncritical";
  acceptedArtifactKinds: string[]; acceptedSchemaVersions: string[]; requiredCapabilities: string[];
  freshnessPolicy: "current" | "not-applicable"; nativeSuccessRequired: boolean;
  applicability: "applicable" | "not-applicable"; applicabilityReason?: string;
};
export type LabVerificationPlanV1 = {
  schemaVersion: "1.0.0"; planId: string; policyVersion: string; subject: Eco00Subject;
  profileId: "cli-verification-v1" | "local-app-verification-v1";
  selectedInputs: LabSelectedInputsV1; requirements: LabEvidenceRequirementV1[];
  checks: Array<{ checkId: string; profileId: "node-test-tap-v1"; testFile: string; capabilityId: string }>;
};
export type LabNativeAdapterResultV1 = {
  adapterId: string; adapterVersion: "1.0.0"; nativeArtifact: Eco00NativeReference;
  availability: "available" | "unavailable" | "unsupported" | "invalid";
  nativeOutcome: "passed" | "failed" | "indeterminate" | "unavailable";
  completeness: "complete" | "partial" | "unknown";
  capabilities: string[]; counts: { tests: number; passed: number; failed: number } | null;
  limitations: string[]; nativeStatus: string | null;
  nativeFreshness: Eco00Envelope["freshness"];
};
export type LabEvidenceInvocationV1 = {
  checkId: string; profileId: "node-test-tap-v1"; executableSha256: string; testFile: string;
  exitCode: number | null; timedOut: boolean; outputLimit: boolean;
  cleanup: "confirmed" | "failed" | "not-required";
  targetMutation: "unchanged" | "changed" | "unknown";
  disposableExecution: boolean; networkPolicy: "not-enforced";
};
export type LabEvidenceQualificationV1 = {
  schemaVersion: "1.0.0"; qualificationId: string; canonicalEnvelope: Eco00Envelope;
  planSha256: string; subjectBinding: LabSubjectBindingV1;
  environmentBinding: Eco00Environment | null; nativeArtifactSha256: string;
  captureOrigin: "direct-capture" | "passive-import"; invocationOrNull: LabEvidenceInvocationV1 | null;
  nativeOutcome: LabNativeAdapterResultV1["nativeOutcome"]; completeness: LabNativeAdapterResultV1["completeness"];
  provenance: "independently-corroborated" | "caller-declared" | "unverified";
  limitations: string[]; qualifiedAtOrNull: string | null;
};
export type LabEvidenceStatus = "satisfied" | "failed" | "unavailable" | "incomplete" | "incompatible" | "stale" | "indeterminate" | "not-applicable";
export type LabEvidenceAssessmentV1 = {
  schemaVersion: "1.0.0"; planSha256: string; consumerSupportSha256: string;
  requirements: Array<{ requirementId: string; criticality: "critical" | "noncritical"; applicability: "applicable" | "not-applicable"; status: LabEvidenceStatus; reason: string; qualificationId: string | null }>;
  blockingRequirementIds: string[]; satisfied: boolean;
};
export type LabPackageArtifactIdentityV1 = { packageName: string; packageVersion: string; sha256: string; identityKind: "package-artifact" | "complete-content-manifest"; verified: boolean };
export type LabCertificationRecordV1 = {
  schemaVersion: "1.0.0"; canonicalBundle: Eco00Bundle;
  bundleArtifactIdentities: LabPackageArtifactIdentityV1[]; profileId: string; profileVersion: "1.0.0";
  specificationSha256: string; fixtureRevisionSha256: string; environmentMatrix: Eco00Environment[];
  planSha256: string; assessmentSha256: string; nativeEvidenceRefs: Eco00NativeReference[];
  certificationScope: string[]; limitations: string[]; certificationStatus: "supported" | "tested" | "certified";
};
export type LabEvidenceImportRequestV1 = {
  plan: LabVerificationPlanV1; authorizedEvidenceRoot: string; expectedRootIdentity: string;
  reference: Eco00NativeReference; expectedSha256: string; subjectBinding: LabSubjectBindingV1;
  capabilityId: string; freshness: Eco00Envelope["freshness"];
  /** Historical origin is a declaration unless corroborated by direct capture. */
  provenance: "caller-declared" | "unverified";
};
export type LabEvidenceImportFailureCode = "MISSING" | "UNREADABLE" | "OUTSIDE_AUTHORIZED_ROOT" | "UNSUPPORTED_LOCATOR" | "OVERSIZED" | "CHANGED_DURING_READ" | "DIGEST_MISMATCH" | "INVALID_NATIVE_SHAPE" | "UNSUPPORTED_NATIVE_SCHEMA" | "MISSING_MANDATORY_CAPABILITY" | "ROOT_IDENTITY_MISMATCH" | "INVALID_REQUEST";
export type LabEvidenceImportResultV1 = { ok: true; qualification: LabEvidenceQualificationV1; adapter: LabNativeAdapterResultV1; nativeBytes: Uint8Array } | { ok: false; code: LabEvidenceImportFailureCode; reason: string };
export type LabEvidenceCaptureAuthorizationV1 = {
  authorizationVersion: "1.0.0"; allowLocalCodeExecution: boolean; canonicalTargetRoot: string;
  disposableExecutionRoot: string; allowedCheckIds: string[]; allowedTestFiles: string[];
  allowedWritableRoot: string; timeoutMs: number; stdoutMaxBytes: number; stderrMaxBytes: number;
  networkPolicy: "not-enforced"; environmentExtras: Record<string, string>;
};
export type LabEvidenceCaptureRequestV1 = { plan: LabVerificationPlanV1; checkId: string; authorization: LabEvidenceCaptureAuthorizationV1; sandboxId: string };
export type LabEvidenceCaptureResultV1 = { ok: true; qualification: LabEvidenceQualificationV1; adapter: LabNativeAdapterResultV1; nativeBytes: Uint8Array } | { ok: false; code: string; reason: string };
export type LabConsumerSupportV1 = { artifactSchemas: Record<string, string[]>; capabilities: string[]; requireIndependentProvenance: boolean; requiredEnvironment: Eco00Environment | null };
export type LabEvidenceEvaluationRequestV1 = { plan: LabVerificationPlanV1; qualifications: LabEvidenceQualificationV1[]; adapters: LabNativeAdapterResultV1[]; subjectBinding: LabSubjectBindingV1; support: LabConsumerSupportV1 };
export type LabEvidenceEvaluationResultV1 = LabEvidenceAssessmentV1;
export type LabCertificationRequestV1 = {
  plan: LabVerificationPlanV1; evaluation: LabEvidenceEvaluationRequestV1; canonicalBundle: Eco00Bundle;
  profileId: string; packageIdentities: LabPackageArtifactIdentityV1[]; approvedPackageIdentities: LabPackageArtifactIdentityV1[];
  specificationSha256: string; fixtureRevisionSha256: string; environmentMatrix: Eco00Environment[];
  browserWitness: { available: boolean; sessionProvenance: string; loopbackOrigin: string; sourceRuntimeBindingSha256: string; nativeResultOrNull?: { nativeArtifact: Eco00NativeReference; nativeStatus: TutorialRunStatus; completeness: "complete" | "partial" | "unknown"; preparationAuthorized: boolean; preparationSha256: string; verified: boolean } | null } | null;
  /** Trusted harness observations, never inferred from a package version or archive's contents. */
  executionPackageBindings: Array<{ qualificationId: string; packageIdentitySha256: string; specificationSha256: string; fixtureRevisionSha256: string; verified: boolean }>;
  approvedPackageCombinations: string[];
};
export type LabCertificationResultV1 = { record: LabCertificationRecordV1; assessment: LabEvidenceAssessmentV1; certified: boolean };
