import type {
  ClassificationRole,
  ClassificationRoleRef,
  EditGuidance,
  Readiness,
  RiskLabel,
  SourceRef,
  UncertaintyTier
} from "./myDevKitClassificationTypesV1.js";
import type { SemanticArtifactRef, SemanticEvidenceRef, SemanticRole } from "./myDevKitSemanticTypesV1.js";

export type ContextCapsuleMode = "general" | "feature-add" | "subsystem";

export type ContextRole = "architecture" | "implementation" | "test-implementation";

export type RequestedEvidenceKind =
  | "owner"
  | "dependencies"
  | "contracts"
  | "validators"
  | "constants"
  | "errors"
  | "schemas"
  | "callers"
  | "callees"
  | "closest-tests"
  | "test-infrastructure"
  | "test-commands"
  | "changed-surface"
  | "responsibility-mappings";

export type ContextCapsuleTool = {
  name: string;
  version: string;
}

export type ContextCapsuleRequest = {
  originalQuery: string;
  normalizedQuery: string;
  mode: ContextCapsuleMode;
  requestedOutputPath: string;
  role: ContextRole | null;
  requestFilePath: string | null;
}

export type ContextCapsuleArtifactRef = {
  name: string;
  path: string;
}

export type ContextCapsuleIndex = {
  indexPath: string;
  manifestPath: string;
  manifestSchemaVersion?: string;
  projectRoot?: string;
  artifactRefs: ContextCapsuleArtifactRef[];
}

export type ContextCapsuleLimits = {
  maxCandidateFiles: number | null;
  maxSourceSlices: number | null;
  maxGraphNodes: number | null;
  maxGraphEdges: number | null;
}

export type ContextEntryKind =
  | "request-summary"
  | "index-summary"
  | "artifact-summary"
  | "placeholder"
  | "focus-summary"
  | "selected-graph-summary"
  | "selected-source-summary"
  | "semantic-summary"
  | "classification-summary"
  | "conflict-summary";

export type ContextEntryEvidenceRef = {
  path: string;
}

export type ContextEntry = {
  id: string;
  kind: ContextEntryKind;
  title: string;
  reason: string;
  evidenceRefs: ContextEntryEvidenceRef[];
  classificationRefs?: SourceRef[];
  classificationRoles?: ClassificationRole[];
  warnings: string[];
}

export type DroppedContextEntry = {
  id: string;
  kind: ContextEntryKind;
  title: string;
  reason: string;
}

export type ContextAdequacyStatus =
  | "context sufficient for implementation"
  | "context sufficient with listed assumptions"
  | "context insufficient and more retrieval required"
  | "context conflict found and user or upstream stage decision required";

export type ContextAdequacyStatement = {
  status: ContextAdequacyStatus;
  summary: string;
  assumptions: string[];
  gaps: string[];
}

export type QueryTerms = {
  raw: string[];
  quotedPhrases: string[];
  pathLike: string[];
  symbolLike: string[];
  routeLike: string[];
  commandLike: string[];
  artifactLike: string[];
  classificationLike: string[];
}

export type QueryPlan = {
  originalQuery: string;
  normalizedQuery: string;
  mode: ContextCapsuleMode;
  searchQueries: string[];
  terms: QueryTerms;
}

export type ChangedSurfaceStatus = "added" | "modified" | "removed" | "unknown";

export type CandidateFile = {
  path: string;
  score: number;
  baseScore?: number;
  modeAdjustment?: number;
  reasons: string[];
  matchedTerms: string[];
  semanticRoles?: SemanticRole[];
  artifactRefs?: SemanticArtifactRef[];
  classificationRoles?: ClassificationRoleRef[];
  classificationRefs?: SemanticArtifactRef[];
  retained: boolean;
  droppedReason?: string;
  roleScoreAdjustment?: number;
  contextRole?: ContextRole;
  focusMatch?: boolean;
  changedSurfaceMatch?: boolean;
  changedStatus?: ChangedSurfaceStatus;
}

