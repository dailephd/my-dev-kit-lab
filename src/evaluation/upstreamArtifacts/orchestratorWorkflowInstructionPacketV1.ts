export type WorkflowInstructionId = `workflow.${string}`;
export type StageInstructionId = `stage.${string}.${string}`;
export type CommandInstructionId = `command.${string}.${string}`;
export type RuleInstructionId = `rule.${string}.${string}`;
export type ReportContractId = `report.${string}`;

export type CatalogEntryKind = "workflow" | "stage" | "command" | "rule" | "report-contract";

export type CatalogEntryBase = {
  id: string;
  kind: CatalogEntryKind;
  title: string;
  description: string;
};

export type CommandSideEffect = "read-only" | "writes-workspace" | "modifies-project" | "external-state";

export type CommandCatalogEntry = Omit<CatalogEntryBase, "kind" | "id"> & {
  kind: "command";
  id: CommandInstructionId;
  owner: string;
  command: string;
  purpose: string;
  sideEffect: CommandSideEffect;
};

export type RuleCatalogEntry = Omit<CatalogEntryBase, "kind" | "id"> & {
  kind: "rule";
  id: RuleInstructionId;
  category: string;
  instruction: string;
  ruleRefs: RuleInstructionId[];
};

export type ReportContractCatalogEntry = Omit<CatalogEntryBase, "kind" | "id"> & {
  kind: "report-contract";
  id: ReportContractId;
  artifactKind: string;
  purpose: string;
  requiredOutputCategory: string;
};

export type ResolutionProvenanceEntry = {
  rootWorkflowId: WorkflowInstructionId;
  rootStageId: StageInstructionId;
  sourceEntryId: string;
  referenceField: string;
  referencedEntryId: string;
  inclusionReason: string;
  depth: number;
};

export type InstructionBudgetLimits = {
  maxCommands: number | null;
  maxRules: number | null;
  maxRuleDepth: number | null;
  maxEntryCharacters: number | null;
  maxTotalCharacters: number | null;
};

export type BudgetFinding = {
  limitName: keyof InstructionBudgetLimits;
  declaredLimit: number | null;
  used: number;
  available: number | null;
  overLimit: boolean;
  amountExceeded: number;
  affectedEntryIds: string[];
};

export type InstructionBudgetAccounting = {
  findings: BudgetFinding[];
  overLimit: boolean;
  adequate: boolean;
  totalCharacters: number;
  perEntryCharacters: Record<string, number>;
};

export type PacketInclusion = "required" | "optional";

export type PacketPrimaryEntry = {
  id: string;
  kind: "stage";
  title: string;
  description: string;
  workflowRef: string;
  stageName: string;
  commandRefs: string[];
  ruleRefs: string[];
  optionalCommandRefs: string[];
  optionalRuleRefs: string[];
  reportContractRef: string;
  taskInstructions: string;
  validationRequirements: string[];
  stopConditions: string[];
};

export type ResolvedCommandEntry = CommandCatalogEntry & {
  included: PacketInclusion;
};

export type ResolvedRuleEntry = RuleCatalogEntry & {
  included: PacketInclusion;
  depth: number;
};

export type TruncationRecord = {
  rootOptionalEntryId: string;
  affectedEntryIds: string[];
  limitingField: keyof InstructionBudgetLimits;
  declaredLimit: number | null;
  usedBefore: number;
  attemptedAfter: number;
  reason: string;
};

export type PacketTruncation = {
  truncated: boolean;
  records: TruncationRecord[];
  droppedOptionalCommandIds: string[];
  droppedOptionalRuleIds: string[];
  droppedOptionalDependencyIds: string[];
  warnings: string[];
};

export type PacketAdequacy = {
  status: "adequate" | "inadequate";
  reasons: string[];
  requiredContentComplete: boolean;
  requiredBudgetSatisfied: boolean;
  optionalContentDropped: boolean;
  affectedEntryIds: string[];
};

export type WorkflowInstructionPacket = {
  schemaVersion: string;
  catalogSchemaVersion: string;
  catalogVersion: string;
  workflowId: string;
  stageId: string;
  primaryEntry: PacketPrimaryEntry;
  resolvedCommands: ResolvedCommandEntry[];
  resolvedRules: ResolvedRuleEntry[];
  reportContract: ReportContractCatalogEntry;
  validationRequirements: string[];
  stopConditions: string[];
  resolutionProvenance: ResolutionProvenanceEntry[];
  budget: InstructionBudgetAccounting;
  truncation: PacketTruncation;
  adequacy: PacketAdequacy;
  unresolvedReferences: string[];
  warnings: string[];
};
