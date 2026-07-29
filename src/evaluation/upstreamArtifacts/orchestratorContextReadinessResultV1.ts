// Lab-owned bounded plain-object adapter for the frozen my-dev-kit-orchestrator
// ContextReadinessResult (commit bc08a05d3b52a629e7e4504372af199c324c4ae4,
// src/instructions/contextReadiness.ts). At the frozen commit, readiness is never
// serialized to a stable file artifact -- `check`/`export` only render it as formatted
// text (src/commands/check.ts, src/commands/export.ts). This adapter therefore
// validates and normalizes a plain object (as constructed by a caller that already has
// an in-memory readiness result -- e.g. a future integration or a test fixture), rather
// than parsing a file. It never imports orchestrator runtime code and never
// recomputes/reevaluates readiness, producer parity, or issue prioritization -- it only
// preserves what is already declared on the object.

import type { JsonObject } from "./jsonTypes.js";
import type { UpstreamArtifactKind, UpstreamArtifactReadFailure, UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import { makeFailure } from "./runtimeValidation.js";
import {
  VALID_ADEQUACY_VALUES,
  VALID_FRESHNESS_VALUES,
  VALID_TRUNCATION_VALUES,
  type DeclaredAdequacy,
  type DeclaredFreshness,
  type DeclaredTruncation,
  type SupplementalContextDocumentV1
} from "./supplementalContextTypes.js";

const ARTIFACT_KIND: UpstreamArtifactKind = "orchestrator-context-readiness-result-v1";

export type SupplementalContextKind = "implementation" | "test";

export const READINESS_DECISIONS = ["not-required", "ready", "refresh-required"] as const;
export type ContextReadinessDecision = (typeof READINESS_DECISIONS)[number];

export const READINESS_CLASSIFICATIONS = [
  "not-required",
  "ready",
  "missing",
  "template",
  "partial",
  "malformed",
  "unsupported-schema",
  "incompatible",
  "source-reference-missing",
  "source-reference-unreadable",
  "source-evidence-malformed",
  "source-evidence-unsupported-schema",
  "role-mismatch",
  "repository-scope-mismatch",
  "repository-identity-incomplete",
  "index-identity-incomplete",
  "index-identity-mismatch",
  "freshness-unknown",
  "stale",
  "adequacy-unknown",
  "inadequate",
  "conflict",
  "required-evidence-truncated",
  "required-evidence-incomplete",
  "provenance-missing",
  "test-strategy-missing",
  "test-responsibility-invalid",
  "test-responsibility-criticality-unknown",
  "responsibility-mappings-truncated",
  "critical-responsibilities-unmapped"
] as const;
export type ContextReadinessClassification = (typeof READINESS_CLASSIFICATIONS)[number];

export type ContextReadinessIssueSeverity = "error" | "warning";

export type ContextReadinessIssue = {
  code: string;
  severity: ContextReadinessIssueSeverity;
  message: string;
  priority: number;
  correctiveAction: string;
  evidenceTarget: string;
  stageId: string;
  contextKind: SupplementalContextKind;
  path?: string;
  field?: string;
  responsibilityId?: string;
  expected?: string;
  actual?: string;
  sourceCode?: string;
};

export type ContextReadinessBlockerSummary = {
  contextKind: SupplementalContextKind;
  primaryCode: string;
  primaryReason: string;
  correctiveAction: string;
  evidenceTarget: string;
  blockingIssueCodes: string[];
  supportingIssueCodes: string[];
};

export type OrchestratorContextReadinessResultV1 = {
  schemaVersion: string;
  kind: SupplementalContextKind;
  role: "implementation" | "test-implementation";
  decision: ContextReadinessDecision;
  classification: ContextReadinessClassification;
  stageId: string;
  packetPath: string;
  reportPath: string;
  sourceCapsulePath?: string;
  sourceAuditPath?: string;
  issues: ContextReadinessIssue[];
  warnings: string[];
  blockingIssueCodes: string[];
  primaryIssue?: ContextReadinessIssue;
  blockerSummary?: ContextReadinessBlockerSummary;
  affectedResponsibilityIds: string[];
  declaredFreshness?: DeclaredFreshness;
  evaluatedFreshness: DeclaredFreshness;
  declaredAdequacy?: DeclaredAdequacy;
  evaluatedAdequacy: DeclaredAdequacy;
  requiredEvidenceTruncated: DeclaredTruncation;
  responsibilityMappingsTruncated?: DeclaredTruncation;
  indexIdentity?: string;
  readyWithAssumptions: boolean;
  provenanceSummary: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(
  sourceLabel: string,
  code: UpstreamArtifactReadFailure["code"],
  message: string,
  fieldPath?: string
): UpstreamArtifactReadFailure {
  return makeFailure(ARTIFACT_KIND, sourceLabel, code, message, fieldPath);
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldPath: string,
  sourceLabel: string,
  errorCode: UpstreamArtifactReadFailure["code"]
): T | UpstreamArtifactReadFailure {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return fail(
      sourceLabel,
      errorCode,
      `Field "${fieldPath}" must be one of: ${allowed.join(", ")}. Received: ${JSON.stringify(value)}.`,
      fieldPath
    );
  }
  return value as T;
}

function isReadinessIssue(value: unknown): value is ContextReadinessIssue {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.code === "string" &&
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.message === "string" &&
    typeof value.priority === "number" &&
    typeof value.correctiveAction === "string" &&
    typeof value.evidenceTarget === "string" &&
    typeof value.stageId === "string" &&
    (value.contextKind === "implementation" || value.contextKind === "test")
  );
}

