import type { SemanticEvidenceRef } from "./myDevKitSemanticTypesV1.js";

export type ClassificationRoleName =
  | "canonical-type"
  | "artifact-type"
  | "database-model"
  | "projection-type"
  | "view-model"
  | "ui-only-state"
  | "test-fixture"
  | "persistence-adapter"
  | "route-handler"
  | "client-component"
  | "server-component"
  | "generated-file"
  | "configuration-file"
  | "command-handler"
  | "analyzer"
  | "validator"
  | "public-docs"
  | "internal-planning-docs"
  | (string & {});

export type EditGuidance =
  | "safe-primary-edit-target"
  | "inspect-before-edit"
  | "avoid-primary-edit-target"
  | "read-only-reference"
  | "generated-do-not-edit"
  | "test-only"
  | "docs-only"
  | "uncertain";

export type Readiness = "ready" | "needs-more-context" | "risky-assumption";

export type RiskLabel =
  | "wrong-layer-risk"
  | "unreachable-ui-risk"
  | "requires-test-validation"
  | "requires-browser-validation"
  | "generated-file-risk"
  | "public-contract-risk"
  | "migration-risk";

export type UncertaintyTier = "certain" | "likely" | "possible" | "unknown";

/** Reuses SemanticEvidenceRef's shape verbatim (file path + line/endLine pointer). */
export type SourceRef = SemanticEvidenceRef;

export type ClassificationRole = {
  role: ClassificationRoleName;
  subtype?: string | null;
  confidence: UncertaintyTier;
}

/** Compact projection of ClassificationRole embedded on CodeGraphNode/GraphSymbolRecord. */
export type ClassificationRoleRef = {
  role: ClassificationRoleName;
  editGuidance: EditGuidance;
  readiness: Readiness;
  uncertainty: UncertaintyTier;
}
