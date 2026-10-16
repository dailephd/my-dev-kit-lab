// Additional metric glossary data (v0.9.3 completeness correction). Every definition below is condensed from the
// owning metric calculation code or docs/METRICS.md; nothing here defines a calculation. Static ids are listed
// explicitly; bounded dynamic id families are described by a closed pattern so an unknown id never matches.

export type MetricBasis =
  | "measured"
  | "derived"
  | "estimated"
  | "agent-token-telemetry"
  | "verification-verdict"
  | "answer-key-set-measure"
  | "not-specified";

export type CatalogRow = {
  id: string;
  name: string;
  def: string;
  unit?: string;
  interp: string;
  caveats?: string[];
  basis?: MetricBasis;
};

export type CatalogGroup = { pluginId: string; docsSection: string; prefix?: string; rows: CatalogRow[] };

/** A closed family of plugin-scoped ids that differ only by a bounded parameter. */
export type CatalogFamily = {
  pluginId: string;
  docsSection: string;
  /** Stable template used as the metric identity and anchor, e.g. `budget-{tokens}-success`. */
  template: string;
  pattern: RegExp;
  row: Omit<CatalogRow, "id">;
};

const ESTIMATE = "Character-based estimate (ceil(characters / 4)); not provider token usage or billing telemetry.";
const UNAVAILABLE_NOT_ZERO = "Unavailable evidence is never converted to zero.";

export const EXTRA_AGENT_SUCCESS_ROWS: CatalogRow[] = [
  { id: "patchApplied", name: "Patch applied", def: "Whether the proposed patch was applied to the sandbox: true when applied, false when the patch pipeline attempted and failed.", unit: "boolean", interp: "Describes patch application only; it is not a task-success verdict.", caveats: ["Unavailable when no patch-pipeline evidence exists."], basis: "verification-verdict" },
  { id: "optionalFactsTotal", name: "Optional facts (count)", def: "Behavior facts of the task that are not marked required.", unit: "count", interp: "Denominator context for optional-fact satisfaction.", basis: "derived" },
  { id: "optionalFactsSatisfiedCount", name: "Optional facts satisfied (count)", def: "Optional behavior facts whose referenced post-edit checks all passed.", unit: "count", interp: "Read with optionalFactsTotal.", caveats: ["Unavailable when an optional fact cannot be determined or the patch was not applied."], basis: "derived" },
  { id: "attemptCount", name: "Attempts (count)", def: "Provider attempts executed for the treatment: the initial attempt plus repair attempts.", unit: "count", interp: "Cost context for repair-enabled runs.", caveats: ["Reported only for real-agent runs with attempt history."], basis: "derived" },
  { id: "repairAttemptCount", name: "Repair attempts (count)", def: "Repair attempts executed after the initial attempt.", unit: "count", interp: "Equals attemptCount minus one.", basis: "derived" },
  { id: "evaluableCaseCount", name: "Evaluable cases (count)", def: "Cases with a determinate task-success verdict for the treatment; the denominator of taskSuccessRate.", unit: "count", interp: "Cases without a determinate verdict are excluded, not counted as failures.", basis: "derived" },
  { id: "successfulCaseCount", name: "Successful cases (count)", def: "Evaluable cases whose task-success verdict is true; the numerator of taskSuccessRate.", unit: "count", interp: "Read with evaluableCaseCount.", basis: "derived" },
  { id: "initialAttemptSuccessfulCount", name: "Initial-attempt successful cases (count)", def: "Cases with a determinate initial-attempt verdict whose attempt-1 task success is true.", unit: "count", interp: "A repaired success is never counted here.", basis: "derived" },
  { id: "finalSuccessfulCount", name: "Final successful cases (count)", def: "Cases with a determinate final verdict whose final task success is true.", unit: "count", interp: "Includes repaired successes.", basis: "derived" },
  { id: "repairAttemptedCaseCount", name: "Repair-attempted cases (count)", def: "Cases in which at least one repair attempt was executed.", unit: "count", interp: "Denominator context for repair success.", basis: "derived" },
  { id: "repairedCaseCount", name: "Repaired cases (count)", def: "Repair-attempted cases with a determinate repair verdict whose repair succeeded (initial attempt false, final true).", unit: "count", interp: "Numerator of repairSuccessRate.", basis: "derived" },
  { id: "meanAttemptsPerEvaluableCase", name: "Mean attempts per evaluable case", def: "Mean number of attempts over cases with a determinate final verdict.", unit: "count", interp: "Descriptive.", caveats: ["Unavailable when no case has a determinate final verdict."], basis: "derived" },
  { id: "firstAttemptProviderDurationMs", name: "First-attempt provider duration", def: "Provider duration of the first attempt.", unit: "ms", interp: "Reported separately from the final attempt and the total.", caveats: ["Unavailable when no provider attempt ran."], basis: "measured" },
  { id: "finalAttemptProviderDurationMs", name: "Final-attempt provider duration", def: "Provider duration of the last attempt executed.", unit: "ms", interp: "Reported separately from the first attempt and the total.", caveats: ["Unavailable when no provider attempt ran."], basis: "measured" },
  { id: "firstAttemptProviderTokens", name: "First-attempt provider tokens", def: "Total token usage reported for the first attempt.", unit: "tokens", interp: "Read with the recorded token source and reliability.", caveats: ["Unavailable when no provider attempt ran or the provider reported no total."], basis: "agent-token-telemetry" },
  { id: "finalAttemptProviderTokens", name: "Final-attempt provider tokens", def: "Total token usage reported for the last attempt executed.", unit: "tokens", interp: "Read with the recorded token source and reliability.", caveats: ["Unavailable when no provider attempt ran or the provider reported no total."], basis: "agent-token-telemetry" }
];

