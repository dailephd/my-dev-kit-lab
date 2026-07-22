export type SemanticRoleName =
  | "data-entity"
  | "data-field"
  | "canonical-type"
  | "schema-model"
  | "database-model"
  | "artifact-type"
  | "projection-type"
  | "view-model"
  | "ui-only-state"
  | "persistence-adapter"
  | "route-handler"
  | "react-component"
  | "client-component"
  | "server-component"
  | "test-block"
  | "test-fixture"
  | "browser-storage-payload"
  | "storage-key"
  | "rendered-field"
  | "unknown";

export type SemanticRoleSubtype =
  | "canonical-type"
  | "schema-model"
  | "database-model"
  | "artifact-type"
  | "projection-type"
  | "view-model"
  | "ui-only-state"
  | "persistence-adapter"
  | "route-handler"
  | "react-component"
  | "client-component"
  | "server-component"
  | "test-block"
  | "test-fixture"
  | "browser-storage-payload"
  | "storage-key"
  | "rendered-field"
  | "unknown"
  | (string & {});

export type SemanticRoleConfidence = "explicit" | "inferred-static" | "partial" | "unknown";

export type SemanticRoleSource =
  | "typescript-model-analyzer"
  | "model-view-lineage-analyzer"
  | "syntax-analyzer"
  | "call-graph-analyzer"
  | "manual"
  | "unknown"
  | (string & {});

export type SemanticArtifactKind =
  | "data-model"
  | "data-model-graph"
  | "model-view-lineage"
  | "symbol-index"
  | "code-graph"
  | "call-graph"
  | "unknown"
  | (string & {});

export type SemanticArtifactRef = {
  artifact: string;
  artifactKind?: SemanticArtifactKind | null;
  id: string;
  path?: string | null;
}

export type SemanticEvidenceRef = {
  filePath: string;
  symbolId?: string | null;
  line?: number | null;
  endLine?: number | null;
  source?: string | null;
  analyzer?: SemanticRoleSource | null;
}

export type SemanticRoleWarningKind =
  | "ambiguous-evidence"
  | "missing-artifact-ref"
  | "missing-source-ref"
  | "partial-classification"
  | "unsupported-pattern"
  | "unknown";

export type SemanticRoleWarning = {
  kind: SemanticRoleWarningKind;
  message: string;
  artifactRefs?: SemanticArtifactRef[];
  evidenceRefs?: SemanticEvidenceRef[];
}

export type SemanticRole = {
  role: SemanticRoleName;
  subtype?: SemanticRoleSubtype | null;
  confidence: SemanticRoleConfidence;
  source: SemanticRoleSource;
  artifactRefs?: SemanticArtifactRef[];
  evidenceRefs?: SemanticEvidenceRef[];
  warnings?: SemanticRoleWarning[];
}
