# Context-integrity report schema (v0.4.5, implemented, unreleased)

This document describes the shape of one `ContextIntegrityReportV1` — the bounded JSON/text/HTML report produced by evaluating one frozen context-integrity fixture (`failed-run` or `corrected-replay`) through `buildContextIntegrityReport` in `src/report/experiments/buildContextIntegrityReport.ts`. It documents structure only. For what each field *means*, see the "Context-integrity metrics (v0.4.5, implemented, unreleased)" section of [METRICS.md](METRICS.md) — this document does not duplicate those definitions.

Model source: `src/report/experiments/contextIntegrityReportModel.ts`. Renderers: `renderContextIntegrityJsonReport.ts` (raw `JSON.stringify`), `renderContextIntegrityText.ts` (11 numbered plain-text sections), `renderContextIntegrityHtml.ts` (bounded HTML tables and badges). All three renderers render the same `ContextIntegrityReportV1` object; none recompute anything.

## Section order (text and HTML renderers)

Both the text and HTML renderers present the report in this fixed order:

1. Context-integrity summary
2. Fixture and provenance
3. Producer allocation and omissions
4. Condition coverage
5. Producer/readiness agreement
6. Prompt and judge agreement
7. Correction and final-report agreement
8. Lifecycle integrity
9. Determinism and immutability
10. Contradictions and unavailable evidence
11. Limitations