export type CandidateNode = {
  nodeId: string;
  kind: "file" | "symbol" | (string & {});
  label: string;
  filePath?: string;
  score: number;
  baseScore?: number;
  modeAdjustment?: number;
  reasons: string[];
  matchedTerms: string[];
  semanticRoles?: SemanticRole[];
  artifactRefs?: SemanticArtifactRef[];
  classificationRoles?: ClassificationRoleRef[];
  classificationRefs?: SemanticArtifactRef[];
  androidArtifactId?: string;
  androidMetadata?: Record<string, string | number | boolean | null>;
  retained: boolean;
  droppedReason?: string;
  roleScoreAdjustment?: number;
  contextRole?: ContextRole;
  focusMatch?: boolean;
  changedSurfaceMatch?: boolean;
  changedStatus?: ChangedSurfaceStatus;
  synthesized?: boolean;
}

export type FocusSelectionMode = "none" | "single-best" | "best-effort-ambiguous";
export type FocusConfidence = "high" | "medium" | "low" | "none";

export type ContextFocus = {
  focusNodeId: string | null;
  focusFilePath: string | null;
  selectionMode: FocusSelectionMode;
  confidence: FocusConfidence;
  reasons: string[];
  ambiguityNotes: string[];
  warnings: string[];
}

export type SelectedGraphNode = {
  nodeId: string;
  kind: string;
  label: string;
  filePath?: string;
  reasons: string[];
}

export type SelectedGraphEdge = {
  from: string;
  to: string;
  kind: string;
  reasons: string[];
}

export type SelectedGraph = {
  nodes: SelectedGraphNode[];
  edges: SelectedGraphEdge[];
  omittedNodeCount: number;
  omittedEdgeCount: number;
  warnings: string[];
}

export type RetentionCapSettings = {
  maxCandidateFiles: number | null;
  maxGraphNodes: number | null;
  maxGraphEdges: number | null;
}

export type RetentionSummary = {
  retainedCandidateCount: number;
  droppedCandidateCount: number;
  retainedGraphNodeCount: number;
  droppedGraphNodeCount: number;
  retainedGraphEdgeCount: number;
  droppedGraphEdgeCount: number;
  capSettings: RetentionCapSettings;
}

export type SourceRetrievalMethod =
  | "node"
  | "symbol"
  | "line-range"
  | "contains"
  | "react-region"
  | "local-component-tree"
  | "local-dependency-expansion"
  | "continuation";

export type SourceIncludedBy = "primary-focus" | "selected-graph";

export type SelectedSourceSlice = {
  id: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  nodeId?: string;
  symbolName?: string | null;
  reason: string;
  sourceRetrievalMethod: SourceRetrievalMethod;
  includedBy: SourceIncludedBy;
  truncated: boolean;
  continuationAvailable?: boolean;
  continuationUsed: boolean;
  localExpansionUsed: boolean;
  classificationRefs?: SemanticArtifactRef[];
  semanticRefs?: SemanticArtifactRef[];
  warnings: string[];
}

export type SkippedSourceEntry = {
  id: string;
  kind: string;
  filePath?: string;
  reason: string;
  capType?: string;
  candidateScore?: number;
}

export type SelectedSource = {
  slices: SelectedSourceSlice[];
  omittedSliceCount: number;
  totalSelectedLines: number;
  maxSourceSlices: number;
  warnings: string[];
  skipped: SkippedSourceEntry[];
}

export type SelectedSourceBundleBlock = {
  id: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName?: string | null;
  reason: string;
  includedBy: string;
  truncated: boolean;
  warnings: string[];
}

export type SelectedSourceBundleSkippedBlock = {
  id: string;
  kind: string;
  filePath?: string;
  reason: string;
  capType?: string;
  candidateScore?: number;
}

export type SelectedSourceBundle = {
  id: string;
  title: string;
  focusNodeId?: string;
  focusFilePath: string | null;
  reason: string;
  blocks: SelectedSourceBundleBlock[];
  totalLines: number;
  maxLines: number;
  skippedBlocks: SelectedSourceBundleSkippedBlock[];
  warnings: string[];
}

export type SelectedSourceBundles = {
  bundles: SelectedSourceBundle[];
  omittedBundleCount: number;
  totalSelectedLines: number;
  warnings: string[];
}

export type SemanticSummaryEntry = {
  roles: SemanticRole[];
  artifactRefs: SemanticArtifactRef[];
  evidenceRefs: SemanticEvidenceRef[];
}

