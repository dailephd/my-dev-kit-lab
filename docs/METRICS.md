# Metrics

This document is the canonical metric glossary for my-dev-kit-lab. It defines every metric that appears in benchmark profiles, prompt variants, controlled experiment artifacts, and rendered reports.

Related documentation:
- [ARCHITECTURE.md](ARCHITECTURE.md) — how metrics flow through the pipeline
- [TUTORIAL.md](TUTORIAL.md) — how to read token savings and correctness scores in the report
- [CURRENT_STATE.md](CURRENT_STATE.md) — current baseline and limitations

## Metric interpretation quick reference

| Metric | Positive means | Negative means | N/A means |
|---|---|---|---|
| `tokenSavings` | my-dev-kit used fewer tokens | my-dev-kit used more tokens | Token totals unavailable for one or both runs |
| `correctnessScore` | More answer-key facts matched | Fewer answer-key facts matched | Run did not complete |
| `complexityScore` | Higher project complexity | Lower project complexity | — |

**Token savings notes:**
- A positive token savings value means the my-dev-kit-guided strategy used fewer tokens than raw-full-file for that run pair.
- A negative token savings value means my-dev-kit-guided used more tokens. This can happen on small projects where raw-full-file is cheaper.
- Token savings are only computed when both paired runs expose token totals. Claude does not expose token totals. Codex may expose token totals but can produce timeouts or invalid-output runs.
- Token counts in fake-agent runs are estimated using `Math.ceil(characterCount / 4)`. These are context-size estimates, not provider billing totals.

**Correctness scoring notes:**
- Correctness is scored deterministically against benchmark answer keys. It is not semantic LLM judging.
- A run passes if it meets or exceeds the `minimumCorrectFacts` threshold defined in the answer key.

**Complexity score notes:**
- The complexity score is a heuristic 0-100 weighted score. Higher scores indicate projects where raw full-file reading is less attractive.
- Small projects may show negative token savings because raw-full-file is cheaper when the entire project fits easily in context.
- Larger, more localized tasks are where my-dev-kit is expected to become more useful.

## Project Complexity Metrics

- `fileCount`
  Meaning: total non-generated files captured in the benchmark file tree.
  Appears in: `benchmarks/contracts/benchmark-project-profiles.json`, experiment report project sections.
  Formula: count of file entries in `src/evaluation/projectFileTree.ts`.
  Interpretation: higher means more total files to scan.
  Caveat: includes config and docs files, not only source.
- `sourceFileCount`
  Meaning: number of source-role files in the benchmark project.
  Appears in: project profiles and reports.
  Formula: file-tree entries where role is `source`.
  Interpretation: higher means broader implementation surface.
  Caveat: role detection is path-based.
- `testFileCount`
  Meaning: number of test-role files in the benchmark project.
  Appears in: project profiles and reports.
  Formula: file-tree entries where role is `test`.
  Interpretation: higher can increase raw full-file context size.
  Caveat: test helpers outside test roots still depend on role detection.
- `totalLinesOfCode`
  Meaning: approximate code lines across source and test files.
  Appears in: project profiles and reports.
  Formula: nonblank, non-comment lines counted by `countApproximateCodeLines`.
  Interpretation: higher means more code context overall.
  Caveat: this is approximate and language-agnostic.
- `sourceLinesOfCode`
  Meaning: approximate code lines across source files only.
  Appears in: project profiles and reports.
  Formula: approximate code-line count over source-role files.
  Interpretation: higher usually means more production logic.
  Caveat: comment stripping is simple.
- `testLinesOfCode`
  Meaning: approximate code lines across test files only.
  Appears in: project profiles and reports.
  Formula: approximate code-line count over test-role files.
  Interpretation: higher can increase context noise for raw reads.
  Caveat: tests may still be relevant to answer-key tasks.
- `languageCount`
  Meaning: number of detected code languages in source and test files.
  Appears in: project profiles and reports.
  Formula: unique language count from file-tree metadata.
  Interpretation: higher means more language switching cost.
  Caveat: only known file extensions are counted.