## Top-level JSON fields

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"1.0.0"` | Fixed literal. |
| `detailLimit` | `number` | The bounded-list cap applied throughout (shared with the existing `v0.4.3` report model's `V043_REPORT_DETAIL_LIMIT`, currently `100`). |
| `fixture` | `ContextIntegrityReportFixtureV1` | Fixture identity, provenance, hash verification, and (for `corrected-replay`) the required limitation statement. |
| `producerIdentity` | `ContextIntegrityReportProducerIdentityV1` | Tool name/version, role, project root, index path, role-adequacy status — pass-through of already-read producer identity fields. |
| `allocation` | `ContextIntegrityReportAllocationV1` | Per-group and aggregate allocation/omission evidence. |
| `spillover` | `ContextIntegrityReportSpilloverV1` | Cross-group contribution/borrowing evidence. |
| `truncation` | `ContextIntegrityReportTruncationV1` | Truncation state and required-evidence-loss rollup. |
| `conditionCoverage` | `ContextIntegrityReportConditionCoverageV1` | Required/optional condition coverage and witness evidence. |
| `producerConditionAgreement` | `ContextIntegrityReportAgreementV1` | `roleAdequacy.status` vs. condition-coverage evidence. |
| `requiredEvidenceLossAgreement` | `ContextIntegrityReportAgreementV1` | `truncation.requiredEvidenceLost` vs. explicit condition-loss/omission evidence. |
| `capsuleAuditAgreement` | `{ availability, consistent, contradictingFieldPaths }` | Context-capsule vs. retrieval-audit-record structural consistency (`roleConditionCoverage`/`truncation`/`roleAdequacy` fields only). |
| `supplementalRawAgreement` | `ContextIntegrityReportSupplementalAgreementV1 \| null` | `v0.4.4` supplemental/raw agreement, carried through when present; `null` when no supplemental document was supplied for this fixture. |
| `producerReadinessAgreement` | `ContextIntegrityReportAgreementV1` | `v0.4.4` readiness-agreement result, in the shared agreement shape. |
| `readinessPromptAgreement` | `ContextIntegrityReportAgreementV1` | `gate.readinessClassification` vs. `stageMayRenderNormalPrompt`. |
| `readinessExpectedJudgeAgreement` | `ContextIntegrityReportAgreementV1` | Gate's own `contextReady`/`expectedJudgeVerdict` invariant. |
| `expectedActualJudgeAgreement` | `ContextIntegrityReportAgreementV1` | Expected vs. parsed/authored judge verdict. |
| `judgeCorrectionAgreement` | `ContextIntegrityReportAgreementV1` | Judge verdict vs. correction route. |
| `judgeFinalEligibilityAgreement` | `ContextIntegrityReportAgreementV1` | Judge verdict vs. final-report eligibility. |
| `eligibilityFinalArtifactAgreement` | `ContextIntegrityReportAgreementV1` | Eligibility vs. final-artifact presence/verdict. |
| `lifecycleIntegrityAgreement` | `ContextIntegrityReportAgreementV1` | Per-stage lifecycle resolution vs. expected blocking. |
| `endToEnd` | `ContextIntegrityReportEndToEndV1 \| null` | Aggregated `category` plus `componentOutcomes`/`contradictingComponents`; `null` only if the bridge produced no run-integrity evaluation at all. |
| `determinism` | `ContextIntegrityReportDeterminismV1` | Repeated-evaluation determinism result. |
| `immutability` | `ContextIntegrityReportImmutabilityV1` | Fixture self-immutability result (hash re-verification), not live-target mutation. |
| `limitations` | `ContextIntegrityReportLimitationsV1` | `unavailableSections` (which top-level sections reported `unavailable`/`not-applicable` and why) and `notes` (free-text limitation statements, including the corrected-replay framing when applicable). |

## Availability and outcome values

- `V043ReportAvailability` (reused from the `v0.4.3` model): `"available"` / `"unavailable"` / `"not-applicable"`.
- `AgreementOutcomeV1` (shared across all `ContextIntegrityReportAgreementV1` fields): `"agreement"` / `"contradiction"` / `"insufficient-evidence"` / `"unsupported-legacy-evidence"` / `"not-applicable"`.
- `endToEnd.category`: `"full-agreement"` / `"contradiction-present"` / `"insufficient-evidence"` / `"unsupported-legacy-evidence"`.

Every field that can be legitimately absent reports one of these values with a `reason` string rather than a fabricated zero, `false`, or empty agreement. See METRICS.md for the availability-model conventions this follows.

## Contradiction evidence shape

Every `ContextIntegrityReportAgreementV1.contradictions` (and `truncation.contradictions`) is a `V043BoundedReportListV1<ContextIntegrityReportContradictionV1>` — the same bounded-list wrapper (`items`, `totalCount`, `displayedCount`, `omittedCount`) the `v0.4.3` report model already uses, never a raw unbounded array. Each contradiction item is:

```json
{ "code": "string", "fieldPath": "string", "expected": "string | null", "observed": "string | null", "reason": "string" }
```

`code` values are the exact contradiction codes documented per-agreement-field in METRICS.md (for example `JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY`, `NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS`, `MANUAL_MARK_COMPLETE_BYPASS_SUCCEEDED`). The upstream orchestrator's own contradiction code is preserved verbatim when it is present in the source evidence, rather than replaced by a lab-invented code.

## Evidence bounds

Every list-shaped field in the report (`perGroup`, `witnessEvidence`, `retainedWitnessIds`, `artifacts`, `contradictions`, hash-verification `issues`) is a `V043BoundedReportListV1<T>`, capped at `detailLimit` (`100`) displayed items with `totalCount`/`displayedCount`/`omittedCount` always present so a bounded truncation is visible rather than silent. Scalar/group-ID-list fields outside these wrappers (e.g. `groupsWithRequiredOmission`) are not currently bounded separately, since they are already bounded by the number of evidence groups a producer run can realistically declare.

## Sanitization

`renderContextIntegrityHtml.ts` escapes every rendered field value (`escapeHtml`) before interpolation into HTML — including `reason`, `code`, `fieldPath`, `expected`, and `observed` strings sourced from evidence — so a hostile or malformed field value is neutralized rather than injected as markup. `renderContextIntegrityJsonReport.ts` performs no HTML escaping (it is not HTML); consumers rendering JSON-derived values into HTML elsewhere must escape them themselves, the same expectation that applies to every other JSON report in this repository.

## Legacy behavior

`ContextIntegrityReportV1` is additive: it imports `V043BoundedReportListV1`/`V043ReportAvailability` from `contextStrategyComparisonV043ReportModel.ts` but does not modify that file's exported shapes, and the existing `v0.4.3` `ContextStrategyComparisonV043ReportV1` report, its builder, and its renderers are unchanged. A context-integrity report is a report about one fixture evaluation; it never appears nested inside, or replaces, a `v0.4.3`/`v0.4.4` experiment-run report.

## Fixture limitations reflected in the schema

`fixture.correctedReplayLimitation` is populated only when `fixture.kind === "corrected-replay"`, with the exact required framing: that the fixture is a hand-distilled representation of the validated `v1.10.4`/`v1.2.3` contracts for the same request/target/index identity, not a live capture of a complete ten-stage workflow, and not proof that every future run will behave identically. It is the empty string for `failed-run` (which needs no such disclaimer, since it is a byte-exact freeze of a real run). See [context-integrity-fixtures.md](context-integrity-fixtures.md) for the fixture pair's full provenance.