function isBlockerSummary(value: unknown): value is ContextReadinessBlockerSummary {
  if (!isPlainObject(value)) return false;
  return (
    (value.contextKind === "implementation" || value.contextKind === "test") &&
    typeof value.primaryCode === "string" &&
    typeof value.primaryReason === "string" &&
    typeof value.correctiveAction === "string" &&
    typeof value.evidenceTarget === "string" &&
    Array.isArray(value.blockingIssueCodes) &&
    value.blockingIssueCodes.every((c: unknown) => typeof c === "string") &&
    Array.isArray(value.supportingIssueCodes) &&
    value.supportingIssueCodes.every((c: unknown) => typeof c === "string")
  );
}

export function validateOrchestratorContextReadinessResultV1(
  input: unknown,
  sourceLabel: string
): UpstreamArtifactReadResult<OrchestratorContextReadinessResultV1> {
  if (!isPlainObject(input)) {
    return fail(sourceLabel, "MALFORMED_TEXT_ARTIFACT", `Readiness input at "${sourceLabel}" must be a plain object.`);
  }

  const schemaVersion = input["schemaVersion"];
  if (typeof schemaVersion !== "string" || schemaVersion.length === 0) {
    return fail(sourceLabel, "MISSING_REQUIRED_FIELD", `Readiness input at "${sourceLabel}" is missing "schemaVersion".`, "schemaVersion");
  }

  const kind = requireEnum(input["kind"], ["implementation", "test"] as const, "kind", sourceLabel, "MISSING_REQUIRED_FIELD");
  if (typeof kind !== "string") return kind;

  const roleAllowed = ["implementation", "test-implementation"] as const;
  const role = requireEnum(input["role"], roleAllowed, "role", sourceLabel, "MISSING_REQUIRED_FIELD");
  if (typeof role !== "string") return role;

  const expectedRole = kind === "implementation" ? "implementation" : "test-implementation";
  if (role !== expectedRole) {
    return fail(
      sourceLabel,
      "DOCUMENT_ROLE_MISMATCH",
      `Readiness input at "${sourceLabel}" declares kind "${kind}" with role "${role}", but role must be "${expectedRole}" for that kind.`,
      "role"
    );
  }

  const decision = requireEnum(input["decision"], READINESS_DECISIONS, "decision", sourceLabel, "UNKNOWN_READINESS_DECISION");
  if (typeof decision !== "string") return decision;

  const classification = requireEnum(
    input["classification"],
    READINESS_CLASSIFICATIONS,
    "classification",
    sourceLabel,
    "INVALID_LITERAL_VALUE"
  );
  if (typeof classification !== "string") return classification;

  const stageId = input["stageId"];
  if (typeof stageId !== "string" || stageId.length === 0) {
    return fail(sourceLabel, "MISSING_REQUIRED_FIELD", `Readiness input at "${sourceLabel}" is missing "stageId".`, "stageId");
  }

  const packetPath = input["packetPath"];
  const reportPath = input["reportPath"];
  if (typeof packetPath !== "string" || typeof reportPath !== "string") {
    return fail(sourceLabel, "MISSING_REQUIRED_FIELD", `Readiness input at "${sourceLabel}" must declare string "packetPath" and "reportPath".`);
  }

  const issuesRaw = input["issues"];
  if (!Array.isArray(issuesRaw) || !issuesRaw.every(isReadinessIssue)) {
    return fail(sourceLabel, "MALFORMED_ISSUE_STRUCTURE", `Readiness input at "${sourceLabel}" has a malformed "issues" array.`, "issues");
  }
  const issues = issuesRaw as ContextReadinessIssue[];

  const warningsRaw = input["warnings"];
  if (!Array.isArray(warningsRaw) || !warningsRaw.every((w) => typeof w === "string")) {
    return fail(sourceLabel, "INVALID_FIELD_TYPE", `Readiness input at "${sourceLabel}" must declare a string array "warnings".`, "warnings");
  }

  const blockingIssueCodesRaw = input["blockingIssueCodes"];
  if (!Array.isArray(blockingIssueCodesRaw) || !blockingIssueCodesRaw.every((c) => typeof c === "string")) {
    return fail(
      sourceLabel,
      "INVALID_FIELD_TYPE",
      `Readiness input at "${sourceLabel}" must declare a string array "blockingIssueCodes".`,
      "blockingIssueCodes"
    );
  }

  let primaryIssue: ContextReadinessIssue | undefined;
  if (input["primaryIssue"] !== undefined) {
    if (!isReadinessIssue(input["primaryIssue"])) {
      return fail(sourceLabel, "MALFORMED_ISSUE_STRUCTURE", `Readiness input at "${sourceLabel}" has a malformed "primaryIssue".`, "primaryIssue");
    }
    primaryIssue = input["primaryIssue"] as ContextReadinessIssue;
  }

  let blockerSummary: ContextReadinessBlockerSummary | undefined;
  if (input["blockerSummary"] !== undefined) {
    if (!isBlockerSummary(input["blockerSummary"])) {
      return fail(
        sourceLabel,
        "MALFORMED_ISSUE_STRUCTURE",
        `Readiness input at "${sourceLabel}" has a malformed "blockerSummary".`,
        "blockerSummary"
      );
    }
    blockerSummary = input["blockerSummary"] as ContextReadinessBlockerSummary;
  }

  const affectedResponsibilityIdsRaw = input["affectedResponsibilityIds"];
  if (!Array.isArray(affectedResponsibilityIdsRaw) || !affectedResponsibilityIdsRaw.every((id) => typeof id === "string")) {
    return fail(
      sourceLabel,
      "INVALID_FIELD_TYPE",
      `Readiness input at "${sourceLabel}" must declare a string array "affectedResponsibilityIds".`,
      "affectedResponsibilityIds"
    );
  }

  const evaluatedFreshness = requireEnum(
    input["evaluatedFreshness"],
    VALID_FRESHNESS_VALUES,
    "evaluatedFreshness",
    sourceLabel,
    "MISSING_REQUIRED_FIELD"
  );
  if (typeof evaluatedFreshness !== "string") return evaluatedFreshness;

  const evaluatedAdequacy = requireEnum(
    input["evaluatedAdequacy"],
    VALID_ADEQUACY_VALUES,
    "evaluatedAdequacy",
    sourceLabel,
    "MISSING_REQUIRED_FIELD"
  );
  if (typeof evaluatedAdequacy !== "string") return evaluatedAdequacy;

  const requiredEvidenceTruncated = requireEnum(
    input["requiredEvidenceTruncated"],
    VALID_TRUNCATION_VALUES,
    "requiredEvidenceTruncated",
    sourceLabel,
    "MISSING_REQUIRED_FIELD"
  );
  if (typeof requiredEvidenceTruncated !== "string") return requiredEvidenceTruncated;

  let declaredFreshness: DeclaredFreshness | undefined;
  if (input["declaredFreshness"] !== undefined) {
    const v = requireEnum(input["declaredFreshness"], VALID_FRESHNESS_VALUES, "declaredFreshness", sourceLabel, "INVALID_LITERAL_VALUE");
    if (typeof v !== "string") return v;
    declaredFreshness = v;
  }

  let declaredAdequacy: DeclaredAdequacy | undefined;
  if (input["declaredAdequacy"] !== undefined) {
    const v = requireEnum(input["declaredAdequacy"], VALID_ADEQUACY_VALUES, "declaredAdequacy", sourceLabel, "INVALID_LITERAL_VALUE");
    if (typeof v !== "string") return v;
    declaredAdequacy = v;
  }

  let responsibilityMappingsTruncated: DeclaredTruncation | undefined;
  if (input["responsibilityMappingsTruncated"] !== undefined) {
    const v = requireEnum(
      input["responsibilityMappingsTruncated"],
      VALID_TRUNCATION_VALUES,
      "responsibilityMappingsTruncated",
      sourceLabel,
      "INVALID_LITERAL_VALUE"
    );
    if (typeof v !== "string") return v;
    responsibilityMappingsTruncated = v;
  }

  const readyWithAssumptions = input["readyWithAssumptions"];
  if (typeof readyWithAssumptions !== "boolean") {
    return fail(sourceLabel, "INVALID_FIELD_TYPE", `Readiness input at "${sourceLabel}" must declare boolean "readyWithAssumptions".`, "readyWithAssumptions");
  }

  const provenanceSummary = input["provenanceSummary"];
  if (typeof provenanceSummary !== "string") {
    return fail(sourceLabel, "MISSING_REQUIRED_FIELD", `Readiness input at "${sourceLabel}" is missing string "provenanceSummary".`, "provenanceSummary");
  }

  const indexIdentity = input["indexIdentity"];
  if (indexIdentity !== undefined && (typeof indexIdentity !== "string" || indexIdentity.length === 0)) {
    return fail(sourceLabel, "MISSING_CANONICAL_IDENTITY", `Readiness input at "${sourceLabel}" declares a non-string or empty "indexIdentity".`, "indexIdentity");
  }

  const sourceCapsulePath = input["sourceCapsulePath"];
  const sourceAuditPath = input["sourceAuditPath"];
  if (sourceCapsulePath !== undefined && typeof sourceCapsulePath !== "string") {
    return fail(sourceLabel, "INVALID_FIELD_TYPE", `Readiness input at "${sourceLabel}" has non-string "sourceCapsulePath".`, "sourceCapsulePath");
  }
  if (sourceAuditPath !== undefined && typeof sourceAuditPath !== "string") {
    return fail(sourceLabel, "INVALID_FIELD_TYPE", `Readiness input at "${sourceLabel}" has non-string "sourceAuditPath".`, "sourceAuditPath");
  }

  const artifact: OrchestratorContextReadinessResultV1 = {
    schemaVersion,
    kind,
    role,
    decision,
    classification,
    stageId,
    packetPath,
    reportPath,
    sourceCapsulePath: sourceCapsulePath as string | undefined,
    sourceAuditPath: sourceAuditPath as string | undefined,
    issues,
    warnings: warningsRaw as string[],
    blockingIssueCodes: blockingIssueCodesRaw as string[],
    primaryIssue,
    blockerSummary,
    affectedResponsibilityIds: affectedResponsibilityIdsRaw as string[],
    declaredFreshness,
    evaluatedFreshness,
    declaredAdequacy,
    evaluatedAdequacy,
    requiredEvidenceTruncated,
    responsibilityMappingsTruncated,
    indexIdentity: indexIdentity as string | undefined,
    readyWithAssumptions,
    provenanceSummary
  };

  return {
    ok: true,
    artifactKind: ARTIFACT_KIND,
    sourcePath: sourceLabel,
    schemaVersion,
    schemaMajor: 1,
    artifact,
    rawArtifact: input as unknown as JsonObject
  };
}

// Bounded structural safety guard (section 12.8): flags when a readiness result's
// declared canonical identity does not match the supplemental document it is supposed
// to be describing. This is a structural/parse-level diagnostic only -- it never
// produces a lab-owned readiness verdict, never reruns contradiction policy, and never
// overrides the upstream decision/classification.
export type SupplementalReadinessIdentityDiagnostic = {
  code: "INCOMPATIBLE_ARTIFACT_IDENTITY";
  message: string;
  documentIndexIdentity: string;
  readinessIndexIdentity: string | undefined;
};

export function checkSupplementalReadinessIdentityConsistency(
  document: SupplementalContextDocumentV1,
  readiness: OrchestratorContextReadinessResultV1
): SupplementalReadinessIdentityDiagnostic | null {
  if (readiness.indexIdentity === undefined) return null;
  if (document.indexIdentity === readiness.indexIdentity) return null;
  return {
    code: "INCOMPATIBLE_ARTIFACT_IDENTITY",
    message: `Supplemental document index identity "${document.indexIdentity}" does not match readiness result index identity "${readiness.indexIdentity}".`,
    documentIndexIdentity: document.indexIdentity,
    readinessIndexIdentity: readiness.indexIdentity
  };
}