- `internalImportCount`
  Meaning: approximate count of local/internal imports in source files.
  Appears in: project profiles and reports.
  Formula: import-pattern count from `countInternalImports`.
  Interpretation: higher means more cross-file coupling.
  Caveat: regex-based and approximate.
- `exportedSymbolEstimate`
  Meaning: approximate count of exported or top-level callable symbols.
  Appears in: project profiles and reports.
  Formula: regex-based count from `countExportedSymbols`.
  Interpretation: higher means more symbol-selection work.
  Caveat: Python counting treats top-level defs/classes as exported.
- `taskCount`
  Meaning: number of benchmark tasks associated with the project suite or case set used to profile it.
  Appears in: project profiles and reports.
  Formula: provided task stats input during profile generation.
  Interpretation: higher suggests broader benchmark coverage.
  Caveat: this is metadata, not code structure.
- `expectedRelevantFilesAverage`
  Meaning: average count of expected relevant files across answer-key tasks.
  Appears in: project profiles and reports.
  Formula: average expected-file count from profiled tasks.
  Interpretation: higher means tasks span more files.
  Caveat: depends on case selection quality.
- `expectedRelevantSymbolsAverage`
  Meaning: average count of expected relevant symbols across answer-key tasks.
  Appears in: project profiles and reports.
  Formula: average expected-symbol count from profiled tasks.
  Interpretation: higher means symbol selection is less trivial.
  Caveat: depends on answer-key breadth.
- `maxFileLines`
  Meaning: maximum raw line count of any code file in the project.
  Appears in: project profiles and reports.
  Formula: max `lines` value from code-role file-tree entries.
  Interpretation: higher means a single-file read can be heavier.
  Caveat: uses raw line counts, not approximate code lines.
- `averageFileLines`
  Meaning: average raw line count across code files.
  Appears in: project profiles and reports.
  Formula: average `lines` value across source and test code entries.
  Interpretation: higher means broader files on average.
  Caveat: small files and tests can pull the average down.
- `complexityScore`
  Meaning: 0-100 weighted project complexity score.
  Appears in: project profiles and experiment reports.
  Formula: `benchmark-project-complexity-v1` in `src/evaluation/projectComplexity.ts`.
  Interpretation: higher means raw full-file reading should be less attractive.
  Caveat: it is heuristic, not a runtime truth metric.
- `complexityLevel`
  Meaning: bucketed project size label such as `small`, `medium`, or `large`.
  Appears in: project profiles and reports.
  Formula: manually assigned profile label.
  Interpretation: human-readable size category.
  Caveat: coarse label; use the score and metrics for detail.

## Prompt Complexity Metrics

- `promptChars`
  Meaning: prompt length in characters.
  Appears in: prompt variants, experiment runs, and prompt report tables.
  Formula: `promptText.length`.
  Interpretation: higher means more instruction payload.
  Caveat: character count is not provider billing.
- `promptEstimatedTokens`
  Meaning: estimated prompt tokens.
  Appears in: prompt variants and prompt report tables.
  Formula: `estimated_chars_div_4` via `src/core/countTokens.ts`.
  Interpretation: useful for rough relative comparisons.
  Caveat: not provider-reported usage.
- `instructionCount`
  Meaning: approximate count of instruction-like phrases in the prompt.
  Appears in: prompt report tables.
  Formula: regex count in `measurePromptComplexity`.
  Interpretation: higher means denser instruction framing.
  Caveat: approximate text heuristic.
- `constraintCount`
  Meaning: approximate count of constraint-like phrases in the prompt.
  Appears in: prompt report tables.
  Formula: regex count in `measurePromptComplexity`.
  Interpretation: higher means tighter behavioral constraints.
  Caveat: approximate text heuristic.
- `requestedOutputFieldCount`
  Meaning: count of output fields explicitly requested from the agent.
  Appears in: prompt report tables.
  Formula: number of known field names found in the prompt text.
  Interpretation: higher means a more structured answer contract.
  Caveat: limited to predefined field names.
