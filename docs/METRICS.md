# Metrics

This document is the canonical metric glossary for my-dev-kit-lab. It defines every metric that appears in benchmark profiles, prompt variants, controlled experiment artifacts, and rendered reports.

Related documentation:
- [ARCHITECTURE.md](ARCHITECTURE.md) — how metrics flow through the pipeline
- [TUTORIAL.md](TUTORIAL.md) — how to read token savings and correctness scores in the report
- [CURRENT_STATE.md](CURRENT_STATE.md) — current capabilities, plans, and limitations

## Metric interpretation quick reference

| Metric | Higher or positive value | Lower or negative value | Unavailable or N/A |
|---|---|---|---|
| `tokenSavingsPercent` | my-dev-kit used fewer tokens | my-dev-kit used more tokens | One or both runs lacked total-token data |
| `correctnessScore` | More weighted answer-key evidence matched | Less weighted answer-key evidence matched | The run did not produce a scorable answer |
| `complexityScore` | The heuristic indicates greater project complexity | The heuristic indicates lower project complexity | The project was not profiled |

Each entry below uses the same fields: **Meaning**, **Appears in** (the artifact or report source), **Formula**, **Interpretation**, and **Caveat**. Availability follows these repository-wide rules:

- Provider-reported tokens and character-based estimates are different sources and must remain labeled.
- Unavailable means the required input was not supplied or exposed; it is not zero.
- Zero is a measured or derived numeric result with a valid denominator.
- Not applicable means the metric does not describe that run or strategy.
- Invalid zero-denominator cases are reported explicitly rather than divided or coerced to zero.

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

## Project complexity metrics

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

## Prompt complexity metrics

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

## Experiment and run metrics

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

## Planned v0.4.3 metrics

Implemented in `src/evaluation/stageContextMetrics` and published in `v0.4.3`. This section is retained under its original "Planned v0.4.3 metrics" heading for documentation-consistency tooling; the metrics below are implemented and published, not planned. See [ROADMAP.md](ROADMAP.md) and [CHANGELOG.md](../CHANGELOG.md) for its release state.

Every ratio metric below reports `availability` (`available`, `unavailable`, or `not-applicable`), `numerator`, `denominator`, and `rate` explicitly. Missing metric input is reported as `unavailable`, never coerced to zero; `not-applicable` is distinct from both. Every count metric reports `availability`, `count`, and bounded `evidenceKeys`.

- `requiredEvidenceRecall`
  Meaning: fraction of fixture-required evidence (files, symbols, source ranges, contracts, validators, constants, errors, schemas/serializers, production responsibilities, package scripts, test commands, and workflow/stage/command/rule/report-contract IDs) found in observed evidence.
  Formula: matched required evidence / total required evidence.
  Caveat: requires an explicit `StageContextExpectationFixtureV1`; not computable without it.
- `allowedEvidenceCoverage`
  Meaning: fraction of fixture-allowed (optional) evidence found in observed evidence.
  Formula: matched allowed evidence / total allowed evidence.
- `forbiddenEvidenceInclusion`
  Meaning: fraction of fixture-forbidden evidence that was nonetheless observed.
  Formula: observed forbidden evidence / total forbidden evidence.
  Caveat: a `not-applicable` availability when no forbidden evidence is defined is not the same as zero forbidden inclusion.
- `irrelevantFileInclusion` / `irrelevantInstructionInclusion`
  Meaning: count of observed files/instructions that are not required or allowed by the fixture.
  Caveat: zero irrelevant items is a real, available zero, not the same as `unavailable`.
- `requiredProvenanceRecall`
  Meaning: fraction of fixture-required provenance evidence IDs found in observed evidence.
- `responsibilityMappingCompleteness`
  Meaning: per source instance, whether context-capsule/retrieval-audit-record responsibility mappings are mapped, partially mapped, unmapped, or not applicable, with a mapped rate; partial mappings do not count as complete.
- `stateComparisons`
  Meaning: explicit expected-versus-actual comparisons of artifact state fields (for example context/role adequacy status, freshness state, truncation, unresolved-item counts, warning counts) declared in the fixture's expected states, each with its own `available`/`unavailable`/`not-applicable` availability.
- `contextSize`
  Meaning: per-source character count and estimated token count, plus totals, across all context sources supplied to the strategy.
  Formula: estimated tokens use `ceil(characterCount / 4)` per source — an estimate, not provider-reported tokens.
