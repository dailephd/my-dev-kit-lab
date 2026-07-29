// Lab-owned structural mirror of the frozen my-dev-kit-orchestrator supplemental
// repository-context document vocabulary (commit bc08a05d3b52a629e7e4504372af199c324c4ae4,
// src/instructions/supplementalContextTypes.ts). The lab never imports orchestrator
// runtime code; this file only restates the frozen vocabulary needed to validate and
// preserve documents the orchestrator already writes.

export const SUPPLEMENTAL_CONTEXT_PACKET_SCHEMA_SUPPORTED_MAJOR = 1;
export const SUPPLEMENTAL_CONTEXT_RETRIEVAL_REPORT_SCHEMA_SUPPORTED_MAJOR = 1;

export type SupplementalContextDocumentKind =
  | "implementation-context-packet"
  | "implementation-context-retrieval-report"
  | "test-context-packet"
  | "test-context-retrieval-report";

export type SupplementalContextRole = "implementation" | "test-implementation";

export type SupplementalContextDeclaredStatus = "template" | "populated";

export type DeclaredFreshness = "fresh" | "stale" | "unknown";

export type DeclaredAdequacy =
  | "sufficient"
  | "sufficient-with-assumptions"
  | "insufficient"
  | "conflict"
  | "unknown";

export type DeclaredTruncation = "yes" | "no" | "unknown";

export type RepositoryScope = "single-repository" | "source-target";

export const ROLE_BY_DOCUMENT_KIND: Record<SupplementalContextDocumentKind, SupplementalContextRole> = {
  "implementation-context-packet": "implementation",
  "implementation-context-retrieval-report": "implementation",
  "test-context-packet": "test-implementation",
  "test-context-retrieval-report": "test-implementation"
};

export function isRetrievalReportKind(kind: SupplementalContextDocumentKind): boolean {
  return kind === "implementation-context-retrieval-report" || kind === "test-context-retrieval-report";
}

export function isTestKind(kind: SupplementalContextDocumentKind): boolean {
  return kind === "test-context-packet" || kind === "test-context-retrieval-report";
}

const COMMON_PACKET_METADATA = [
  "Schema version",
  "Document kind",
  "Role",
  "Status",
  "Repository scope",
  "Freshness",
  "Adequacy",
  "Required evidence truncated",
  "Context capsule schema version",
  "Retrieval audit schema version",
  "Tool name",
  "Tool version",
  "Index identity"
] as const;

const COMMON_REPORT_METADATA = [
  "Schema version",
  "Document kind",
  "Role",
  "Status",
  "Repository scope",
  "Request schema version",
  "Context capsule schema version",
  "Retrieval audit schema version",
  "Tool name",
  "Tool version",
  "Index identity",
  "Freshness",
  "Adequacy",
  "Required evidence truncated",
  "Full-file fallback used",
  "Determinism checked"
] as const;

const TEST_ONLY_METADATA = ["Responsibility mappings truncated", "Critical responsibility mapping status"] as const;

export const REQUIRED_METADATA_BY_DOCUMENT_KIND: Record<SupplementalContextDocumentKind, readonly string[]> = {
  "implementation-context-packet": COMMON_PACKET_METADATA,
  "implementation-context-retrieval-report": COMMON_REPORT_METADATA,
  "test-context-packet": [...COMMON_PACKET_METADATA, ...TEST_ONLY_METADATA],
  "test-context-retrieval-report": [...COMMON_REPORT_METADATA, ...TEST_ONLY_METADATA]
};

