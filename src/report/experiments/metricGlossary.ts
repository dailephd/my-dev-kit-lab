// Typed metric glossary for report presentation. Definitions are condensed from docs/METRICS.md, which stays the
// authoritative source of metric meaning. This module performs no calculation and no I/O; it only maps a
// plugin-scoped metric identity to presentation metadata and a stable in-document glossary anchor.

export type MetricMeasurementBasis =
  | "measured"
  | "derived"
  | "estimated"
  | "agent-token-telemetry"
  | "verification-verdict"
  | "answer-key-set-measure"
  | "not-specified";

export type MetricDescriptorV1 = {
  /** Stable plugin-scoped identity: `<pluginId>#<metricId>`. */
  readonly key: string;
  readonly pluginId: string;
  readonly metricId: string;
  readonly displayName: string;
  readonly definition: string;
  readonly unit: string | null;
  /** Stable in-document anchor id used by the static HTML report. */
  readonly anchor: string;
  readonly interpretation: string;
  readonly caveats: readonly string[];
  readonly measurementBasis: MetricMeasurementBasis;
  /** Section of docs/METRICS.md the definition is condensed from (a heading name, never a filesystem link). */
  readonly docsSection: string;
};

type Row = {
  id: string;
  name: string;
  def: string;
  unit?: string;
  interp: string;
  caveats?: string[];
  basis?: MetricMeasurementBasis;
};

type Group = { pluginId: string; docsSection: string; prefix?: string; rows: Row[] };

const AGENT_AVAILABILITY_CAVEAT = "Unavailable evidence is excluded from rates and means and is never converted to zero.";
const ESTIMATE_CAVEAT = "Character-based estimate (ceil(characters / 4)); not provider token usage or billing telemetry.";

