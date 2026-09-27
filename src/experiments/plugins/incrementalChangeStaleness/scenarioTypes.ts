import type { AffectedTaskRelationship } from "../../../evaluation/affectedNeighborhood.js";
import type { BenchmarkTaskAnswerKey } from "../../../evaluation/types.js";

/**
 * v0.6.2 incremental-change-staleness scenario catalog schema version.
 *
 * This is a separate, versioned contract from the warm-index benchmark case
 * contract (`benchmarks/contracts/warm-index-benchmark-cases.json`), which
 * remains unchanged. Scenario records here reference existing benchmark
 * project/case ids rather than duplicating canonical project/target metadata.
 */
export const INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION = "1.0.0";

/**
 * The experimental dimension a scenario deliberately changes. Categories are
 * not required to be structurally exclusive (for example, an exported
 * function body is still implementation code); the selected category
 * describes the intended experimental contrast, not an exhaustive structural
 * classification.
 */
export const INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATEGORIES = [
  "unrelated-file-change",
  "local-implementation-change",
  "exported-symbol-change",
  "public-api-change",
  "import-graph-change",
  "test-only-change"
] as const;

export type IncrementalChangeStalenessScenarioCategory = (typeof INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATEGORIES)[number];

/**
 * Answer-key policy for a scenario's follow-up query:
 * - `inherit`: reuse the referenced base case's existing query/answer key
 *   because the controlled change does not alter that task's semantic truth.
 * - `scenario`: use a scenario-specific post-mutation query and answer key,
 *   expressed with the existing benchmark answer-key structure.
 *
 * Exactly these two policies are supported; no other correctness vocabulary
 * is introduced.
 */
export const INCREMENTAL_CHANGE_STALENESS_ANSWER_POLICIES = ["inherit", "scenario"] as const;

export type IncrementalChangeStalenessAnswerPolicy = (typeof INCREMENTAL_CHANGE_STALENESS_ANSWER_POLICIES)[number];

/**
 * One ordered, literal, exact-preimage replacement. No regex, no fuzzy
 * matching, no callbacks, no arbitrary code. `expectedPreimage` must match
 * the in-memory text exactly once at the point this operation is applied.
 */
export type IncrementalChangeStalenessMutationOperation = {
  expectedPreimage: string;
  replacement: string;
};

/**
 * A single controlled file mutated by a scenario, expressed as an ordered
 * list of literal replacement operations plus pre/post SHA-256 guards. The
 * path is relative to the referenced benchmark project's root and must be
 * covered by the referenced base case's configured indexed source roots.
 */
export type IncrementalChangeStalenessMutationFile = {
  path: string;
  expectedPreSha256: string;
  operations: IncrementalChangeStalenessMutationOperation[];
  expectedPostSha256: string;
};

/**
 * The bounded, declarative mutation plan for one scenario. This is DATA, not
 * executable instructions: no shell commands, no subprocess commands, no
 * JavaScript callbacks, no arbitrary scripts, no file creation/deletion/moves.
 */
export type IncrementalChangeStalenessMutationPlan = {
  files: IncrementalChangeStalenessMutationFile[];
};

/**
 * One frozen, versioned, controlled-change scenario record. This batch
 * defines the contract and the immutable production catalog; it does not
 * execute mutations, register the runtime plugin, or run any treatment.
 */
export type IncrementalChangeStalenessScenario = {
  id: string;
  category: IncrementalChangeStalenessScenarioCategory;
  benchmarkProjectId: string;
  baseCaseId: string;
  answerPolicy: IncrementalChangeStalenessAnswerPolicy;
  /** Required and nonempty when answerPolicy is "scenario"; absent when "inherit". */
  scenarioQuery?: string;
  /** Required when answerPolicy is "scenario"; absent when "inherit". */
  scenarioAnswerKey?: BenchmarkTaskAnswerKey;
  /**
   * The scenario's expected complete-evidence relationship, when the planner
   * has frozen one (for example U1's negative-control expectation). This is
   * planning evidence only; runtime classification in later batches may
   * still produce "unknown" instead of "unrelated" if evidence is incomplete.
   */
  expectedRelationship?: AffectedTaskRelationship;
  mutation: IncrementalChangeStalenessMutationPlan;
  notes?: string;
};

export type IncrementalChangeStalenessScenarioCatalog = {
  schemaVersion: string;
  scenarios: IncrementalChangeStalenessScenario[];
};

/** The six planner-frozen production scenario ids, in their planned order. */
export const FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS = ["U1", "L2", "E1", "P1", "I1", "T1"] as const;