/** Plugins whose static rows are new in this correction. */
export const EXTRA_GROUPS: CatalogGroup[] = [
  {
    pluginId: "incremental-change-staleness",
    docsSection: "Incremental-change and staleness evidence (v0.6.2)",
    rows: [
      { id: "context-character-count", name: "Context characters", def: "Characters in the retrieved my-dev-kit context.", unit: "characters", interp: "Context size by characters.", caveats: ["Emitted only when the treatment produced retrieval evidence."], basis: "measured" },
      { id: "context-estimated-token-count", name: "Estimated context tokens", def: "Character-based estimate of retrieved context tokens.", unit: "tokens", interp: "Estimated context size.", caveats: [ESTIMATE], basis: "estimated" },
      { id: "operation-duration-ms", name: "Operation duration", def: "Measured retrieval-only duration (search, lookup, slice, source); excludes index build.", unit: "ms", interp: "Not agent duration.", basis: "measured" },
      { id: "agent-correctness-score", name: "Agent correctness score", def: "Deterministic benchmark answer-key correctness score for the selected agent output.", unit: "score", interp: "Deterministic answer-key scoring.", caveats: ["Not semantic LLM judging."], basis: "answer-key-set-measure" },
      { id: "affected-neighborhood-changed-file-count", name: "Changed indexed files", def: "Unique confirmed modified or missing files that the baseline index snapshot represents.", unit: "count", interp: "Observational evidence only.", caveats: [UNAVAILABLE_NOT_ZERO], basis: "derived" },
      { id: "affected-neighborhood-changed-symbol-count", name: "Changed baseline symbols", def: "Baseline indexed symbol identities belonging to confirmed changed indexed files.", unit: "count", interp: "Observational evidence only.", caveats: [UNAVAILABLE_NOT_ZERO], basis: "derived" },
      { id: "affected-neighborhood-node-count", name: "Affected graph nodes", def: "Unique resolved seed nodes plus their direct one-hop baseline graph neighbors.", unit: "count", interp: "Observational evidence only.", caveats: [UNAVAILABLE_NOT_ZERO], basis: "derived" },
      { id: "affected-neighborhood-edge-count", name: "Affected graph edges", def: "Unique baseline graph edges incident to at least one resolved seed node.", unit: "count", interp: "Observational evidence only.", caveats: [UNAVAILABLE_NOT_ZERO], basis: "derived" },
      { id: "affected-neighborhood-task-overlap-count", name: "Task-overlap nodes", def: "Unique baseline graph nodes both in the affected neighborhood and resolved from the task's expected files and symbols.", unit: "count", interp: "Observational evidence only.", caveats: [UNAVAILABLE_NOT_ZERO], basis: "derived" },
      { id: "affected-neighborhood-task-overlap-percent", name: "Task-overlap percent", def: "Task-overlap nodes as a percentage of resolvable task graph nodes.", unit: "percent", interp: "Covers only the resolvable subset when task mapping is partial.", caveats: [UNAVAILABLE_NOT_ZERO], basis: "derived" },
      { id: "upstream-refresh-fresh-extraction-file-count", name: "Upstream fresh-extraction files", def: "Files my-dev-kit freshly re-extracted during the refresh invocation.", unit: "count", interp: "Upstream execution evidence, not Lab task overlap.", caveats: ["Omitted when upstream reported no value."], basis: "measured" },
      { id: "upstream-refresh-reused-file-count", name: "Upstream reused files", def: "Files my-dev-kit reused from the previous index during the refresh invocation.", unit: "count", interp: "Upstream execution evidence.", caveats: ["Omitted when upstream reported no value."], basis: "measured" },
      { id: "upstream-refresh-forced-neighbor-reanalysis-file-count", name: "Upstream forced-neighbor reanalysis files", def: "Neighbor files my-dev-kit forced to re-analyze during the refresh invocation.", unit: "count", interp: "Upstream execution evidence.", caveats: ["Omitted when upstream reported no value."], basis: "measured" },
      { id: "upstream-refresh-seed-file-count", name: "Upstream seed files", def: "Seed files my-dev-kit selected for the affected-neighborhood refresh.", unit: "count", interp: "Upstream execution evidence.", caveats: ["Absent when upstream reported none."], basis: "measured" },
      { id: "upstream-refresh-seed-symbol-count", name: "Upstream seed symbols", def: "Seed symbols my-dev-kit selected for the affected-neighborhood refresh.", unit: "count", interp: "Upstream execution evidence.", caveats: ["Absent when upstream reported none."], basis: "measured" },
      { id: "upstream-refresh-affected-node-count", name: "Upstream affected nodes", def: "Graph nodes my-dev-kit treated as affected during the refresh.", unit: "count", interp: "Upstream execution evidence, distinct from the Lab affected-neighborhood metrics.", basis: "measured" },
      { id: "upstream-refresh-affected-edge-count", name: "Upstream affected edges", def: "Graph edges my-dev-kit treated as affected during the refresh.", unit: "count", interp: "Upstream execution evidence, distinct from the Lab affected-neighborhood metrics.", basis: "measured" },
      { id: "incremental-change-staleness-scenario-count", name: "Scenario count", def: "Selected scenarios in this run.", unit: "count", interp: "Run-level count.", basis: "derived" },
      { id: "incremental-change-staleness-observed-regression-count", name: "Observed stale regression count", def: "Scenarios whose no-refresh treatment was classified observed-stale-regression against full refresh.", unit: "count", interp: "Descriptive count; not a score.", basis: "derived" },
      { id: "incremental-change-staleness-changed-files-applied-partial-count", name: "Changed-files applied-partial count", def: "Scenarios where the changed-files refresh was applied as a partial refresh.", unit: "count", interp: "Run-level count.", basis: "derived" },
      { id: "incremental-change-staleness-changed-files-fallback-full-count", name: "Changed-files fallback-full count", def: "Scenarios where the changed-files refresh fell back to a full rebuild.", unit: "count", interp: "Run-level count.", basis: "derived" },
      { id: "incremental-change-staleness-affected-neighborhood-applied-partial-count", name: "Affected-neighborhood applied-partial count", def: "Scenarios where the affected-neighborhood refresh was applied as a partial refresh.", unit: "count", interp: "Run-level count.", basis: "derived" },
      { id: "incremental-change-staleness-affected-neighborhood-fallback-full-count", name: "Affected-neighborhood fallback-full count", def: "Scenarios where the affected-neighborhood refresh fell back to a full rebuild.", unit: "count", interp: "Run-level count.", basis: "derived" }
    ]
  }
];