- `consideredButUnselectedReads` / `unnecessaryReads`
  Meaning: counts of considered-but-unselected and unnecessary reads.
  Caveat: the published upstream `RetrievalAuditRecord` does not expose this evidence; these metrics report `unavailable` with an explicit reason, never zero.
- `targetImmutability`
  Meaning: count of target mutations detected between the before and after target snapshots for a run.
  Caveat: reports `unavailable` when no target-immutability configuration was supplied for the run; a configured, unchanged target reports an available count of zero.

Repeated-run determinism (`StageContextDeterminismResultV1` in `src/evaluation/stageContextDeterminism`) reports whether repeated canonical runs (`repeatCount` 1 through 10, run 1 as baseline) produce identical canonicalized run values via SHA-256 digest comparison. A single run reports `not-applicable`; a canonicalization failure (for example a circular reference) reports `unavailable`.

## Producer-readiness bridge metrics (v0.4.4)

Implemented in `src/evaluation/stageContextMetrics` (`calculateOwnerMetrics.ts`, `calculateAllocationMetrics.ts`, `calculateTruncationClassification.ts`, `calculateSupplementalRawAgreement.ts`, `calculateReadinessAgreement.ts`, `calculateCriticalityMetrics.ts`) and composed once per run by `evaluateProducerReadinessBridge.ts`. These metrics read only evidence Batch 1's readers and the existing `v0.4.3` `ContextCapsule`/`RetrievalAuditRecord` readers already preserve; none reimplement upstream owner selection, evidence allocation, producer parity, or orchestrator readiness. Every metric below uses the same `available`/`unavailable`/`not-applicable` availability model as the `v0.4.3` metrics above; unavailable and not-applicable remain distinct from an available zero.

- `selectedOwnerEvidence` / `expectedOwnerPresent` / `forbiddenOwnerPresent` / owner false positives / false negatives
  Meaning: the owner identities the frozen my-dev-kit producer already selected (`ContextCapsule.selectedOwners`), compared against explicit fixture-declared required/allowed/forbidden owner expectations.
  Caveat: with no owner expectations declared, all four ratio/count metrics report `not-applicable`, not zero. An owner outside a fixture-declared closed set (or explicitly forbidden) is a false positive only when that closed set or forbidden set actually exists.
- `requiredGroupCapacity` / `usedReservation` / `borrowedCapacity` / `unusedCapacity`
  Meaning: per evidence-group allocation facts read directly from `ContextCapsule.evidenceGroups` (`limit`, `usedCount`).
  Caveat: `borrowedCapacity` always reports `unavailable` — no frozen my-dev-kit artifact field exposes cross-group capacity borrowing. `unusedCapacity` is computed (`limit - usedCount`) only when a limit is declared and the result is non-negative; a negative result reports `unavailable` with a diagnostic reason rather than a negative number.
- `requiredEvidenceOmitted`
  Meaning: fixture-required evidence absent from observed evidence.
  Caveat: `requiredEvidenceOmittedEntries[].groupId` is always `null` under the current expectation model — expectation items do not declare a group, so group linkage cannot be derived without inventing a mapping.
- Truncation classification (`avoidable` / `genuine-hard-limit` / `unresolved` / `none`)
  Meaning: classifies each `TruncationRecord` using only `limit`, `used`, and `requiredEvidenceLost`. `avoidable` when required evidence was lost while `used` remained below the declared `limit`; `genuine-hard-limit` when `used` reached or exceeded the limit; `unresolved` when no limit is declared; `none` when no required evidence was lost.
  Caveat: missing required evidence alone never proves `avoidable` — it requires the authoritative `requiredEvidenceLost` and `limit`/`used` evidence together.
- Supplemental/raw agreement
  Meaning: per-field comparison between a Batch 1 supplemental document and the raw `ContextCapsule`/`RetrievalAuditRecord`, limited to fields whose vocabularies are directly, losslessly comparable (canonical repository identity, role, freshness, and truncation-as-yes/no).
  Caveat: adequacy agreement always reports `unavailable` — my-dev-kit's four-sentence `ContextAdequacyStatus` values have no verified mapping onto the orchestrator's five-slug `DeclaredAdequacy` vocabulary, and none is invented. Missing evidence on one side reports `unavailable`, never a forced contradiction. `upstreamProducerParityPreserved` reflects that a successfully read raw pair is itself observed evidence the frozen `assertRawEvidenceParity()` write-time guard already held — it is never recomputed by comparing fields.
