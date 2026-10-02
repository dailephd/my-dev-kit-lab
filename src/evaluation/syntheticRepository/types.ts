import type { TaskLocality } from "../types.js";

export const SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_ID = "my-dev-kit-lab-synthetic-repository-config-v1";
export const SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION = "1.0.0";
export const SYNTHETIC_REPOSITORY_PLAN_SCHEMA_ID = "my-dev-kit-lab-synthetic-repository-plan-v1";
export const SYNTHETIC_REPOSITORY_PLAN_SCHEMA_VERSION = "1.0.0";
export const SYNTHETIC_REPOSITORY_IDENTITY_ALGORITHM_VERSION = "sha256-canonical-json-v1";
export const SYNTHETIC_REPOSITORY_PRNG_VERSION = "mulberry32-v1";

export const SYNTHETIC_REPOSITORY_LANGUAGES = ["typescript", "python"] as const;
export type SyntheticRepositoryLanguage = (typeof SYNTHETIC_REPOSITORY_LANGUAGES)[number];

export const SYNTHETIC_REPOSITORY_PATTERN_ROLES = ["helper-block", "table-block", "doc-block", "guard-block"] as const;
export type SyntheticRepositoryPatternRole = (typeof SYNTHETIC_REPOSITORY_PATTERN_ROLES)[number];

export type SyntheticRepositoryCaseSpecV1 = {
  id: string;
  language: SyntheticRepositoryLanguage;
  seed: string;
  sourceFileCount: number;
  moduleDepth: number;
  internalImportCount: number;
  symbolCount: number;
  testFileCount: number;
  taskLocality: TaskLocality;
  repeatedPatternCount: number;
};

export type SyntheticRepositoryConfigV1 = {
  schemaVersion: typeof SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION;
  cases: SyntheticRepositoryCaseSpecV1[];
};

export type SyntheticRepositoryDimensions = {
  sourceFileCount: number;
  moduleDepth: number;
  internalImportCount: number;
  symbolCount: number;
  testFileCount: number;
  repeatedPatternCount: number;
  taskLocality: TaskLocality;
};

export type PlannedSourceModule = {
  moduleId: string;
  index: number;
  level: number;
  path: string;
  symbolIds: string[];
};

export type PlannedSymbol = {
  symbolId: string;
  name: string;
  ordinal: number;
  moduleId: string;
};

/** `from` imports `to`; both are module ids. */
export type PlannedImportEdge = {
  from: string;
  to: string;
};

export type PlannedTestFile = {
  testId: string;
  path: string;
  targetModuleId: string;
  targetSymbolIds: string[];
};

export type PlannedRepeatedPattern = {
  patternId: string;
  ordinal: number;
  role: SyntheticRepositoryPatternRole;
  targetModuleId: string;
};

export type PlannedTaskQueryKind = "locate-symbols" | "trace-import" | "broad-change-survey";

export type PlannedTask = {
  taskId: string;
  locality: TaskLocality;
  ownerModuleIds: string[];
  symbolIds: string[];
  relationEdge: PlannedImportEdge | null;
  associatedTestIds: string[];
  queryPlan: {
    kind: PlannedTaskQueryKind;
    subjectSymbolIds: string[];
  };
};

export type PlannedAnswerFactRole = "symbol-definition" | "import-relation" | "associated-test";

/** Plan-level fact; field names mirror ExpectedAnswerFact (id -> factId, weight, required). Prose is a Batch 2 concern. */
export type PlannedAnswerFact = {
  factId: string;
  role: PlannedAnswerFactRole;
  required: boolean;
  weight: number;
  symbolIds: string[];
  edge: PlannedImportEdge | null;
  testId: string | null;
};

/** Mirrors ExpectedContextTarget (file, symbols, required) using plan paths and symbol names. */
export type PlannedContextTarget = {
  file: string;
  symbols: string[];
  required: boolean;
};

export type PlannedAnswerKey = {
  expectedFiles: string[];
  expectedSymbols: string[];
  expectedSymbolIds: string[];
  facts: PlannedAnswerFact[];
  minimumCorrectFacts: number;
  expectedContextTargets: PlannedContextTarget[];
};

export type SyntheticRepositoryPlanV1 = {
  schemaId: typeof SYNTHETIC_REPOSITORY_PLAN_SCHEMA_ID;
  schemaVersion: typeof SYNTHETIC_REPOSITORY_PLAN_SCHEMA_VERSION;
  prngVersion: typeof SYNTHETIC_REPOSITORY_PRNG_VERSION;
  identityAlgorithmVersion: typeof SYNTHETIC_REPOSITORY_IDENTITY_ALGORITHM_VERSION;
  caseId: string;
  generationIdentity: string;
  language: SyntheticRepositoryLanguage;
  logicalProjectId: string;
  requested: SyntheticRepositoryDimensions;
  realized: SyntheticRepositoryDimensions;
  modules: PlannedSourceModule[];
  symbols: PlannedSymbol[];
  importEdges: PlannedImportEdge[];
  testFiles: PlannedTestFile[];
  repeatedPatterns: PlannedRepeatedPattern[];
  task: PlannedTask;
  answerKey: PlannedAnswerKey;
};

/** Thrown for invalid configuration or case input; `errors` carries every labelled validation error. */
export class SyntheticRepositoryConfigError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid synthetic repository configuration: ${errors.join("; ")}`);
    this.name = "SyntheticRepositoryConfigError";
    this.errors = [...errors];
  }
}

/** Thrown when a plan cannot be produced or fails its own invariant verification. */
export class SyntheticRepositoryPlanningError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Synthetic repository planning failed: ${errors.join("; ")}`);
    this.name = "SyntheticRepositoryPlanningError";
    this.errors = [...errors];
  }
}