/** Rows appended to existing groups, keyed by plugin id. */
export const APPENDED_ROWS: Record<string, CatalogRow[]> = {
  "warm-index-reuse": [
    { id: "warm-index-project-count", name: "Warm-index project count", def: "Benchmark-project groups in this run.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "warm-index-task-count", name: "Warm-index task count", def: "Tasks evaluated across all benchmark-project groups.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "warm-index-session-prepared-project-count", name: "Prepared warm-index session count", def: "Benchmark-project groups for which exactly one warm index session was prepared.", unit: "count", interp: "Run-level count.", basis: "derived" }
  ],
  "context-window-scaling": [
    { id: "context-window-scaling-case-count", name: "Context-window-scaling case count", def: "Cases in the run summary.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "context-window-scaling-budget-count", name: "Context budget count", def: "Selected estimated-token budgets in the run summary.", unit: "count", interp: "Run-level count.", basis: "derived" }
  ],
  "retrieval-precision-recall": [
    { id: "missed-file-count", name: "Missed file count", def: "Expected files that were not retrieved.", unit: "count", interp: "Reported separately from symbols and facts; never combined into a score.", basis: "answer-key-set-measure" },
    { id: "missed-symbol-count", name: "Missed symbol count", def: "Expected symbol names that were not retrieved.", unit: "count", interp: "Reported separately from files and facts.", basis: "answer-key-set-measure" },
    { id: "uncovered-fact-count", name: "Uncovered fact count", def: "Expected facts not covered through the answer key's explicit factIds mappings.", unit: "count", interp: "Reported separately from files and symbols.", basis: "answer-key-set-measure" },
    { id: "irrelevant-retrieved-file-count", name: "Irrelevant retrieved file count", def: "Retrieved files that are not in the expected file set.", unit: "count", interp: "Numerator of irrelevantContextRatio.", basis: "answer-key-set-measure" },
    { id: "irrelevant-retrieved-symbol-count", name: "Irrelevant retrieved symbol count", def: "Retrieved symbol names that are not in the expected symbol set.", unit: "count", interp: "Reported separately from files.", basis: "answer-key-set-measure" },
    { id: "case-count", name: "Cases", def: "Cases in the run summary.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "completed-case-count", name: "Completed cases", def: "Cases whose retrieval completed.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "partial-case-count", name: "Partial cases", def: "Cases whose retrieval evidence was partial.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "failed-case-count", name: "Failed cases", def: "Cases that failed and have no retrieval result.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "mean-file-precision", name: "Mean file precision", def: "Macro mean of per-case file precision over available cases.", unit: "ratio", interp: "Unavailable and not-applicable cases are excluded from the mean, not counted as zero.", basis: "derived" },
    { id: "mean-file-recall", name: "Mean file recall", def: "Macro mean of per-case file recall over available cases.", unit: "ratio", interp: "Unavailable and not-applicable cases are excluded from the mean, not counted as zero.", basis: "derived" },
    { id: "mean-symbol-precision", name: "Mean symbol precision", def: "Macro mean of per-case symbol precision over available cases.", unit: "ratio", interp: "Unavailable and not-applicable cases are excluded from the mean, not counted as zero.", basis: "derived" },
    { id: "mean-symbol-recall", name: "Mean symbol recall", def: "Macro mean of per-case symbol recall over available cases.", unit: "ratio", interp: "Unavailable and not-applicable cases are excluded from the mean, not counted as zero.", basis: "derived" },
    { id: "mean-fact-coverage", name: "Mean fact coverage", def: "Macro mean of per-case fact coverage over available cases.", unit: "ratio", interp: "Unavailable and not-applicable cases are excluded from the mean, not counted as zero.", basis: "derived" },
    { id: "mean-irrelevant-context-ratio", name: "Mean irrelevant context ratio", def: "Macro mean of per-case irrelevant context ratio over available cases.", unit: "ratio", interp: "Unavailable and not-applicable cases are excluded from the mean, not counted as zero.", basis: "derived" },
    { id: "total-retrieved-tokens", name: "Total retrieved tokens", def: "Sum of per-case retrieved token counts over cases with an available count.", unit: "tokens", interp: "Context-size evidence.", caveats: [ESTIMATE], basis: "estimated" },
    { id: "mean-retrieved-tokens", name: "Mean retrieved tokens", def: "Mean of per-case retrieved token counts over cases with an available count.", unit: "tokens", interp: "Context-size evidence.", caveats: [ESTIMATE], basis: "estimated" },
    { id: "total-missed-file-occurrences", name: "Total missed file occurrences", def: "Task-instance sum of missed files; identical paths in different cases are never deduplicated.", unit: "count", interp: "Excludes cases whose identity lists were not computable.", basis: "answer-key-set-measure" },
    { id: "total-missed-symbol-occurrences", name: "Total missed symbol occurrences", def: "Task-instance sum of missed symbols; identical names in different cases are never deduplicated.", unit: "count", interp: "Excludes cases whose identity lists were not computable.", basis: "answer-key-set-measure" },
    { id: "total-uncovered-fact-occurrences", name: "Total uncovered fact occurrences", def: "Task-instance sum of uncovered facts.", unit: "count", interp: "Excludes cases whose fact lists were not computable.", basis: "answer-key-set-measure" },
    { id: "total-irrelevant-file-occurrences", name: "Total irrelevant file occurrences", def: "Task-instance sum of irrelevant retrieved files.", unit: "count", interp: "Excludes cases whose identity lists were not computable.", basis: "answer-key-set-measure" }
  ],
  "retrieval-query-strategy-comparison": [
    { id: "file-precision", name: "File precision", def: "Relevant retrieved files / retrieved files.", unit: "ratio", interp: "Inherited v0.8.0 definition.", caveats: ["Not applicable, not zero, when no file was retrieved."], basis: "answer-key-set-measure" },
    { id: "file-recall", name: "File recall", def: "Relevant retrieved files / expected files.", unit: "ratio", interp: "Inherited v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "file-f1", name: "File F1", def: "2 * TP_file / (2 * TP_file + FP_file + FN_file) over relevant retrieved, irrelevant retrieved and missed files.", unit: "ratio", interp: "Balanced file F1 computed from counts, not by averaging stored precision and recall.", caveats: ["Unavailable when an identity set is unavailable; not applicable when the denominator is zero."], basis: "answer-key-set-measure" },
    { id: "symbol-precision", name: "Symbol precision", def: "Relevant retrieved symbol names / retrieved symbol names (exact, case-sensitive).", unit: "ratio", interp: "Inherited v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "symbol-recall", name: "Symbol recall", def: "Relevant retrieved symbol names / expected symbol names (exact, case-sensitive).", unit: "ratio", interp: "Inherited v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "symbol-f1", name: "Symbol F1", def: "2 * TP_symbol / (2 * TP_symbol + FP_symbol + FN_symbol) over exact unique symbol names.", unit: "ratio", interp: "Balanced symbol F1 computed from counts.", caveats: ["No fuzzy or semantic name matching."], basis: "answer-key-set-measure" },
    { id: "fact-coverage", name: "Fact coverage", def: "Covered expected facts / all expected facts through explicit factIds-to-context mappings.", unit: "ratio", interp: "Inherited v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "irrelevant-context-ratio", name: "Irrelevant context ratio", def: "Irrelevant retrieved files / retrieved files.", unit: "ratio", interp: "Inherited v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "missed-file-count", name: "Missed file count", def: "Expected files that were not retrieved.", unit: "count", interp: "Reported separately from symbols and facts.", basis: "answer-key-set-measure" },
    { id: "missed-symbol-count", name: "Missed symbol count", def: "Expected symbol names that were not retrieved.", unit: "count", interp: "Reported separately from files and facts.", basis: "answer-key-set-measure" },
    { id: "uncovered-fact-count", name: "Uncovered fact count", def: "Expected facts not covered through explicit factIds mappings.", unit: "count", interp: "Reported separately from files and symbols.", basis: "answer-key-set-measure" },
    { id: "irrelevant-retrieved-file-count", name: "Irrelevant retrieved file count", def: "Retrieved files that are not in the expected file set.", unit: "count", interp: "Numerator of irrelevantContextRatio.", basis: "answer-key-set-measure" },
    { id: "irrelevant-retrieved-symbol-count", name: "Irrelevant retrieved symbol count", def: "Retrieved symbol names that are not in the expected symbol set.", unit: "count", interp: "Reported separately from files.", basis: "answer-key-set-measure" }
  ],
  "context-pack-generation": [
    { id: "file-precision", name: "File precision", def: "Relevant retrieved files / retrieved files.", unit: "ratio", interp: "Reused v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "file-recall", name: "File recall", def: "Relevant retrieved files / expected files.", unit: "ratio", interp: "Reused v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "file-f1", name: "File F1", def: "2 * TP_file / (2 * TP_file + FP_file + FN_file).", unit: "ratio", interp: "Balanced file F1 computed from counts.", basis: "answer-key-set-measure" },
    { id: "symbol-precision", name: "Symbol precision", def: "Relevant retrieved symbol names / retrieved symbol names (exact, case-sensitive).", unit: "ratio", interp: "Reused v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "symbol-recall", name: "Symbol recall", def: "Relevant retrieved symbol names / expected symbol names (exact, case-sensitive).", unit: "ratio", interp: "Reused v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "symbol-f1", name: "Symbol F1", def: "2 * TP_symbol / (2 * TP_symbol + FP_symbol + FN_symbol).", unit: "ratio", interp: "Balanced symbol F1 computed from counts.", basis: "answer-key-set-measure" },
    { id: "fact-coverage", name: "Fact coverage", def: "Covered expected facts / all expected facts through explicit factIds mappings.", unit: "ratio", interp: "Reused v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "irrelevant-context-ratio", name: "Irrelevant context ratio", def: "Irrelevant retrieved files / retrieved files.", unit: "ratio", interp: "Reused v0.8.0 definition.", basis: "answer-key-set-measure" },
    { id: "missed-file-count", name: "Missed file count", def: "Expected files that were not retrieved.", unit: "count", interp: "Reported separately from symbols and facts.", basis: "answer-key-set-measure" },
    { id: "missed-symbol-count", name: "Missed symbol count", def: "Expected symbol names that were not retrieved.", unit: "count", interp: "Reported separately from files and facts.", basis: "answer-key-set-measure" },
    { id: "uncovered-fact-count", name: "Uncovered fact count", def: "Expected facts not covered through explicit factIds mappings.", unit: "count", interp: "Reported separately from files and symbols.", basis: "answer-key-set-measure" }
  ],
  "context-strategy-comparison": [
    { id: "total-runs", name: "Total runs", def: "Controlled experiment runs in the summary.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "completed-runs", name: "Completed runs", def: "Controlled experiment runs that completed.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "failed-runs", name: "Failed runs", def: "Controlled experiment runs that failed.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "total-comparisons", name: "Total comparisons", def: "Raw-versus-guided comparisons in the summary.", unit: "count", interp: "Run-level count.", basis: "derived" },
    { id: "average-correctness-delta", name: "Average correctness delta", def: "Average of per-comparison correctnessDelta, where correctnessDelta is the guided correctnessScore minus the raw correctnessScore.", unit: "score", interp: "Positive means the guided strategy scored higher.", caveats: ["Deterministic answer-key scoring; not semantic judging."], basis: "derived" },
    { id: "correctness-score", name: "Correctness score", def: "Deterministic answer-key correctnessScore for the run: 0.25 * fileMatchScore + 0.25 * symbolMatchScore + 0.50 * factMatchScore.", unit: "score", interp: "Higher is better; a run passes at 0.70 or above with the required fact checks.", caveats: ["Not semantic judging."], basis: "answer-key-set-measure" },
    { id: "duration-ms", name: "Duration", def: "Measured wall-clock duration of the normalized run.", unit: "ms", interp: "Lower is faster.", caveats: ["Includes local CLI overhead."], basis: "measured" },
    { id: "total-tokens", name: "Total tokens", def: "Total token count reported for the run when available.", unit: "tokens", interp: "Used for token savings comparisons.", caveats: ["Emitted only when the run reported a numeric total; read with the recorded token source and reliability."], basis: "agent-token-telemetry" }
  ]
};

const SCOPES = "overall|localized|cross-module|broad-change";

export const FAMILIES: CatalogFamily[] = [
  {
    pluginId: "context-window-scaling",
    docsSection: "Context-window scaling evidence (v0.7.0)",
    template: "budget-{tokens}-context-budget-utilization-percent",
    pattern: /^budget-([1-9]\d{0,15})-context-budget-utilization-percent$/,
    row: { name: "Context budget utilization", def: "estimatedContextTokens / budget * 100 for one selected budget cell.", unit: "percent", interp: "Not capped at 100; an over-budget context can exceed 100.", caveats: ["Unavailable when context size is unavailable."], basis: "derived" }
  },
  {
    pluginId: "context-window-scaling",
    docsSection: "Context-window scaling evidence (v0.7.0)",
    template: "budget-{tokens}-correctness-score",
    pattern: /^budget-([1-9]\d{0,15})-correctness-score$/,
    row: { name: "Correctness score by budget", def: "The existing deterministic answer-key correctness score for one budget cell where the treatment context fits.", unit: "score", interp: "Shared by every budget cell where the treatment's context fits.", caveats: ["Unavailable for a context-too-large cell; not converted to zero."], basis: "answer-key-set-measure" }
  },
  {
    pluginId: "context-window-scaling",
    docsSection: "Context-window scaling evidence (v0.7.0)",
    template: "budget-{tokens}-success",
    pattern: /^budget-([1-9]\d{0,15})-success$/,
    row: { name: "Success by budget", def: "True only when the context fits the budget and the available correctness evidence passes.", unit: "boolean", interp: "A context-too-large cell is an available unsuccessful cell.", caveats: ["Operational or evidence-unavailable cells remain unavailable."], basis: "derived" }
  },
  ...(
    [
      ["fit-count", "Cases whose context fits", "Cases whose estimated context tokens are less than or equal to the budget, for one budget and treatment.", "count"],
      ["context-too-large-count", "Cases whose context is too large", "Cases whose estimated context tokens exceed the budget, for one budget and treatment.", "count"],
      ["successful-cell-count", "Successful cells", "Budget cells counted as successful for one budget and treatment.", "count"],
      ["success-rate-percent", "Success rate", "Successful cells over success-evidence-available cells, as a percentage.", "percent"],
      ["mean-correctness-score", "Mean correctness score", "Mean of available existing correctness scores; unavailable correctness is excluded, not zero.", "score"],
      ["mean-context-budget-utilization-percent", "Mean context budget utilization", "Mean of measured context budget utilization percentages; uncapped, so it may exceed 100.", "percent"]
    ] as const
  ).map(
    ([suffix, name, def, unit]): CatalogFamily => ({
      pluginId: "context-window-scaling",
      docsSection: "Context-window scaling evidence (v0.7.0)",
      template: `context-budget-{tokens}-${suffix}`,
      pattern: new RegExp(`^context-budget-([1-9]\\d{0,15})-${suffix}$`),
      row: { name, def, unit, interp: "Descriptive aggregate for one budget and treatment.", caveats: ["Null (unavailable) when no cell provides the evidence."], basis: "derived" }
    })
  ),
  ...(["retrieval-query-strategy-comparison", "context-pack-generation"] as const).flatMap((pluginId): CatalogFamily[] => {
    const section = pluginId === "context-pack-generation" ? "Context-pack generation metrics (v0.8.2)" : "Retrieval query strategy comparison metrics (v0.8.1)";
    const scoped = (suffix: string, name: string, def: string, unit: string, basis: MetricBasis = "derived"): CatalogFamily => ({
      pluginId,
      docsSection: section,
      template: `{scope}-${suffix}`,
      pattern: new RegExp(`^(?:${SCOPES})-${suffix}$`),
      row: { name, def, unit, interp: "Descriptive per task-type scope; values are not combined or ordered.", caveats: ["Computed over matched comparison cases only; null (unavailable) when none matched."], basis }
    });
    return [
      scoped("comparison-case-count", "Matched comparison cases", "Cases that participate in the cross-strategy or paired aggregation for the scope.", "count"),
      scoped("mean-file-f1", "Mean file F1", "Unweighted mean of per-case file F1 over matched comparison cases.", "ratio"),
      scoped("mean-symbol-f1", "Mean symbol F1", "Unweighted mean of per-case symbol F1 over matched comparison cases.", "ratio"),
      scoped("mean-fact-coverage", "Mean fact coverage", "Unweighted mean of per-case fact coverage over matched comparison cases.", "ratio"),
      pluginId === "context-pack-generation"
        ? scoped("mean-estimated-token-count", "Mean estimated token count", "Unweighted mean of per-case estimated context tokens over matched comparison cases.", "tokens", "estimated")
        : scoped("mean-retrieved-token-count", "Mean retrieved token count", "Unweighted mean of per-case retrieved token counts over matched comparison cases.", "tokens", "estimated")
    ];
  }),
  {
    pluginId: "context-strategy-comparison",
    docsSection: "Experiment and run metrics",
    template: "{comparison}-token-savings-percent",
    pattern: /^.+-token-savings-percent$/,
    row: { name: "Token savings (comparison)", def: "(rawTotalTokens - myDevKitTotalTokens) / rawTotalTokens * 100 for one raw-versus-guided comparison.", unit: "percent", interp: "Positive means my-dev-kit used fewer tokens; negative means it used more.", caveats: ["Only valid when both paired runs expose total tokens; otherwise unavailable."], basis: "derived" }
  },
  {
    pluginId: "context-strategy-comparison",
    docsSection: "Experiment and run metrics",
    template: "{comparison}-correctness-delta",
    pattern: /^.+-correctness-delta$/,
    row: { name: "Correctness delta (comparison)", def: "Guided correctnessScore minus raw correctnessScore for one comparison.", unit: "score", interp: "Positive means the guided strategy scored higher.", caveats: ["Unavailable when either run lacks a correctness score; deterministic answer-key scoring."], basis: "derived" }
  }
];