export type SemanticSummary = {
  available: boolean;
  roles: SemanticRole[];
  artifactRefs: SemanticArtifactRef[];
  evidenceRefs: SemanticEvidenceRef[];
  summariesByNode: Record<string, SemanticSummaryEntry>;
  summariesByFile: Record<string, SemanticSummaryEntry>;
  warnings: string[];
}

export type ClassificationSummaryEntry = {
  classifications: ClassificationRole[];
  editGuidance: EditGuidance;
  readiness: Readiness;
  risks: RiskLabel[];
  uncertainty: UncertaintyTier;
  warnings: string[];
}

export type ClassificationSummary = {
  available: boolean;
  classificationArtifactPath: string | null;
  roles: ClassificationRole[];
  refs: SourceRef[];
  editGuidance: EditGuidance[];
  readiness: Readiness[];
  riskLabels: RiskLabel[];
  uncertainty: UncertaintyTier[];
  summariesByNode: Record<string, ClassificationSummaryEntry>;
  summariesByFile: Record<string, ClassificationSummaryEntry>;
  warnings: string[];
}

export type ArtifactReferenceSummaryEntry = {
  artifactKind: string;
  artifactPath: string | null;
  available: boolean;
  reason: string;
  warnings: string[];
}

export type PruningCounts = {
  candidateFiles: number;
  candidateNodes: number;
  graphNodes: number;
  graphEdges: number;
  sourceSlices: number;
  sourceBundles: number;
}

export type PruningCapSettings = {
  maxCandidateFiles: number | null;
  maxGraphNodes: number | null;
  maxGraphEdges: number | null;
  maxSourceSlices: number;
}

export type PruningSummary = {
  policyVersion: "1.0.0";
  retainedCounts: PruningCounts;
  droppedCounts: PruningCounts;
  capSettings: PruningCapSettings;
  retainedReasons: string[];
  droppedReasons: string[];
  warnings: string[];
}

export type ModeEffect = {
  candidateId: string;
  adjustment: number;
  reasons: string[];
}

export type ModeEffects = {
  mode: ContextCapsuleMode;
  applied: boolean;
  effects: ModeEffect[];
  warnings: string[];
}

export type SourceControl = {
  enabled: boolean;
  reason: string;
}

export type ContextConflictCandidate = {
  nodeId: string;
  filePath: string | null;
  score: number;
  editGuidance: EditGuidance[];
}

export type ContextConflict = {
  id: string;
  status: "conflict";
  reason: string;
  evidenceRefs: string[];
  affectedFiles: string[];
  affectedNodes: string[];
  candidates: ContextConflictCandidate[];
  recommendedNextAction: string;
}

export type ContextConflictSummary = {
  status: "none" | "conflict";
  conflicts: ContextConflict[];
  warnings: string[];
}

export type FocusFileResolution = {
  path: string;
  resolved: boolean;
  matchedFilePaths: string[];
  containedSymbolIds: string[];
}

export type FocusSymbolResolution = {
  symbol: string;
  resolved: boolean;
  ambiguous: boolean;
  matchedNodeIds: string[];
}

export type ContextFocusIntake = {
  focusFiles: FocusFileResolution[];
  focusSymbols: FocusSymbolResolution[];
  unresolvedFocusFiles: string[];
  unresolvedFocusSymbols: string[];
  ambiguousFocusSymbols: string[];
  warnings: string[];
}

export type ChangedSurfaceProvenance = "caller" | "graph-diff" | "both";

export type ChangedFileEntry = {
  path: string;
  status: ChangedSurfaceStatus;
  provenance: ChangedSurfaceProvenance;
}

export type ChangedSymbolEntry = {
  symbolId: string;
  status: ChangedSurfaceStatus;
  provenance: ChangedSurfaceProvenance;
  filePath?: string;
  name?: string;
  kind?: string;
}

export type ChangedSurface = {
  available: boolean;
  diffRequested: boolean;
  files: ChangedFileEntry[];
  symbols: ChangedSymbolEntry[];
  conflicts: string[];
  warnings: string[];
}