const GROUPS: Group[] = [
  {
    pluginId: "agent-success-rate",
    docsSection: "Agent-success-rate metrics (v0.9.0)",
    prefix: "agent-success-rate.",
    rows: [
      { id: "taskChecksPassed", name: "Task checks passed", def: "Every trusted task check passed on the changed state.", unit: "boolean", interp: "true means complete passing task-check evidence.", caveats: ["Unknown if any task check is missing, timed out, or errored."], basis: "verification-verdict" },
      { id: "regressionSafe", name: "Regression safe", def: "Every regression check that passed on the baseline still passes.", unit: "boolean", interp: "Only baseline-passing regression checks are considered.", basis: "verification-verdict" },
      { id: "requiredFactsSatisfied", name: "Required facts satisfied", def: "Every behavior fact marked required has all its verification checks passing.", unit: "boolean", interp: "true means all required facts were verified.", basis: "verification-verdict" },
      { id: "protectedIntegrity", name: "Protected integrity", def: "Protected files are byte-intact after the patch.", unit: "boolean", interp: "true means no protected file changed.", basis: "verification-verdict" },
      { id: "taskResolved", name: "Task resolved", def: "taskChecksPassed AND requiredFactsSatisfied.", unit: "boolean", interp: "A component of taskSuccess.", basis: "verification-verdict" },
      { id: "taskSuccess", name: "Task success", def: "taskResolved AND regressionSafe AND protected files intact.", unit: "boolean", interp: "The only success verdict; agent prose is never evidence.", caveats: ["A patch that was rejected or not applied yields false; an uncomputable verdict is unavailable."], basis: "verification-verdict" },
      { id: "initialAttemptTaskSuccess", name: "Initial-attempt task success", def: "taskSuccess of attempt 1.", unit: "boolean", interp: "Separate from final success; a repaired success never raises it.", caveats: ["Real-agent repair evidence only."], basis: "verification-verdict" },
      { id: "finalTaskSuccess", name: "Final task success", def: "taskSuccess of the last attempt executed.", unit: "boolean", interp: "Equals taskSuccess.", basis: "verification-verdict" },
      { id: "repairSucceeded", name: "Repair succeeded", def: "initialAttemptTaskSuccess is false AND finalTaskSuccess is true.", unit: "boolean", interp: "true means a failed initial attempt was repaired.", caveats: ["Not applicable when no repair attempt ran; unavailable if either verdict is unavailable."], basis: "verification-verdict" },
      { id: "repairSuccessRate", name: "Repair success rate", def: "Repaired cases / repair-attempted cases with a determinate repair verdict.", unit: "ratio", interp: "Descriptive rate over a finite controlled corpus.", caveats: ["Not applicable when no repair attempt ran for the treatment."], basis: "derived" },
      { id: "taskSuccessRate", name: "Task success rate", def: "Successful cases / cases with a determinate verdict for that attempt basis.", unit: "ratio", interp: "Descriptive; no effect estimate or significance test is produced.", caveats: ["Unavailable when no case has a determinate verdict."], basis: "derived" },
      { id: "initialAttemptSuccessRate", name: "Initial-attempt success rate", def: "Successful cases / cases with a determinate initial-attempt verdict.", unit: "ratio", interp: "Measured separately from the final rate.", basis: "derived" },
      { id: "finalTaskSuccessRate", name: "Final task success rate", def: "Successful cases / cases with a determinate final-attempt verdict.", unit: "ratio", interp: "A repaired success raises this rate, never the initial rate.", basis: "derived" },
      { id: "taskCheckPassRate", name: "Task check pass rate", def: "Passed task checks / task checks.", unit: "ratio", interp: "taskCheckPassedCount / taskCheckTotalCount.", caveats: ["Unavailable unless every task check has a complete result; not applicable with zero checks."], basis: "derived" },
      { id: "taskCheckPassedCount", name: "Task checks passed (count)", def: "Numerator of taskCheckPassRate: passed task checks.", unit: "count", interp: "Read with taskCheckTotalCount.", basis: "derived" },
      { id: "taskCheckTotalCount", name: "Task checks (count)", def: "Denominator of taskCheckPassRate: task checks.", unit: "count", interp: "Read with taskCheckPassedCount.", basis: "derived" },
      { id: "regressionCheckPassRate", name: "Regression check pass rate", def: "Passed regression checks / regression checks.", unit: "ratio", interp: "regressionCheckPassedCount / regressionCheckTotalCount.", basis: "derived" },
      { id: "regressionCheckPassedCount", name: "Regression checks passed (count)", def: "Numerator of regressionCheckPassRate.", unit: "count", interp: "Read with regressionCheckTotalCount.", basis: "derived" },
      { id: "regressionCheckTotalCount", name: "Regression checks (count)", def: "Denominator of regressionCheckPassRate.", unit: "count", interp: "Read with regressionCheckPassedCount.", basis: "derived" },
      { id: "regressionFailureCount", name: "Regression failures (count)", def: "Failed checks that passed on the baseline.", unit: "count", interp: "Lower is better.", basis: "derived" },
      { id: "requiredFactCoverage", name: "Required fact coverage", def: "Satisfied required facts / required facts.", unit: "ratio", interp: "requiredFactsSatisfiedCount / requiredFactsTotal.", caveats: ["Not applicable with no required facts."], basis: "derived" },
      { id: "requiredFactsSatisfiedCount", name: "Required facts satisfied (count)", def: "Numerator of requiredFactCoverage.", unit: "count", interp: "Read with requiredFactsTotal.", basis: "derived" },
      { id: "requiredFactsTotal", name: "Required facts (count)", def: "Denominator of requiredFactCoverage.", unit: "count", interp: "Read with requiredFactsSatisfiedCount.", basis: "derived" },
      { id: "factCoverage", name: "Fact coverage", def: "Satisfied facts (required and optional) / all facts.", unit: "ratio", interp: "Higher means more behavior facts were verified.", caveats: ["Not applicable with no facts."], basis: "derived" },
      { id: "expectedEditCoverage", name: "Expected edit coverage", def: "Changed files that were expected / expected edit files.", unit: "ratio", interp: "expectedEditFilesChangedCount / expectedEditFileCount.", basis: "derived" },
      { id: "expectedEditFilesChangedCount", name: "Expected edit files changed (count)", def: "Numerator of expectedEditCoverage.", unit: "count", interp: "Read with expectedEditFileCount.", basis: "derived" },
      { id: "expectedEditFileCount", name: "Expected edit files (count)", def: "Denominator of expectedEditCoverage.", unit: "count", interp: "Read with expectedEditFilesChangedCount.", basis: "derived" },
      { id: "editScopePrecision", name: "Edit scope precision", def: "Changed files inside the allowed edit scope / changed files.", unit: "ratio", interp: "allowedEditChangedFileCount / changedFileCount.", caveats: ["Not applicable when no file changed."], basis: "derived" },
      { id: "allowedEditChangedFileCount", name: "Allowed-scope changed files (count)", def: "Changed files inside the allowed edit scope.", unit: "count", interp: "Numerator of editScopePrecision.", basis: "derived" },
      { id: "unexpectedChangedFileCount", name: "Unexpected changed files (count)", def: "Changed files minus changed files inside the allowed scope.", unit: "count", interp: "Files outside the allowed scope.", basis: "derived" },
      { id: "protectedMutationCount", name: "Protected mutations (count)", def: "Protected paths found mutated after the patch.", unit: "count", interp: "Lower is better.", caveats: ["Unavailable if integrity could not be proven."], basis: "derived" },
      { id: "attemptedProtectedEditCount", name: "Attempted protected edits (count)", def: "Protected paths a patch tried to edit.", unit: "count", interp: "Counts attempts, separate from protectedMutationCount.", basis: "derived" },
      { id: "changedFileCount", name: "Changed files (count)", def: "Captured changed files of the final attempt.", unit: "count", interp: "Blast-radius evidence for the final patch.", caveats: ["Unavailable, not zero, when no patch was applied."], basis: "derived" },
      { id: "addedFileCount", name: "Added files (count)", def: "Captured changed files with added status.", unit: "count", interp: "Final attempt only.", basis: "derived" },
      { id: "modifiedFileCount", name: "Modified files (count)", def: "Captured changed files with modified status.", unit: "count", interp: "Final attempt only.", basis: "derived" },
      { id: "deletedFileCount", name: "Deleted files (count)", def: "Captured changed files with deleted status.", unit: "count", interp: "Final attempt only.", basis: "derived" },
      { id: "linesAdded", name: "Lines added", def: "Sum of per-file additions.", unit: "lines", interp: "Final patch only.", caveats: ["Unavailable if any changed file has no line counts (binary); never estimated."], basis: "derived" },
      { id: "linesDeleted", name: "Lines deleted", def: "Sum of per-file deletions.", unit: "lines", interp: "Final patch only.", caveats: ["Unavailable if any changed file has no line counts (binary); never estimated."], basis: "derived" },
      { id: "totalChurn", name: "Total churn", def: "linesAdded + linesDeleted.", unit: "lines", interp: "The final patch's churn, not churn accumulated over repair attempts.", basis: "derived" },
      { id: "baselineTextLineCount", name: "Baseline text line count", def: "Baseline text-line count used as the relativeChurn denominator.", unit: "lines", interp: "Context for relativeChurn.", basis: "measured" },
      { id: "relativeChurn", name: "Relative churn", def: "totalChurn / baselineTextLineCount.", unit: "ratio", interp: "Churn relative to the baseline size.", caveats: ["Unavailable when the baseline text-line count is unknown; not applicable at zero baseline lines."], basis: "derived" },
      { id: "agentDurationMs", name: "Agent duration", def: "Measured wall-clock duration of the provider attempt.", unit: "ms", interp: "Lab-measured elapsed time, not provider-native time.", caveats: ["Unavailable in deterministic mode and when no provider ran."], basis: "measured" },
      { id: "totalProviderDurationMs", name: "Total provider duration", def: "Sum of provider durations over attempts that ran.", unit: "ms", interp: "Includes repair attempts.", caveats: ["Unavailable if any invoked attempt was not measured."], basis: "measured" },
      { id: "agentTotalTokens", name: "Agent total tokens", def: "Total token usage reported for the attempt.", unit: "tokens", interp: "Read with the recorded token source and reliability.", caveats: ["Unavailable when no usage was reported; the report model does not carry the per-attempt source or reliability."], basis: "agent-token-telemetry" },
      { id: "totalProviderTokens", name: "Total provider tokens", def: "Sum of provider total tokens over attempts that ran.", unit: "tokens", interp: "Accumulates over repair attempts.", caveats: ["Unavailable if any invoked attempt lacks a total."], basis: "agent-token-telemetry" },
      { id: "baselineVerificationDurationMs", name: "Baseline verification duration", def: "Measured duration of the evaluator's baseline verification stage.", unit: "ms", interp: "Evaluator time, not agent time.", basis: "measured" },
      { id: "patchPipelineDurationMs", name: "Patch pipeline duration", def: "Measured duration of the evaluator's patch pipeline stage.", unit: "ms", interp: "Evaluator time, not agent time.", basis: "measured" },
      { id: "postEditVerificationDurationMs", name: "Post-edit verification duration", def: "Measured duration of the evaluator's post-edit verification stage.", unit: "ms", interp: "Evaluator time, not agent time.", basis: "measured" },
      { id: "evaluationDurationMs", name: "Evaluation duration", def: "Measured duration of the evaluator's own stages.", unit: "ms", interp: "Evaluator time, not agent time.", basis: "measured" },
      { id: "totalEvaluationDurationMs", name: "Total evaluation duration", def: "Sum of evaluation durations over attempts.", unit: "ms", interp: "Evaluator time, not agent time.", basis: "measured" },
      { id: "meanTaskCheckPassRate", name: "Mean task check pass rate", def: "Unweighted mean of taskCheckPassRate over matched cases.", unit: "ratio", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanRegressionCheckPassRate", name: "Mean regression check pass rate", def: "Unweighted mean of regressionCheckPassRate over matched cases.", unit: "ratio", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanRequiredFactCoverage", name: "Mean required fact coverage", def: "Unweighted mean of requiredFactCoverage over matched cases.", unit: "ratio", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanExpectedEditCoverage", name: "Mean expected edit coverage", def: "Unweighted mean of expectedEditCoverage over matched cases.", unit: "ratio", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanEditScopePrecision", name: "Mean edit scope precision", def: "Unweighted mean of editScopePrecision over matched cases.", unit: "ratio", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanUnexpectedChangedFileCount", name: "Mean unexpected changed files", def: "Unweighted mean of unexpectedChangedFileCount over matched cases.", unit: "count", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanChangedFileCount", name: "Mean changed files", def: "Unweighted mean of changedFileCount over matched cases.", unit: "count", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanTotalChurn", name: "Mean total churn", def: "Unweighted mean of totalChurn over matched cases.", unit: "lines", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanRelativeChurn", name: "Mean relative churn", def: "Unweighted mean of relativeChurn over matched cases.", unit: "ratio", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
      { id: "meanEvaluationDurationMs", name: "Mean evaluation duration", def: "Unweighted mean of evaluationDurationMs over matched cases.", unit: "ms", interp: "Descriptive.", caveats: [AGENT_AVAILABILITY_CAVEAT], basis: "derived" },
    ],
  },
  {
    pluginId: "warm-index-reuse",
    docsSection: "Warm-index reuse metrics",
    rows: [
      { id: "context-character-count", name: "Context characters", def: "Characters in the raw full-file context or in the retrieved my-dev-kit context.", unit: "characters", interp: "Context size by characters.", caveats: ["Unavailable when that side produced no evidence."], basis: "measured" },
      { id: "context-estimated-token-count", name: "Estimated context tokens", def: "Character-based context-size estimate, ceil(characters / 4).", unit: "tokens", interp: "Estimated context size.", caveats: [ESTIMATE_CAVEAT], basis: "estimated" },
      { id: "operation-duration-ms", name: "Operation duration", def: "Time to build the raw full-file context, or the warm retrieval duration against the prepared index.", unit: "ms", interp: "Not agent duration and never includes the index build.", basis: "measured" },
      { id: "amortized-index-build-duration-ms", name: "Amortized index build duration", def: "indexBuildDurationMs / N for task ordinal N, without rounding.", unit: "ms", interp: "Shows the fixed index cost falling per task.", caveats: ["Available only when the project prepared a valid index session."], basis: "derived" },
      { id: "cumulative-component-duration-ms", name: "Cumulative component duration", def: "Sum of measured component durations for tasks 1..N (the warm side counts the index build once).", unit: "ms", interp: "A sum of measured components.", caveats: ["Not wall-clock or end-to-end latency, and not a speedup claim."], basis: "derived" },
      { id: "cumulative-context-estimated-token-count", name: "Cumulative estimated context tokens", def: "Sum of that side's estimated context tokens for tasks 1..N.", unit: "tokens", interp: "Estimated size only.", caveats: [ESTIMATE_CAVEAT, "Strict-prefix rule: unavailable after the first incomplete task."], basis: "estimated" },
      { id: "agent-correctness-score", name: "Agent correctness score", def: "correctnessScore from the benchmark answer-key scorer for the selected agent output.", unit: "score", interp: "Deterministic answer-key scoring.", caveats: ["Not semantic LLM judging; deterministic fake-agent evidence is not real-model correctness."], basis: "answer-key-set-measure" },
      { id: "agent-total-tokens", name: "Agent total tokens", def: "tokenUsage.totalTokens as reported by the selected agent adapter.", unit: "tokens", interp: "Read with the recorded token source and reliability.", caveats: ["Fake-agent totals are simulated harness telemetry; context estimates are never substituted."], basis: "agent-token-telemetry" },
      { id: "cumulative-agent-total-tokens", name: "Cumulative agent total tokens", def: "Sum of agent total tokens for tasks 1..N on that side.", unit: "tokens", interp: "Read with the per-task token source and reliability.", caveats: ["Strict-prefix rule: unavailable after the first incomplete task."], basis: "agent-token-telemetry" },
      { id: "affected-neighborhood-changed-file-count", name: "Affected neighborhood: changed files", def: "Unique confirmed modified or missing files that the index snapshot represents.", unit: "count", interp: "Observational evidence only.", caveats: ["New files the snapshot does not represent are not counted."], basis: "derived" },
      { id: "affected-neighborhood-changed-symbol-count", name: "Affected neighborhood: changed symbols", def: "Unique baseline symbol identities that belong to confirmed changed indexed files.", unit: "count", interp: "Observational evidence only.", caveats: ["Does not prove an individual symbol's own source changed."], basis: "derived" },
      { id: "affected-neighborhood-node-count", name: "Affected neighborhood: nodes", def: "Unique graph node IDs among resolved seed nodes and their direct one-hop neighbors.", unit: "count", interp: "Observational evidence only.", basis: "derived" },
      { id: "affected-neighborhood-edge-count", name: "Affected neighborhood: edges", def: "Unique baseline graph edges incident to at least one resolved seed node.", unit: "count", interp: "Observational evidence only.", caveats: ["Not the number of edges among all affected nodes."], basis: "derived" },
      { id: "affected-neighborhood-task-overlap-count", name: "Affected neighborhood: task overlap", def: "Unique graph nodes in both the affected neighborhood and the task's resolved task nodes.", unit: "count", interp: "Observational evidence only.", basis: "derived" },
      { id: "affected-neighborhood-task-overlap-percent", name: "Affected neighborhood: task overlap percent", def: "taskOverlapCount / resolvableTaskNodeCount * 100, unrounded.", unit: "percent", interp: "Covers only the resolvable subset when task mapping is partial.", caveats: ["Unavailable, never zero, when there are no resolvable task nodes."], basis: "derived" },
    ],
  },
  {
    pluginId: "context-window-scaling",
    docsSection: "Context-window scaling evidence (v0.7.0)",
    rows: [
      { id: "context-estimated-tokens", name: "Context estimated tokens", def: "Estimated token count of the treatment context using ceil(characters / 4).", unit: "tokens", interp: "Not a provider tokenizer result or model-window measurement.", caveats: [ESTIMATE_CAVEAT], basis: "estimated" },
      { id: "omitted-relevant-file-count", name: "Omitted relevant files", def: "Benchmark-expected relevant files absent from the treatment's observed context provenance.", unit: "files", interp: "An evidence count, not retrieval precision or recall.", basis: "derived" },
    ],
  },
  {
    pluginId: "retrieval-precision-recall",
    docsSection: "Retrieval precision/recall evidence (v0.8.0)",
    rows: [
      { id: "file-precision", name: "File precision", def: "Relevant retrieved files / retrieved files.", unit: "ratio", interp: "Higher means a larger share of retrieved files were expected.", caveats: ["Not applicable, not zero, when no file was retrieved."], basis: "answer-key-set-measure" },
      { id: "file-recall", name: "File recall", def: "Relevant retrieved files / expected files.", unit: "ratio", interp: "Higher means more expected files were retrieved.", caveats: ["Not applicable with no expected files."], basis: "answer-key-set-measure" },
      { id: "symbol-precision", name: "Symbol precision", def: "Relevant retrieved symbol names / retrieved symbol names (exact, case-sensitive).", unit: "ratio", interp: "No fuzzy or semantic matching.", basis: "answer-key-set-measure" },
      { id: "symbol-recall", name: "Symbol recall", def: "Relevant retrieved symbol names / expected symbol names (exact, case-sensitive).", unit: "ratio", interp: "No fuzzy or semantic matching.", basis: "answer-key-set-measure" },
      { id: "fact-coverage", name: "Fact coverage", def: "Covered expected facts / all expected facts through explicit factIds-to-context mappings.", unit: "ratio", interp: "Unweighted; no fact-prose matching or model judge.", caveats: ["Unavailable when a required fact has no usable mapping."], basis: "answer-key-set-measure" },
      { id: "irrelevant-context-ratio", name: "Irrelevant context ratio", def: "Irrelevant retrieved files / retrieved files.", unit: "ratio", interp: "A diagnostic complement of file precision, not an independent ranking metric.", basis: "answer-key-set-measure" },
      { id: "retrieved-token-count", name: "Retrieved token count", def: "The selected retrieval context's totalEstimatedTokens, ceil(characters / 4).", unit: "tokens", interp: "Context-size evidence.", caveats: [ESTIMATE_CAVEAT, "Not a per-file relevant-token attribution."], basis: "estimated" },
    ],
  },
  {
    pluginId: "retrieval-query-strategy-comparison",
    docsSection: "Retrieval query strategy comparison metrics (v0.8.1)",
    rows: [
      { id: "retrieved-token-count", name: "Retrieved token count", def: "The measured retrieval payload size, ceil(character count / 4) through the existing estimator.", unit: "tokens", interp: "Context-size evidence.", caveats: [ESTIMATE_CAVEAT, "Not tokenizer-exact model usage and not a relevant-token attribution."], basis: "estimated" },
    ],
  },
  {
    pluginId: "context-pack-generation",
    docsSection: "Context-pack generation metrics (v0.8.2)",
    rows: [
      { id: "estimated-token-count", name: "Estimated context tokens", def: "Estimated context size using ceil(character count / 4).", unit: "tokens", interp: "Not a provider tokenizer or billing measurement.", caveats: [ESTIMATE_CAVEAT], basis: "estimated" },
      { id: "tokens-saved", name: "Estimated tokens saved", def: "rawEstimatedTokens - packEstimatedTokens for a matched case.", unit: "tokens", interp: "Negative savings are valid and are not clamped.", caveats: [ESTIMATE_CAVEAT], basis: "estimated" },
      { id: "percent-saved", name: "Estimated percent saved", def: "tokensSaved / rawEstimatedTokens * 100 (zero when the raw estimate is zero).", unit: "percent", interp: "Negative values are valid and are not clamped.", caveats: [ESTIMATE_CAVEAT], basis: "estimated" },
      { id: "estimated-token-delta", name: "Estimated token delta", def: "Pack-minus-raw estimated tokens for a matched case.", unit: "tokens", interp: "Descriptive; no composite score.", caveats: [ESTIMATE_CAVEAT], basis: "estimated" },
      { id: "file-f1-delta", name: "File F1 delta", def: "Pack-minus-raw file F1 for a matched case.", unit: "score", interp: "Descriptive; no composite score.", basis: "answer-key-set-measure" },
      { id: "symbol-f1-delta", name: "Symbol F1 delta", def: "Pack-minus-raw symbol F1 for a matched case.", unit: "score", interp: "Descriptive; no composite score.", basis: "answer-key-set-measure" },
      { id: "fact-coverage-delta", name: "Fact coverage delta", def: "Pack-minus-raw fact coverage for a matched case.", unit: "score", interp: "Descriptive; no composite score.", basis: "answer-key-set-measure" },
    ],
  },
  {
    pluginId: "context-strategy-comparison",
    docsSection: "Experiment and run metrics",
    rows: [
      { id: "average-token-savings-percent", name: "Average token savings percent", def: "Average of tokenSavingsPercent: (rawTotalTokens - myDevKitTotalTokens) / rawTotalTokens * 100.", unit: "percent", interp: "Positive means my-dev-kit used fewer tokens; negative means it used more.", caveats: ["Only valid when both paired runs expose total tokens."], basis: "derived" },
      { id: "average-duration-reduction-percent", name: "Average duration reduction percent", def: "Average of durationReductionPercent: (rawDurationMs - myDevKitDurationMs) / rawDurationMs * 100.", unit: "percent", interp: "Positive means my-dev-kit was faster; negative means it was slower.", caveats: ["Local machine noise affects timing."], basis: "derived" },
    ],
  },
];

/**
 * Agent-success metric ids the plugin can emit that docs/METRICS.md does not yet define. They stay renderable,
 * receive no invented definition and no glossary link, and produce a bounded missing-metadata warning.
 */
export const AGENT_SUCCESS_UNMAPPED_METRIC_IDS: readonly string[] = Object.freeze([
  "patchApplied",
  "optionalFactsTotal",
  "optionalFactsSatisfiedCount",
  "attemptCount",
  "repairAttemptCount",
  "evaluableCaseCount",
  "successfulCaseCount",
  "initialAttemptSuccessfulCount",
  "finalSuccessfulCount",
  "repairAttemptedCaseCount",
  "repairedCaseCount",
  "meanAttemptsPerEvaluableCase",
  "firstAttemptProviderDurationMs",
  "finalAttemptProviderDurationMs",
  "firstAttemptProviderTokens",
  "finalAttemptProviderTokens",
]);

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function metricGlossaryAnchor(pluginId: string, metricId: string): string {
  return `metric-${slug(pluginId)}--${slug(metricId)}`;
}

const DESCRIPTORS: readonly MetricDescriptorV1[] = (() => {
  const out: MetricDescriptorV1[] = [];
  const anchors = new Map<string, string>();
  for (const group of GROUPS) {
    for (const row of group.rows) {
      const key = `${group.pluginId}#${row.id}`;
      const anchor = metricGlossaryAnchor(group.pluginId, row.id);
      const clash = anchors.get(anchor);
      if (clash !== undefined && clash !== key) {
        throw new Error(`Metric glossary anchor collision: ${key} and ${clash}.`);
      }
      if (anchors.has(anchor)) throw new Error(`Duplicate metric glossary entry: ${key}.`);
      anchors.set(anchor, key);
      out.push(
        Object.freeze({
          key,
          pluginId: group.pluginId,
          metricId: row.id,
          displayName: row.name,
          definition: row.def,
          unit: row.unit ?? null,
          anchor,
          interpretation: row.interp,
          caveats: Object.freeze([...(row.caveats ?? [])]),
          measurementBasis: row.basis ?? "not-specified",
          docsSection: group.docsSection,
        })
      );
    }
  }
  return Object.freeze(out);
})();

const BY_KEY = new Map(DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor]));
const PREFIX_BY_PLUGIN = new Map(GROUPS.filter((g) => g.prefix).map((g) => [g.pluginId, g.prefix as string]));

/** All glossary descriptors, in deterministic table order. */
export function listMetricDescriptors(): readonly MetricDescriptorV1[] {
  return DESCRIPTORS;
}

/** The plugin-local metric id for a rendered generic metric id (strips a plugin's own id prefix). */
export function pluginLocalMetricId(pluginId: string, renderedMetricId: string): string {
  const prefix = PREFIX_BY_PLUGIN.get(pluginId);
  return prefix !== undefined && renderedMetricId.startsWith(prefix) ? renderedMetricId.slice(prefix.length) : renderedMetricId;
}

/**
 * Resolves a rendered metric to its descriptor. The identity is always plugin-scoped: the same short id under
 * a different plugin is a different metric and is never matched. Unknown ids return null.
 */
export function resolveMetricDescriptor(pluginId: string, renderedMetricId: string): MetricDescriptorV1 | null {
  return BY_KEY.get(`${pluginId}#${pluginLocalMetricId(pluginId, renderedMetricId)}`) ?? null;
}