export const REQUIRED_SECTIONS_BY_DOCUMENT_KIND: Record<SupplementalContextDocumentKind, readonly string[]> = {
  "implementation-context-packet": [
    "Focus",
    "Selected owners",
    "Dependencies",
    "Contracts",
    "Validators",
    "Constants",
    "Errors",
    "Schemas",
    "Callers and callees",
    "Closest tests",
    "Test infrastructure",
    "Test commands",
    "Unresolved items",
    "Budget and truncation",
    "Full-file fallback",
    "Provenance",
    "Assumptions",
    "Notes"
  ],
  "implementation-context-retrieval-report": [
    "Retrieval request",
    "Command record",
    "Focus selection",
    "Candidate and owner selection",
    "Evidence groups",
    "Unresolved evidence",
    "Adequacy evaluation",
    "Freshness classification",
    "Budget",
    "Truncation",
    "Full-file fallback",
    "Provenance",
    "Warnings",
    "Determinism",
    "Assumptions",
    "Notes"
  ],
  "test-context-packet": [
    "Changed surface",
    "Production owners",
    "Production contracts",
    "Validators",
    "Constants",
    "Errors",
    "Schemas",
    "Closest tests",
    "Test infrastructure",
    "Test commands",
    "Test responsibilities",
    "Responsibility mappings",
    "Reusable test helpers",
    "Oracle evidence",
    "Unresolved items",
    "Budget and truncation",
    "Full-file fallback",
    "Provenance",
    "Assumptions",
    "Notes"
  ],
  "test-context-retrieval-report": [
    "Retrieval request",
    "Command record",
    "Changed-surface selection",
    "Production-owner selection",
    "Test-infrastructure discovery",
    "Test-command discovery",
    "Responsibility mapping",
    "Criticality overlay",
    "Adequacy evaluation",
    "Freshness classification",
    "Budget",
    "Truncation",
    "Full-file fallback",
    "Provenance",
    "Warnings",
    "Determinism",
    "Assumptions",
    "Notes"
  ]
};

export const VALID_REPOSITORY_SCOPES: readonly RepositoryScope[] = ["single-repository", "source-target"];
export const VALID_DECLARED_STATUSES: readonly SupplementalContextDeclaredStatus[] = ["template", "populated"];
export const VALID_FRESHNESS_VALUES: readonly DeclaredFreshness[] = ["fresh", "stale", "unknown"];
export const VALID_ADEQUACY_VALUES: readonly DeclaredAdequacy[] = [
  "sufficient",
  "sufficient-with-assumptions",
  "insufficient",
  "conflict",
  "unknown"
];
export const VALID_TRUNCATION_VALUES: readonly DeclaredTruncation[] = ["yes", "no", "unknown"];

// Structural shape shared by all four document kinds. Section and metadata bodies are
// preserved verbatim (never re-parsed, never interpreted) -- Batch 1 classifies documents
// structurally only; it never evaluates whether a declared value is true.
export type SupplementalContextDocumentV1 = {
  documentKind: SupplementalContextDocumentKind;
  role: SupplementalContextRole;
  schemaVersion: string;
  schemaMajor: 1;
  status: SupplementalContextDeclaredStatus;
  repositoryScope: RepositoryScope;
  freshness: DeclaredFreshness;
  adequacy: DeclaredAdequacy;
  requiredEvidenceTruncated: DeclaredTruncation;
  contextCapsuleSchemaVersion: string;
  retrievalAuditSchemaVersion: string;
  toolName: string;
  toolVersion: string;
  // Canonical repository/index identity anchor declared by the document.
  indexIdentity: string;
  // Report-only metadata (undefined for packet kinds).
  requestSchemaVersion?: string;
  fullFileFallbackUsed?: DeclaredTruncation;
  determinismChecked?: DeclaredTruncation;
  // Test-only metadata (undefined for implementation kinds). The declared status string is
  // preserved verbatim and is never validated against the orchestrator's internal
  // CriticalResponsibilityMappingState enum -- that enum is computed from the orchestrator's
  // own TestStrategyPacket criticality overlay, a different, non-file-based concept that
  // Batch 1 must not reimplement.
  responsibilityMappingsTruncated?: DeclaredTruncation;
  criticalResponsibilityMappingStatus?: string;
  // Verbatim "Key: value" metadata lines, including any unknown/additive keys, in source order.
  rawMetadata: Record<string, string>;
  // Verbatim "## Heading" section bodies, including any unknown/additive sections, in source order.
  sections: Record<string, string>;
  sectionOrder: string[];
  metadataOrder: string[];
  warnings: string[];
};

export type ImplementationContextPacketV1 = SupplementalContextDocumentV1 & {
  documentKind: "implementation-context-packet";
};
export type ImplementationContextRetrievalReportV1 = SupplementalContextDocumentV1 & {
  documentKind: "implementation-context-retrieval-report";
};
export type TestContextPacketV1 = SupplementalContextDocumentV1 & { documentKind: "test-context-packet" };
export type TestContextRetrievalReportV1 = SupplementalContextDocumentV1 & {
  documentKind: "test-context-retrieval-report";
};
