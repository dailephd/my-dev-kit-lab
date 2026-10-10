import type { TaskLocality } from "../types.js";

export const AGENT_SUCCESS_TASK_SCHEMA_VERSION = "my-dev-kit-lab-agent-success-task-v1";

/** Upper bound for one verification check; bounded so a hung check cannot stall an evaluation indefinitely. */
export const MAX_VERIFICATION_CHECK_TIMEOUT_MS = 300_000;

/**
 * One trusted, Lab-authored verification command. V1 runs only `node` (resolved to the running Node binary
 * at execution time); there is no shell string and no other executable.
 */
export type VerificationCheckDefinition = {
  id: string;
  executable: "node";
  args: string[];
  timeoutMs: number;
};

/**
 * A behavior the finished implementation must exhibit, tied to trusted check outcomes rather than to agent
 * prose. Batch 1 validates the mapping only; satisfaction is derived by later analysis.
 */
export type BehaviorFactDefinition = {
  id: string;
  text: string;
  required: boolean;
  verificationCheckIds: string[];
};

/** Deterministic patch evidence for later simulated-agent runs. Nothing here executes in Batch 1. */
export type DeterministicFixture = {
  id: string;
  patch: string;
  notes?: string;
};

/**
 * An implementation task over a controlled benchmark project. It is deliberately separate from
 * EvaluationCase/BenchmarkTaskAnswerKey: `expectedFiles` there means answer relevance, whereas the edit
 * lists here describe where a correct implementation is expected to change code.
 */
export type AgentSuccessTaskV1 = {
  schemaVersion: typeof AGENT_SUCCESS_TASK_SCHEMA_VERSION;
  id: string;
  title: string;
  benchmarkProject: string;
  projectProfileRef: string;
  taskLocality: TaskLocality;
  query: string;
  sourceRoots: string[];
  rawIncludeGlobs: string[];
  instruction: string;
  /** Measurement expectation: files a correct implementation is expected to change. */
  expectedEditFiles: string[];
  /** Expected edit scope (superset of expectedEditFiles) used later for quality analysis. */
  allowedEditFiles: string[];
  /** Hard safety boundary: a patch touching any of these is rejected before application. */
  protectedFiles: string[];
  taskChecks: VerificationCheckDefinition[];
  regressionChecks: VerificationCheckDefinition[];
  behaviorFacts: BehaviorFactDefinition[];
  deterministicFixture?: DeterministicFixture;
};

export type AgentSuccessTaskIssueCode =
  | "NOT_OBJECT"
  | "UNKNOWN_FIELD"
  | "MISSING_FIELD"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "INVALID_SCHEMA_VERSION"
  | "PATH_NOT_STRING"
  | "PATH_EMPTY"
  | "PATH_NUL"
  | "PATH_ABSOLUTE"
  | "PATH_DRIVE"
  | "PATH_DOT"
  | "PATH_TRAVERSAL"
  | "PATH_GIT_SEGMENT"
  | "PATH_TRAILING_SLASH"
  | "DUPLICATE_PATH"
  | "EXPECTED_NOT_ALLOWED"
  | "PROTECTED_OVERLAP"
  | "TOO_FEW_CHECKS"
  | "DUPLICATE_CHECK_ID"
  | "INVALID_EXECUTABLE"
  | "INVALID_TIMEOUT"
  | "DUPLICATE_FACT_ID"
  | "UNRESOLVED_CHECK_ID"
  | "REQUIRED_FACT_UNMAPPED";

export type AgentSuccessTaskIssue = {
  code: AgentSuccessTaskIssueCode;
  /** Field path such as "taskChecks[1].timeoutMs". */
  path: string;
  message: string;
};

export type AgentSuccessTaskValidationResult =
  | { ok: true; task: AgentSuccessTaskV1 }
  | { ok: false; issues: AgentSuccessTaskIssue[] };

export class AgentSuccessTaskValidationError extends Error {
  readonly issues: readonly AgentSuccessTaskIssue[];

  constructor(issues: readonly AgentSuccessTaskIssue[]) {
    super(
      `Invalid agent-success task: ${issues
        .slice(0, 5)
        .map((issue) => `${issue.path}: ${issue.code}`)
        .join("; ")}${issues.length > 5 ? `; +${issues.length - 5} more` : ""}`
    );
    this.name = "AgentSuccessTaskValidationError";
    this.issues = [...issues];
  }
}