- Readiness agreement (`decisionAgreement`, `invalidReady`, `validBlocked`)
  Meaning: compares the observed `OrchestratorContextReadinessResultV1` against an explicit fixture-declared readiness expectation. `invalidReady` is available `true` only when the observed decision is `ready` while the fixture explicitly requires blocking behavior with expected issue codes. `validBlocked` requires the observed decision, allowed decisions, and issue codes to all agree with the fixture.
  Caveat: with no readiness expectation, all three report `not-applicable`. With no readiness input, all three report `unavailable`. None of these ever call or reimplement the frozen orchestrator's `contextReadiness.ts`.
- Criticality-overlay agreement / `mappedCriticalCompleteness`
  Meaning: compares fixture-declared expected criticality per responsibility ID against the `criticality`/`mappingStatus` fields my-dev-kit's own `ResponsibilityMapping` already carries. `mappedCriticalCompleteness` counts only applicable, full-mapping-required, expected-critical responsibilities with resolvable mapping status; partially mapped and unmapped responsibilities never count as complete.
  Caveat: a responsibility with no matching raw mapping entry reports `unavailable`/`missingMappingEvidenceCriticalIds`, and is excluded from the denominator rather than treated as unmapped. With zero resolvable denominator entries, `mappedCriticalCompleteness` reports `not-applicable`, not an available zero.

No composite score, grade, ranking, or lab-generated readiness verdict is calculated anywhere in this section.

## Context-integrity metrics (v0.4.5)

Implemented in `src/evaluation/stageContextMetrics` and composed once per run by the same `evaluateProducerReadinessBridge.ts` used by the `v0.4.4` metrics above. These metrics read only condition-aware producer evidence mirrored exactly from the published `my-dev-kit` `v1.10.4` contract and run-integrity evidence mirrored exactly from the published `my-dev-kit-orchestrator` `v1.2.3` contract; none reimplement upstream witness-adequacy, allocation, judge, correction, or lifecycle policy. Every metric below uses the same `available`/`unavailable`/`not-applicable` availability model as the `v0.4.3`/`v0.4.4` metrics; agreement-style metrics additionally report one of the shared `AgreementOutcomeV1` values (`agreement`, `contradiction`, `insufficient-evidence`, `unsupported-legacy-evidence`, `not-applicable`), never a lab-derived pass/fail verdict.

**Allocation and spillover** (`calculateAllocationMetrics.ts`, per-group and aggregate over `ContextCapsule.groupTruncation`):

- `requiredGroupCapacity` / `usedReservation` / `unusedCapacity`
  Meaning: per-group hard limit, used count, and computed unused capacity (`limit - usedCount`) read from `EvidenceGroup`.
  Caveat: `requiredGroupCapacity`/`unusedCapacity` report `unavailable` when no hard limit is declared; a negative computed remainder is treated as a data inconsistency and reported `unavailable` with a diagnostic reason rather than a negative number.
- `borrowedCapacity`
  Meaning: cross-group capacity borrowing.
  Caveat: always reports `unavailable` — no frozen `my-dev-kit` artifact field exposes cross-group borrowing; this is never inferred from other fields.
- Per-group allocation fields (`reservation`, `initiallySelectedCount`, `unusedReservationContributed`, `borrowedCapacity`, `governingHardBound`, `requiredOmittedCount`, `optionalOmittedCount`, `adequacyAffected`, `aggregateCapacityUsed`, `aggregateCapacityRemaining`)
  Meaning: read directly, field-for-field, from each `GroupTruncationEntry`.
  Caveat: a group entry with none of these additive fields set reports `unavailable` for the whole entry (legacy schema-major-1 evidence), never zero.
- Aggregate allocation totals (`totalReservation`, `totalInitiallySelected`, `totalUnusedReservationContributed`, `totalBorrowedCapacity`, `totalRequiredOmitted`, `totalOptionalOmitted`, `totalDropped`) and group lists (`groupsContributingUnusedReservation`, `groupsBorrowingCapacity`, `groupsWithRequiredOmission`, `groupsWithOptionalOnlyOmission`, `groupsWithAdequacyAffected`)
  Meaning: sums and group-ID lists across all evidence groups.
  Caveat: `not-applicable` when there are no evidence groups; `unavailable` when no group exposes allocation diagnostics; a total is reported `null` (`partial: true`) rather than partially summed when any contributing group lacks a needed field.