- `taskStepCount`
  Meaning: count of numbered steps in the prompt body.
  Appears in: prompt report tables.
  Formula: regex count of `1.`, `2.`, and so on.
  Interpretation: higher means more explicit workflow steps.
  Caveat: only numbered steps count.
- `expectedFactCount`
  Meaning: number of answer-key facts in scope for the prompt.
  Appears in: prompt report tables.
  Formula: answer-key fact count.
  Interpretation: higher means more correctness evidence required.
  Caveat: depends on case design.
- `expectedFileCount`
  Meaning: number of expected relevant files in the answer key.
  Appears in: prompt report tables.
  Formula: answer-key expected-file count.
  Interpretation: higher means broader context demand.
  Caveat: answer-key driven.
- `expectedSymbolCount`
  Meaning: number of expected relevant symbols in the answer key.
  Appears in: prompt report tables.
  Formula: answer-key expected-symbol count.
  Interpretation: higher means more symbol-level targeting.
  Caveat: answer-key driven.
- `requiresGraphGuidedRetrieval`
  Meaning: whether the prompt explicitly requires my-dev-kit retrieval flow.
  Appears in: prompt report tables.
  Formula: `strategy === "my-dev-kit-guided"`.
  Interpretation: `true` means command-guided retrieval is expected.
  Caveat: not a guarantee that the agent followed it.
- `requiresCommandExecution`
  Meaning: whether the prompt expects command execution.
  Appears in: prompt report tables.
  Formula: `strategy === "my-dev-kit-guided"`.
  Interpretation: `true` means retrieval commands are part of the task.
  Caveat: prompt intent only.

## Experiment And Run Metrics

- `durationMs`
  Meaning: measured wall-clock duration of a normalized run.
  Appears in: experiment runs, comparisons, and reports.
  Formula: runtime duration from `runMeasuredCommand` or orchestrator timing.
  Interpretation: lower is faster.
  Caveat: includes local CLI overhead.
- `status`
  Meaning: normalized run outcome such as `completed`, `failed`, `timeout`, `agent-unavailable`, `agent-limit-reached`, or `invalid-output`.
  Appears in: experiment runs and reports.
  Formula: outcome classification in `src/evaluation/classifyAgentRunOutcome.ts`.
  Interpretation: explains whether a run is usable for comparison.
  Caveat: external account/session failures are not code regressions.
- `tokenUsageSource`
  Meaning: where token counts came from.
  Appears in: experiment runs and reports.
  Formula: adapter normalization from `src/agents`.
  Interpretation: provider-reported sources are stronger than missing values.
  Caveat: depends on adapter output format.
- `tokenUsageReliability`
  Meaning: trust label for token usage fields.
  Appears in: experiment runs and reports.
  Formula: adapter normalization from `src/agents`.
  Interpretation: stronger labels mean better comparison quality.
  Caveat: missing or partial token fields reduce reliability.
- `inputTokens`
  Meaning: provider-reported input token count when available.
  Appears in: experiment runs and reports.
  Formula: parsed from agent output.
  Interpretation: lower means less prompt/context input.
  Caveat: may be unavailable.
- `outputTokens`
  Meaning: provider-reported output token count when available.
  Appears in: experiment runs and reports.
  Formula: parsed from agent output.
  Interpretation: lower means a shorter generated response.
  Caveat: may be unavailable.
- `totalTokens`
  Meaning: provider-reported total token count when available.
  Appears in: experiment runs, comparisons, and reports.
  Formula: parsed from agent output or combined provider fields.
  Interpretation: used for token savings comparisons.
  Caveat: prompt estimates do not replace missing totals.
- `correctnessScore`
  Meaning: deterministic answer-key-based correctness score.
  Appears in: correctness artifacts and reports.
  Formula: `0.25 * fileMatchScore + 0.25 * symbolMatchScore + 0.50 * factMatchScore`.
  Interpretation: higher is better; pass threshold is `>= 0.70` with required fact checks.
  Caveat: not semantic judging.
- `fileMatchScore`
  Meaning: fraction of expected files found by the parsed answer.
  Appears in: correctness artifacts and reports.
  Formula: expected files found divided by expected files total.
  Interpretation: higher means better file targeting.
  Caveat: exact-file matching is strict.
