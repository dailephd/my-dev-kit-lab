import type { TaskLocality } from "../types.js";
import type { AgentSuccessTaskV1 } from "./taskTypes.js";

/**
 * Contracts for the canonical agent-success implementation benchmark corpus. This is a separate contract family
 * from the retrieval benchmark profiles (`benchmark-project-profiles.json`) and must not be merged into it.
 */
export const AGENT_SUCCESS_PROJECT_PROFILES_SCHEMA_VERSION = "my-dev-kit-lab-agent-success-project-profiles-v1";
export const AGENT_SUCCESS_TASK_CATALOG_PATH = "benchmarks/contracts/agent-success-rate-tasks.json";
export const AGENT_SUCCESS_PROJECT_PROFILES_PATH = "benchmarks/contracts/agent-success-rate-project-profiles.json";
export const AGENT_SUCCESS_PROJECTS_DIRECTORY = "benchmarks/projects";

export const AGENT_SUCCESS_CORPUS_PROJECT_IDS = ["agent-success-task-board-node", "agent-success-inventory-node"] as const;
export type AgentSuccessCorpusProjectId = (typeof AGENT_SUCCESS_CORPUS_PROJECT_IDS)[number];

export type AgentSuccessCorpusTaskExpectation = {
  id: string;
  project: AgentSuccessCorpusProjectId;
  locality: TaskLocality;
};

/** The fixed catalog order. Three tasks per project: one localized, one cross-module, one broad-change. */
export const AGENT_SUCCESS_CORPUS_TASKS: readonly AgentSuccessCorpusTaskExpectation[] = Object.freeze([
  { id: "asr-board-title-normalization", project: "agent-success-task-board-node", locality: "localized" },
  { id: "asr-board-import-idempotency", project: "agent-success-task-board-node", locality: "cross-module" },
  { id: "asr-board-project-summary", project: "agent-success-task-board-node", locality: "broad-change" },
  { id: "asr-inventory-quantity-boundary", project: "agent-success-inventory-node", locality: "localized" },
  { id: "asr-inventory-reservation-atomicity", project: "agent-success-inventory-node", locality: "cross-module" },
  { id: "asr-inventory-fulfillment-report", project: "agent-success-inventory-node", locality: "broad-change" }
]);

/** Files every project must contain, relative to the project root. */
export const AGENT_SUCCESS_CORPUS_PROJECT_FILES: Readonly<Record<AgentSuccessCorpusProjectId, readonly string[]>> = Object.freeze({
  "agent-success-task-board-node": Object.freeze([
    "README.md",
    "package.json",
    "src/validation.js",
    "src/taskStore.js",
    "src/taskService.js",
    "src/projectSummary.js",
    "src/index.js",
    "tests/title-primary.check.mjs",
    "tests/title-edge.check.mjs",
    "tests/import-primary.check.mjs",
    "tests/import-edge.check.mjs",
    "tests/summary-primary.check.mjs",
    "tests/summary-edge.check.mjs",
    "tests/regression.check.mjs"
  ]),
  "agent-success-inventory-node": Object.freeze([
    "README.md",
    "package.json",
    "src/quantity.js",
    "src/inventoryStore.js",
    "src/reservationService.js",
    "src/fulfillmentReport.js",
    "src/index.js",
    "tests/quantity-primary.check.mjs",
    "tests/quantity-edge.check.mjs",
    "tests/reservation-primary.check.mjs",
    "tests/reservation-edge.check.mjs",
    "tests/report-primary.check.mjs",
    "tests/report-edge.check.mjs",
    "tests/regression.check.mjs"
  ])
});

export const AGENT_SUCCESS_CORPUS_RAW_INCLUDE_GLOBS: readonly string[] = Object.freeze(["src/**/*.js"]);

/** Directory names that must never exist inside a canonical project. */
export const AGENT_SUCCESS_CORPUS_FORBIDDEN_DIRECTORIES: readonly string[] = Object.freeze([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "lab-output"
]);

export type AgentSuccessProjectProfileV1 = {
  projectId: string;
  displayName: string;
  description: string;
  /** Project-relative POSIX path from the repository root; must equal `benchmarks/projects/<projectId>`. */
  rootPath: string;
  sourceRoots: string[];
  testRoots: string[];
  primaryLanguage: "javascript";
  runtime: "node>=24";
};

export type AgentSuccessProjectProfilesV1 = {
  schemaVersion: typeof AGENT_SUCCESS_PROJECT_PROFILES_SCHEMA_VERSION;
  projects: AgentSuccessProjectProfileV1[];
};

export type AgentSuccessCorpusV1 = {
  profiles: AgentSuccessProjectProfileV1[];
  /** Catalog order. */
  tasks: AgentSuccessTaskV1[];
};

export type AgentSuccessCorpusIssueCode =
  | "CATALOG_MISSING"
  | "CATALOG_UNREADABLE"
  | "CATALOG_INVALID_JSON"
  | "CATALOG_NOT_FILE"
  | "PROFILES_INVALID"
  | "PROFILE_INVALID"
  | "PROFILE_ROOT_INVALID"
  | "PROJECT_SET_MISMATCH"
  | "TASKS_NOT_ARRAY"
  | "TASK_INVALID"
  | "TASK_COUNT_MISMATCH"
  | "TASK_ORDER_MISMATCH"
  | "TASK_ID_DUPLICATE"
  | "PROJECT_REF_INVALID"
  | "LOCALITY_MISMATCH"
  | "LOCALITY_DISTRIBUTION"
  | "SOURCE_SCOPE_INVALID"
  | "CHECK_COUNT_INVALID"
  | "CHECK_COMMAND_INVALID"
  | "CHECK_PATH_UNSAFE"
  | "EDIT_SCOPE_INVALID"
  | "PROTECTED_SCOPE_INVALID"
  | "FACT_COVERAGE_INVALID"
  | "FIXTURE_MISSING"
  | "FIXTURE_DUPLICATE"
  | "FIXTURE_INVALID"
  | "FIXTURE_SCOPE_MISMATCH"
  | "FIXTURE_LEAKED"
  | "PROJECT_ROOT_UNSAFE"
  | "PROJECT_FILE_MISSING"
  | "PROJECT_SCOPE_MISSING"
  | "PROJECT_SYMLINK"
  | "PROJECT_FORBIDDEN_OUTPUT"
  | "PROJECT_TEST_NAMING"
  | "PROJECT_METADATA_INVALID"
  | "PROJECT_TREE_TOO_LARGE";

export type AgentSuccessCorpusIssue = {
  code: AgentSuccessCorpusIssueCode;
  /** Logical location such as `tasks[2].taskChecks[0].args`; never an absolute machine path. */
  path: string;
  message: string;
};

export type AgentSuccessCorpusValidationResult =
  | { ok: true; corpus: AgentSuccessCorpusV1 }
  | { ok: false; issues: AgentSuccessCorpusIssue[] };

export class AgentSuccessCorpusError extends Error {
  readonly issues: readonly AgentSuccessCorpusIssue[];

  constructor(issues: readonly AgentSuccessCorpusIssue[]) {
    super(
      `Invalid agent-success corpus: ${issues
        .slice(0, 5)
        .map((issue) => `${issue.path}: ${issue.code}`)
        .join("; ")}${issues.length > 5 ? `; +${issues.length - 5} more` : ""}`
    );
    this.name = "AgentSuccessCorpusError";
    this.issues = [...issues];
  }
}