- `requiredEvidenceOmitted`
  Meaning: fixture-required evidence (from `StageContextExpectationFixtureV1`) missing from observed evidence.
  Caveat: `groupId` on each omitted-evidence entry is always `null` — expectation items do not declare a group, so group linkage is never invented. `not-applicable` when nothing required is missing.
- Truncation classification (`avoidable` / `genuine-hard-limit` / `unresolved` / `none`)
  Meaning: classifies each `TruncationRecord` using only `limit`, `used`, and `requiredEvidenceLost` — unchanged from the `v0.4.4` classification, now composed alongside the `v0.4.5` allocation/spillover evidence.
- Spillover diagnostics (`groupsContributing`, `groupsBorrowing`, `totalContributed`, `totalBorrowed`, `contributionCoversBorrowing`)
  Meaning: which groups contributed unused reservation versus borrowed capacity, and whether total contribution covers total borrowing.
  Caveat: `unavailable` when no group exposes `v1.10.3`/`v1.10.4` allocation diagnostics.

**Condition coverage** (`calculateConditionCoverageMetrics.ts`, over `roleConditionCoverage`):

- `requiredConditionsTotal` / `requiredConditionsSatisfied` / `requiredConditionsMissing` / `requiredConditionsLost`
  Meaning: counts of required conditions by coverage state — `satisfied` (`conditionSatisfied`), `lost-to-allocation` (`lostRequiredCondition`), or `missing-evidence` (neither).
- `optionalConditionsTotal` / `optionalConditionsSatisfied` / `optionalConditionsMissing`
  Meaning: the same breakdown for non-required conditions.
- `witnessEvidence`
  Meaning: per-condition witness detail (`witnessPolicy`, `requiredWitnessCount`, `availableWitnessCount`, `retainedWitnessCount`, `retainedWitnessIds`, `adequateWitnessRemains`, `coverageState`, `lossReason`, `evidenceGroupIds`) read directly from each `RoleConditionCoverage` entry.
  Caveat: retained-witness identifiers are never fabricated from counts alone; only IDs the producer actually supplied are reported.
- `lastWitnessLossCount`
  Meaning: count of required conditions that lost their last adequate witness (`lostRequiredCondition`).
  Caveat: a real, available zero (no last-witness loss) is distinct from `unavailable` (no condition-coverage evidence at all).
- `conditionToGroupMapping`
  Meaning: whether each condition's `evidenceGroupIds` reference known evidence groups (`mapped`, `unknownGroupIds`).
- Overall availability
  Caveat: the entire metric block reports `unavailable` when `roleConditionCoverage` is absent — this is the expected, documented case for the `v0.4.5` failed-run fixture, which predates condition-level diagnostics (legacy schema-major-1 producer evidence), never treated as an evaluated-empty result.

**Agreement metrics** (comparing producer evidence against itself, and producer evidence against orchestrator run-integrity evidence):

- `producerConditionAgreement`
  Meaning: compares `roleAdequacy.status` against condition-coverage evidence; flags `PRODUCER_INADEQUATE_BUT_ALL_REQUIRED_CONDITIONS_RETAINED` and `PRODUCER_ADEQUATE_BUT_REQUIRED_CONDITION_LOST` contradictions.
  Caveat: reports `unsupported-legacy-evidence` (not `contradiction` or `agreement`) when condition-coverage evidence itself is unavailable — this is the case for the failed-run fixture.
- `requiredEvidenceLossAgreement`
  Meaning: compares `truncation.requiredEvidenceLost` against explicit condition-loss/required-omission evidence; flags `REQUIRED_EVIDENCE_LOST_FALSE_BUT_CONDITION_LOSS_DETECTED` and `REQUIRED_EVIDENCE_LOST_TRUE_BUT_NO_CONDITION_OR_GROUP_LOSS_DETECTED`.
- `capsuleAuditConditionAgreement`
  Meaning: whether the context capsule and retrieval audit record agree on `roleConditionCoverage`, `truncation`, and `roleAdequacy`, using the existing capsule/audit consistency selector.
- `readinessPromptAgreement`
  Meaning: compares `gate.readinessClassification` against `stageMayRenderNormalPrompt` (derived from structured blocked-stage evidence — **not** a literal upstream `promptMode` field, which the orchestrator does not expose) for context-sensitive stages (`implementation`, `test-implementation`); flags `READY_BUT_PROMPT_NOT_NORMAL` and `REFRESH_REQUIRED_BUT_PROMPT_NORMAL`.
  Caveat: `not-applicable` for non-context-sensitive stages.