export type RoleContextSummary = {
  role: ContextRole | null;
  focus: ContextFocusIntake;
  changedSurface: ChangedSurface;
  requestedEvidenceKinds: RequestedEvidenceKind[];
  unsupportedRequestedEvidenceKinds: RequestedEvidenceKind[];
  warnings: string[];
}

export type EvidenceGroupKind =
  | "owners"
  | "extension-points"
  | "contracts"
  | "graph-neighborhood"
  | "architecture-tests"
  | "dependencies"
  | "callers-and-callees"
  | "validators-and-constants"
  | "errors"
  | "schemas-and-serializers"
  | "compatibility-surfaces"
  | "closest-tests"
  | "changed-surface"
  | "production-symbols"
  | "validators-and-boundaries"
  | "errors-and-side-effects"
  | "related-tests"
  | "fixtures"
  | "factories"
  | "mocks"
  | "setup-and-configuration"
  | "test-commands"
  | "unresolved-evidence";

export type EvidenceItemKind =
  | "file"
  | "symbol"
  | "test-file"
  | "fixture"
  | "factory"
  | "mock"
  | "setup-file"
  | "config-file"
  | "package-script"
  | "command";

export type EvidenceItemSourceLocation = {
  filePath: string;
  line?: number;
}

export type EvidenceItemRef = {
  id: string;
  itemKind: EvidenceItemKind;
  path?: string;
  symbolId?: string;
  nodeId?: string;
  sourceLocation?: EvidenceItemSourceLocation;
  relationship: string;
  basis: string;
  provenance: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export type UnresolvedEvidenceItem = {
  evidenceKind: string;
  role: ContextRole | null;
  basis: string;
  reason: string;
  blocking: boolean;
}

export type EvidenceGroup = {
  id: string;
  kind: EvidenceGroupKind;
  role: ContextRole | null;
  title: string;
  required: boolean;
  items: EvidenceItemRef[];
  unresolved: UnresolvedEvidenceItem[];
  warnings: string[];
  limit: number | null;
  availableCount: number;
  usedCount: number;
  truncated: boolean;
  droppedCount: number;
  provenance: string;
}

export type TestConfigurationEvidenceEntry = {
  path: string;
  framework: string;
  supported: boolean;
  fields: Record<string, string | number | boolean | string[] | null>;
  warnings: string[];
}

export type PackageScriptEvidenceEntry = {
  name: string;
  command: string;
  reason: string;
  packageJsonPath: string;
}

export type TestCommandScope = "file" | "directory" | "suite" | "full-project";

export type TestCommandEvidenceEntry = {
  commandText: string | null;
  commandSource: string;
  testFiles: string[];
  framework: string | null;
  scope: TestCommandScope;
  basis: string;
  unresolvedReason?: string;
}

export type TestInfrastructureSummary = {
  relatedTests: EvidenceItemRef[];
  fixtures: EvidenceItemRef[];
  factories: EvidenceItemRef[];
  mocks: EvidenceItemRef[];
  setupFiles: EvidenceItemRef[];
  testConfigurations: TestConfigurationEvidenceEntry[];
  packageScripts: PackageScriptEvidenceEntry[];
  testCommands: TestCommandEvidenceEntry[];
  unresolved: UnresolvedEvidenceItem[];
  warnings: string[];
}

export type GroupTruncationEntry = {
  groupId: string;
  limit: number | null;
  availableCount: number;
  usedCount: number;
  truncated: boolean;
  droppedCount: number;
}

export type ResponsibilityCriticality = "critical" | "noncritical";

export type ResponsibilityMappingStatus = "mapped" | "partially-mapped" | "unmapped" | "not-applicable";

export type ProvenanceCategory =
  | "request"
  | "cli"
  | "request-file"
  | "focus-file"
  | "focus-symbol"
  | "caller-changed-file"
  | "caller-changed-symbol"
  | "graph-diff"
  | "active-index"
  | "before-index"
  | "after-index"
  | "code-graph"
  | "symbol-index"
  | "source-scan"
  | "test-directory-walk"
  | "import-scan"
  | "package-json"
  | "test-configuration"
  | "upstream-artifact-ref";

export type ProvenanceRecord = {
  id: string;
  category: ProvenanceCategory;
  sourcePath: string | null;
  sourceId: string | null;
  evidenceId: string;
  relationshipBasis: string;
  role: ContextRole | null;
  requestField: string | null;
  derivedByModule: string;
}

export type ResponsibilityMapping = {
  responsibilityId: string;
  behavior: string | null;
  invariant: string | null;
  criticality: ResponsibilityCriticality;
  productionSymbols: EvidenceItemRef[];
  contracts: EvidenceItemRef[];
  validators: EvidenceItemRef[];
  constants: EvidenceItemRef[];
  errors: EvidenceItemRef[];
  sideEffectEvidence: EvidenceItemRef[];
  proposedOrExistingTestFiles: EvidenceItemRef[];
  reusableHelpers: EvidenceItemRef[];
  oracleEvidence: EvidenceItemRef[];
  testCommands: EvidenceItemRef[];
  mappingStatus: ResponsibilityMappingStatus;
  unresolvedReasons: string[];
  provenance: ProvenanceRecord[];
  warnings: string[];
}

export type ResponsibilityMappingSummary = {
  requested: boolean;
  operational: boolean;
  mappings: ResponsibilityMapping[];
  unknownResponsibilityIds: string[];
  duplicateResponsibilityIds: string[];
  limit: number | null;
  availableCount: number;
  usedCount: number;
  truncated: boolean;
  droppedCount: number;
  criticalDropped: boolean;
  warnings: string[];
}

export type FreshnessComparedIdentity = {
  label: string;
  value: string | null;
}

export type FreshnessState = "fresh" | "stale" | "unknown";

export type FreshnessSummary = {
  state: FreshnessState;
  role: ContextRole | null;
  evidenceUsed: string[];
  evidenceUnavailable: string[];
  comparedIdentities: FreshnessComparedIdentity[];
  reason: string;
  relevantChangedPaths: string[];
  warnings: string[];
}

export type BudgetLimitUsage = {
  name: string;
  declaredValue: number | null;
  usedValue: number;
  availableCount: number | null;
  droppedCount: number | null;
  truncated: boolean;
  requiredEvidenceAffected: boolean;
  adequacyImpact: string | null;
}

export type BudgetCharacterUsage = {
  measured: number;
  limit: number | null;
  truncated: boolean;
}

export type BudgetSummary = {
  limits: BudgetLimitUsage[];
  characters: BudgetCharacterUsage | null;
  warnings: string[];
}

export type TruncationRecord = {
  id: string;
  affectedGroup: string;
  limit: number | null;
  used: number;
  available: number;
  droppedCount: number;
  droppedEvidenceIds: string[];
  requiredEvidenceLost: boolean;
  adequacyImpact: string | null;
  reason: string;
}

export type TruncationSummary = {
  truncated: boolean;
  records: TruncationRecord[];
  warnings: string[];
}

export type FullFileFallbackRecord = {
  id: string;
  filePath: string;
  reason: string;
  requestedEvidenceKind: string | null;
  boundedRetrievalAttempted: boolean;
  sourceRangesAttempted: number;
  includedLineCount: number;
  includedCharacterCount: number;
  role: ContextRole | null;
  responsibilityIdsAffected: string[];
  allowed: boolean;
  provenance: string;
}

export type FullFileFallbackSummary = {
  enabled: boolean;
  limit: number | null;
  used: number;
  fallbacks: FullFileFallbackRecord[];
  warnings: string[];
}

export type RoleAdequacyStatement = {
  role: ContextRole | null;
  status: ContextAdequacyStatus;
  requiredConditions: string[];
  satisfiedConditions: string[];
  missingConditions: string[];
  blockingConditions: string[];
  warnings: string[];
  supportingEvidence: string[];
  affectedResponsibilityIds: string[];
  truncationImpact: boolean;
  freshnessImpact: boolean;
}

export type ContextCapsule = {
  schemaVersion: "1.0.0";
  generatedAt: string;
  tool: ContextCapsuleTool;
  request: ContextCapsuleRequest;
  index: ContextCapsuleIndex;
  limits: ContextCapsuleLimits;
  requiredContext: ContextEntry[];
  optionalSupportContext: ContextEntry[];
  droppedContext: DroppedContextEntry[];
  warnings: string[];
  contextAdequacy: ContextAdequacyStatement;
  queryPlan: QueryPlan;
  candidateFiles: CandidateFile[];
  candidateNodes: CandidateNode[];
  focus: ContextFocus;
  selectedGraph: SelectedGraph;
  retention: RetentionSummary;
  selectedSource: SelectedSource;
  selectedSourceBundles: SelectedSourceBundles;
  semanticSummary: SemanticSummary;
  classificationSummary: ClassificationSummary;
  artifactReferenceSummary: ArtifactReferenceSummaryEntry[];
  pruning: PruningSummary;
  conflicts: ContextConflictSummary;
  modeEffects: ModeEffects;
  sourceControl: SourceControl;
  deferredRequestFields: string[];
  roleContext: RoleContextSummary;
  evidenceGroups: EvidenceGroup[];
  selectedOwners: EvidenceItemRef[];
  selectedContracts: EvidenceItemRef[];
  selectedTests: EvidenceItemRef[];
  testInfrastructure: TestInfrastructureSummary;
  unresolvedItems: UnresolvedEvidenceItem[];
  groupTruncation: GroupTruncationEntry[];
  responsibilityMappings: ResponsibilityMappingSummary;
  roleAdequacy: RoleAdequacyStatement;
  freshness: FreshnessSummary;
  budget: BudgetSummary;
  truncation: TruncationSummary;
  fullFileFallback: FullFileFallbackSummary;
  provenance: ProvenanceRecord[];
};

export type AuditStepKind =
  | "validate-inputs"
  | "load-manifest"
  | "inspect-artifacts"
  | "write-context-capsule"
  | "write-retrieval-audit-record"
  | "normalize-query"
  | "extract-query-terms"
  | "run-search"
  | "rank-candidate-files"
  | "rank-candidate-nodes"
  | "select-primary-focus"
  | "inspect-primary-focus"
  | "select-graph-neighborhood"
  | "apply-caps"
  | "record-retained-and-dropped-context"
  | "derive-source-targets"
  | "select-source-slices"
  | "select-source-bundles"
  | "apply-source-caps"
  | "use-source-continuation"
  | "use-local-source-expansion"
  | "inspect-semantic-metadata"
  | "inspect-classification-metadata"
  | "inspect-artifact-references"
  | "assemble-required-context"
  | "assemble-optional-support-context"
  | "assemble-dropped-context"
  | "apply-pruning-policy"
  | "update-context-adequacy"
  | "apply-mode-ranking-adjustment"
  | "detect-context-conflicts"
  | "skip-source-evidence"
  | "resolve-focus"
  | "merge-changed-surface"
  | "apply-role-ranking"
  | "build-evidence-groups"
  | "discover-test-infrastructure"
  | "derive-test-commands"
  | "map-responsibilities"
  | "evaluate-adequacy"
  | "classify-freshness"
  | "apply-budget"
  | "record-provenance";

export type AuditStepStatus = "ok" | "skipped" | "failed";

export type AuditStep = {
  id: string;
  kind: AuditStepKind;
  description: string;
  inputs: Record<string, string | number | boolean | null>;
  outputs: Record<string, string | number | boolean | null>;
  status: AuditStepStatus;
  warnings: string[];
}

export type FullFileReadRecommendation = {
  filePath: string;
  reason: string;
  missingContext: string;
  continuationOrExpansionAttempted: boolean | "unavailable";
}

export type RetrievalAuditRecordIndex = {
  indexPath: string;
  manifestPath: string;
}

export type RetrievalAuditRecord = {
  schemaVersion: "1.0.0";
  generatedAt: string;
  tool: ContextCapsuleTool;
  request: ContextCapsuleRequest;
  index: RetrievalAuditRecordIndex;
  steps: AuditStep[];
  fallbacks: string[];
  fullFileReadRecommendations: FullFileReadRecommendation[];
  warnings: string[];
  contextAdequacy: ContextAdequacyStatement;
  roleContext: RoleContextSummary;
  responsibilityMappings: ResponsibilityMappingSummary;
  roleAdequacy: RoleAdequacyStatement;
  freshness: FreshnessSummary;
  budget: BudgetSummary;
  truncation: TruncationSummary;
  fullFileFallback: FullFileFallbackSummary;
  provenance: ProvenanceRecord[];
};