- `symbolMatchScore`
  Meaning: fraction of expected symbols found by the parsed answer.
  Appears in: correctness artifacts and reports.
  Formula: expected symbols found divided by expected symbols total.
  Interpretation: higher means better symbol targeting.
  Caveat: depends on parsed answer quality.
- `factMatchScore`
  Meaning: weighted fraction of expected facts found by the parsed answer.
  Appears in: correctness artifacts and reports.
  Formula: matched fact weights divided by total fact weights.
  Interpretation: higher means better factual correctness coverage.
  Caveat: answer-key fact wording still matters.
- `tokenSavingsPercent`
  Meaning: percent reduction in total tokens for my-dev-kit versus raw full-file.
  Appears in: experiment comparisons, summaries, and reports.
  Formula: `(rawTotalTokens - myDevKitTotalTokens) / rawTotalTokens * 100`.
  Interpretation: positive means my-dev-kit used fewer tokens; negative means it used more.
  Caveat: only valid when both paired runs expose total tokens.
- `durationReductionPercent`
  Meaning: percent reduction in wall-clock duration for my-dev-kit versus raw full-file.
  Appears in: experiment comparisons, summaries, and reports.
  Formula: `(rawDurationMs - myDevKitDurationMs) / rawDurationMs * 100`.
  Interpretation: positive means my-dev-kit was faster; negative means it was slower.
  Caveat: local machine noise affects timing.
- `reliabilityLabel`
  Meaning: comparison-level quality label such as `strong`, `correctness-only`, `partial`, `unavailable`, `limit-reached`, or `failed`.
  Appears in: experiment comparisons and reports.
  Formula: derived from paired run outcomes and metric availability.
  Interpretation: stronger labels mean safer aggregate interpretation.
  Caveat: comparison reliability is not the same as correctness.

## Planned v0.4.3 Metrics (not implemented)

Not implemented. See [ROADMAP.md](ROADMAP.md) for the full plan. Names below are candidates, subject to confirmation against current evaluation-type conventions.

- `requiredEvidenceRecall`
  Meaning: fraction of fixture-required evidence (files, symbols, instruction IDs, contracts, validators, errors, tests, test helpers, responsibility mappings) found in selected context.
  Formula: found required evidence / total required evidence (optional evidence excluded from the denominator).
  Caveat: requires explicit fixture expectations; not computable without them.
- `irrelevantFileInclusion` / `irrelevantInstructionInclusion`
  Meaning: fraction of selected files/instructions that are not required or allowed by the fixture.
  Formula: selected-not-required-or-allowed / total selected.
  Caveat: zero expected irrelevant items is not itself a failed metric.
- `responsibilityMappingCompleteness`
  Meaning: whether each fixture-defined responsibility has complete evidence (production symbol, contract/validator/error/side-effect evidence, test file, helper, oracle evidence, verification command); partial mappings do not count as complete.
- `provenanceCompleteness`
  Meaning: whether selected evidence identifies its origin (TaskState, workflow catalog, repository retrieval, upstream artifact, changed-surface source); provenance is never inferred from filenames alone.
- `truncation` / `adequacy` / `freshness`
  Meaning: whether reported truncation, adequacy (correctly adequate / correctly inadequate / false adequate / false inadequate / unknown), and freshness (fresh / stale / unknown) match fixture expectations. Hidden truncation is a failure; nonempty output is never automatically adequate.
- `fullFileFallbackCount` / `unnecessaryReadCount`
  Meaning: full-file fallbacks and unnecessary considered-but-unselected reads, reported only when source retrieval-audit data exposes them; not every fallback is a failure.
- `determinism`
  Meaning: whether repeated canonical runs (normalizing only timestamps, temporary paths, and timing) produce identical strategy IDs, selected evidence, metrics, warnings, and report structure.

All v0.4.3 metrics report numerator, denominator, and rate explicitly. Missing metric input is reported as unavailable, never coerced to zero; zero-denominator cases have explicit, documented behavior rather than a division error.