- `readinessExpectedJudgeAgreement`
  Meaning: checks the gate's own `contextReady`/`expectedJudgeVerdict` invariant; flags `CONTEXT_READY_BUT_EXPECTED_NOT_PASS` and `CONTEXT_NOT_READY_BUT_EXPECTED_NOT_NEED_CONTEXT`.
- `expectedActualJudgeAgreement`
  Meaning: compares the gate's `expectedJudgeVerdict` against the parsed `authoredJudgeVerdict`; flags malformed/missing judge verdicts and the upstream `JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY` code (preserved verbatim when the orchestrator's own `blockingCodes` include it) when an authored `PASS` contradicts a canonical `NEED_CONTEXT` requirement.
  Caveat: `insufficient-evidence` when no `judgeIntegrity` evidence was supplied. A syntactically valid, accepted verdict that legitimately differs from the expected one (e.g. a correction-route or terminal blocked verdict) is not itself flagged as a contradiction.
- `judgeCorrectionAgreement`
  Meaning: checks that a `PASS` verdict has no active correction route, that a corrective verdict requiring correction has one, and that `acceptedCorrectionStage` matches the structured route's `routedStage`; flags `PASS_WITH_ACTIVE_CORRECTION_ROUTE`, `CORRECTIVE_VERDICT_WITHOUT_ROUTE`, and `CORRECTION_DESTINATION_MISMATCH`.
- `judgeFinalEligibilityAgreement`
  Meaning: checks that `finalReportEligible` only holds when the authored verdict is `PASS`, parsed, accepted, and matches the expected verdict; flags `ELIGIBLE_WITH_NON_PASS_JUDGE`, `ELIGIBLE_WITH_MALFORMED_OR_MISSING_JUDGE`, `ELIGIBLE_WITH_UNACCEPTED_JUDGE`, and `ELIGIBLE_WITH_UNMATCHED_EXPECTED_VERDICT`.
- `eligibilityFinalArtifactAgreement`
  Meaning: checks eligibility against final-artifact presence and verdict; flags `ELIGIBLE_BUT_ARTIFACT_MISSING`, `INELIGIBLE_BUT_ARTIFACT_PRESENT`, `NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS` (or the more general `INELIGIBLE_WITH_FINAL_PASS`), and `FINAL_ARTIFACT_MALFORMED_VERDICT`. This is the metric that surfaces the real historical `v1.11.0` Batch 1 failed-run's contradiction: a `NEED_CONTEXT` gate followed by a final report with verdict `PASS`.
- `lifecycleIntegrityAgreement`
  Meaning: per-stage lifecycle entries (`completionBasis`: `not-complete` / `artifact-presence-only` / `manual-record`) checked against expected run-integrity blocking; flags `MANUAL_MARK_COMPLETE_BYPASS_SUCCEEDED` when a stage that should be blocked (by `gate.blockedStageNames` or final-report ineligibility) resolved to `complete` anyway, whether through a manual mark-complete record or artifact presence alone.
  Caveat: `not-applicable` when no lifecycle evidence was supplied.
- `endToEndSummary` (`category`: `full-agreement` / `contradiction-present` / `insufficient-evidence` / `unsupported-legacy-evidence`)
  Meaning: aggregates all component agreement outcomes above (plus `producerReadiness` from the `v0.4.4` bridge) — any contradiction anywhere makes the category `contradiction-present`; otherwise any `insufficient-evidence` or `unsupported-legacy-evidence` component determines the category; only when every component agrees is the category `full-agreement`.
  Caveat: this is an aggregation of agreement/contradiction state, not a composite score, grade, ranking, or release verdict — no such value is calculated anywhere in this section.

**Fixture assurance:**

- Fixture hash verification (`src/evaluation/ecosystemFixtures/verifyFixtureHashes.ts`)
  Meaning: SHA-256 comparison of tracked fixture files against the manifest's recorded hashes.
  Interpretation: `ok: false` means the on-disk fixture bytes no longer match what was frozen; evaluation results built from a failed hash check should not be trusted.
- Determinism and fixture self-immutability
  Meaning: reuses `calculateStageContextDeterminism`/`canonicalizeStageContextRun` (`v0.4.3`) to confirm repeated evaluations of the same fixture produce identical canonicalized results, and re-runs fixture hash verification to confirm the frozen bytes were not mutated by evaluation.
  Caveat: this is fixture-level self-immutability, not the `v0.4.3` live-target-mutation check — no live target repository is exercised by this evaluation path.
