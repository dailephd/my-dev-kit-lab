export type ExperimentPluginStatus = "stable" | "experimental" | "deprecated";

export type ExperimentTargetKind = "self" | "external-local";

export type ExperimentOutputKind = "json" | "html" | "text" | "plot" | "screenshot" | "artifact";

export type ExperimentRunStatus = "completed" | "partial" | "failed" | "skipped";

export type ExperimentOutcomeStatus = ExperimentRunStatus;

export type ExperimentMetricValue = string | number | boolean | null;

export type ExperimentJsonValue =
  | string
  | number
  | boolean
  | null
  | ExperimentJsonValue[]
  | { [key: string]: ExperimentJsonValue };

export type ExperimentPluginMetadata = {
  id: string;
  name: string;
  description: string;
  schemaVersion: string;
  status: ExperimentPluginStatus;
  supportedTargets: ExperimentTargetKind[];
  supportedOutputs: ExperimentOutputKind[];
};

export type ExperimentConfig = Record<string, unknown>;

export type ExperimentConfigFieldDefinition = {
  name: string;
  description?: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "array" | "object";
  defaultValue?: unknown;
};

export type ExperimentConfigDefinition = {
  fields: ExperimentConfigFieldDefinition[];
};

export type ExperimentConfigValidationResult<TConfig = unknown> = {
  valid: boolean;
  config?: TConfig;
  errors: string[];
  warnings: string[];
};

export type ExperimentTarget = {
  kind: ExperimentTargetKind;
  targetRoot: string;
  toolRoot: string;
  packageName: string | null;
  packageVersion: string | null;
  hasPackageJson: boolean;
  hasLockfile: boolean;
  branch: string | null;
  commit: string | null;
  hasGit: boolean;
  isSelf: boolean;
};

export type ExperimentMetric = {
  id: string;
  name: string;
  value: ExperimentMetricValue;
  unit?: string;
  description?: string;
  variantId?: string;
  caseId?: string;
};

export type ExperimentArtifact = {
  id: string;
  label: string;
  path?: string;
  kind: ExperimentOutputKind;
  mimeType?: string;
  description?: string;
  variantId?: string;
  caseId?: string;
};

export type ExperimentWarning = {
  code: string;
  message: string;
  variantId?: string;
  caseId?: string;
  details?: ExperimentJsonValue;
};

export type ExperimentFailure = {
  code: string;
  message: string;
  variantId?: string;
  caseId?: string;
  recoverable?: boolean;
  details?: ExperimentJsonValue;
};

export type ExperimentVariant = {
  id: string;
  name: string;
  description?: string;
  metadata?: Record<string, ExperimentJsonValue>;
};

export type ExperimentOutcome = {
  id: string;
  caseId: string;
  variantId: string;
  status: ExperimentOutcomeStatus;
  metrics: ExperimentMetric[];
  artifacts: ExperimentArtifact[];
  warnings: ExperimentWarning[];
  failures: ExperimentFailure[];
  startedAt?: string;
  completedAt?: string;
  metadata?: Record<string, ExperimentJsonValue>;
};

export type ExperimentCase = {
  id: string;
  name: string;
  description?: string;
  outcomes: ExperimentOutcome[];
  metadata?: Record<string, ExperimentJsonValue>;
};

export type ExperimentSummary = {
  status: ExperimentRunStatus;
  totalCases: number;
  completedCases: number;
  partialCases: number;
  failedCases: number;
  skippedCases: number;
  metrics: ExperimentMetric[];
  warnings: ExperimentWarning[];
  failures: ExperimentFailure[];
  notes?: string[];
};

export type ExperimentRun = {
  runId: string;
  pluginId: string;
  startedAt: string;
  completedAt?: string;
  status: ExperimentRunStatus;
  target: ExperimentTarget;
  variants: ExperimentVariant[];
  cases: ExperimentCase[];
  metrics: ExperimentMetric[];
  artifacts: ExperimentArtifact[];
  warnings: ExperimentWarning[];
  failures: ExperimentFailure[];
  summary?: ExperimentSummary;
  metadata?: Record<string, ExperimentJsonValue>;
};

export type ExperimentExecutionContext<TConfig = unknown> = {
  runId: string;
  startedAt: Date;
  toolRoot: string;
  target: ExperimentTarget;
  config: TConfig;
  outputRoot?: string;
  inputs?: Record<string, unknown>;
  logger?: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
};

export interface ExperimentPlugin<
  TConfig = unknown,
  TResult extends ExperimentRun = ExperimentRun,
> {
  metadata: ExperimentPluginMetadata;
  defaultConfig?: TConfig;
  configDefinition?: ExperimentConfigDefinition;
  validateConfig(config: unknown): ExperimentConfigValidationResult<TConfig>;
  prepare?(context: ExperimentExecutionContext<TConfig>): Promise<void> | void;
  run(context: ExperimentExecutionContext<TConfig>): Promise<TResult>;
  summarize?(result: TResult, context: ExperimentExecutionContext<TConfig>): ExperimentSummary;
  cleanup?(context: ExperimentExecutionContext<TConfig>): Promise<void> | void;
}
