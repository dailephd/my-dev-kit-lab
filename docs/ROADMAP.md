# Roadmap

This roadmap separates the implemented baseline from planned work. A version listed here is not released or implemented unless explicitly marked as current or completed.

The roadmap follows semantic version order. `v1.0.0` is the stable release after the complete `v0.x` development track; it is newer than every `v0.x` release.

## Version sequence

```mermaid
flowchart LR
  V020[v0.2.0] --> V021[v0.2.1] --> V022[v0.2.2]
  V022 --> V030[v0.3.0] --> V031[v0.3.1] --> V032[v0.3.2] --> V033[v0.3.3] --> V034[v0.3.4]
  V034 --> V040[v0.4.0] --> V041[v0.4.1] --> V042[v0.4.2] --> V043[v0.4.3] --> V044[v0.4.4]
  V044 --> V045[v0.4.5] --> V046[v0.4.6] --> V050[v0.5.0] --> V051[v0.5.1] --> V052[v0.5.2]
  V052 --> V060[v0.6.0] --> V061[v0.6.1] --> V062[v0.6.2] --> V063[v0.6.3]
  V063 --> V070[v0.7.0] --> V071[v0.7.1] --> V072[v0.7.2]
  V072 --> V080[v0.8.0] --> V081[v0.8.1] --> V082[v0.8.2]
  V082 --> V090[v0.9.0] --> V091[v0.9.1] --> V092[v0.9.2]
  V092 --> V100[v1.0.0] --> V110[v1.1.0] --> V120[v1.2.0] --> V130[v1.3.0] --> V140[v1.4.0]
  V100 -. deferred .-> PT[Post-v1 / version TBD manual pentest]
```

## Product direction

my-dev-kit-lab is the experiment, evidence, reporting, security-validation, audit, and release-readiness companion for my-dev-kit.

my-dev-kit-lab should remain validation-first, evidence-first, and non-destructive by default. It should not become a project generator, app publisher, signing tool, Play Console uploader, or automatic fixer.

The strongest product thesis remains:

* my-dev-kit helps when a repository is larger than the task.
* my-dev-kit-lab should prove when my-dev-kit is useful, not claim that my-dev-kit always saves tokens.
* The most important usefulness cases are large repositories, localized tasks, warm index reuse, context-window limits, retrieval precision, stale-index risk detection, and better coding-agent edit quality.
* Security validation, audit reporting, code rot detection, code quality checks, mobile validation, and manual pentest support should strengthen release-readiness and implementation-readiness workflows around this evidence system.

## Release continuity and planned sequence

### v0.2.0 — completed

Status: **published**.

Purpose:

* Introduce the reusable experiment-plugin framework without breaking the raw-versus-guided baseline.

Completed scope:

* Generic experiment-plugin contracts, registry, runner, configuration, target model, and normalized results.
* `context-strategy-comparison` as the first experiment plugin.
* Existing raw-full-file versus my-dev-kit-guided behavior preserved through the plugin.
* Target-aware experiment execution.
* Plugin-aware JSON and HTML reports.
* Backward-compatible `experiment:list`, `experiment:describe`, `experiment:run`, and legacy controlled-experiment workflows.
* Reusable target-aware automated security validation carried forward from earlier security work.

Acceptance:

* Plugin and legacy workflows produce compatible artifacts, explicit local targets remain non-destructive, and existing security validation remains available.

### v0.2.1 — previous package baseline

Status: **the npm registry lists `0.2.1`**; no matching Git tag or GitHub Release was found during this recovery.

Purpose:

* Correct external-target security-test execution, including execution from an installed package, and synchronize documentation with the plugin architecture.

Completed scope:

* Correct target-project execution of `test:security` during external-target validation, including installed-package execution.
* Documentation synchronized with the implemented plugin and security-validation architecture.
* Fortification continues after this baseline without changing the backward-compatible `security:validate` command.
* The current package baseline is not the final security, audit, mobile, or pentest architecture.

Dependencies:

* Builds on the v0.2.0 plugin and target model.

Acceptance:

* External targets run their declared security test from the correct working directory in both source and installed-package execution.

### v0.2.2 — fortified automated security validation (published)

Status: **published**.

Purpose:

* Strengthen the existing automated security-validation framework so it moves closer to a reusable adversarial security framework, not just dependency scanning or package validation.
* Keep `security:validate` backward compatible.
* Do not merge this work into the audit framework yet.

Features:

* Add `security:validate` config-surface flags: `--checks`, `--profile`, `--format`, `--fail-on`, and `--out`, while preserving backward-compatible `--target` and no-flag behavior.
* Add automated attack-scenario model, reusable security profiles, payload corpus, and explicit exploit-evidence model.
* Add integrated attack runner and report support for attack scenarios.
* Add concrete target sandbox, package boundary, output boundary, path traversal, config injection, subprocess injection, secret leakage, report poisoning, and network/local-first assumption scenarios.
* Add profile-aware default check selection and scoped-run reporting.
* Add fail-on threshold behavior plus clearer separation between scanner findings, adversarial failures, optional skipped tools, release blockers, target-project blockers, and tool-framework blockers.
* Add metadata-driven `verdictImpact` categorization and remove the hand-maintained scenario-impact map.
* Add `reportSchemaGuard` baseline-diff structural-injection protection for JSON report poisoning/config injection.
* Add schema/report hardening, output-format/location consistency validation, text-report sanitization, and non-destructive target validation coverage.

Acceptance:

* The standalone command remains backward compatible and all accepted check IDs have implementation coverage.
* Attack scenarios produce structured, sanitized evidence and metadata.
* Target source remains unchanged by default, unavailable optional tools remain skipped, and experiment behavior remains compatible.

Explicit exclusions:

* This release did not merge security validation into the generic audit framework or add manual pentesting.

## Planned v0.x development track

### v0.3.0 — generic audit framework and code rot detector (published)

Status: **published**.

Purpose:

* Add a generic audit framework for project health, implementation-readiness, refactor-readiness, and release-readiness.
* Add code rot detection as the first audit detector family.
* Keep this separate from experiments and separate from direct security validation.

Features:

* Add reusable audit contracts, target resolution, registry, severity model, issue model, and report infrastructure.
* Add project inventory scanner.
* Add source-of-truth collector.
* Add normalized audit issue schema.
* Add code rot detector.
* Add stable text and JSON reports.
* Add configurable fail-on severity.
* Add false-positive and confidence labels.
* Add suggested fix strategy and validation commands per finding.
* Write reports under `reports/audits/code-rot/`.

Code rot detector scope:

* Stale command and workflow references.
* Documentation/code mismatch.
* Duplicate or parallel implementation candidates.
* Dead-code candidates from deterministic evidence.
* Test rot signals.
* Architecture drift signals.
* Package/release rot.
* Dependency/environment rot.
* Cross-platform rot.
* Security/validation assumption rot.

Acceptance:

* `npm run audit -- --target <path> --types code-rot` works.
* Reports include target metadata, tool metadata, timestamp, summary, issue counts, evidence, severity, confidence, recommended action, validation commands, release-blocking flag, implementation-blocking flag, and auto-fix eligibility.
* No target files are modified.
* Invalid targets fail cleanly.
* JSON schema is stable.
* Windows paths work.
* Existing experiment commands still work.
* Existing `security:validate` still works.

Explicit exclusions:

* Security, quality, project, and combined audit types were not part of this release's completed scope.

### v0.3.1 — language-aware TypeScript/JavaScript code-rot support

Status: **published**.

Purpose:

* Add a language-aware source-facts substrate and TypeScript/JavaScript support to the existing code-rot audit family without introducing a new audit type.

Completed scope:

* Added normalized source facts, analyzer registration, TypeScript/JavaScript parsing, source-facts-aware dead-code/duplicate/test-rot signals, and report summaries.
* Preserved the existing `npm run audit` surface, stable issue model, and non-destructive target boundary.

Dependencies:

* Builds on the `v0.3.0` generic audit framework and code-rot detector registry.

Acceptance:

* TypeScript/JavaScript evidence is deterministic and conservative; unsupported or ambiguous semantics are not overclaimed.
* Existing experiment and standalone security-validation behavior remains compatible.

Explicit exclusion:

* The `quality` audit type and deterministic code-quality detector family remain planned, unimplemented work; `v0.3.1` does not own them.

### v0.3.2 — security results in unified audit reports

Status: **published**. This release also added Python source-facts support.

Purpose:

* Integrate existing automated security-validation results into the audit framework as a report source.
* Preserve standalone `security:validate`.

Features:

* Add audit adapter for securityValidation.
* Convert security validation findings into the shared audit issue model.
* Preserve original security report output.
* Add security summary section to audit reports.
* Distinguish scanner findings, adversarial scenario failures, package/release findings, and optional skipped checks.
* Add audit report links to generated security validation reports.

Acceptance:

* `security:validate` remains backward compatible.
* `npm run audit -- --target <path> --types security` works.
* Audit reports include security findings in the shared issue model.
* Audit reports link or reference generated security reports.
* Optional skipped security tools are represented correctly.
* Existing security reports remain available.
* Existing experiment framework remains unchanged.

Explicit exclusions:

* This release did not implement the `quality`, `project`, or `all` audit types and did not add audit passthrough for standalone security check/profile selection.

### v0.3.3 — Java/Kotlin language-aware code-rot support

Status: **published**.

Purpose:

* Extend the language-aware code-rot substrate to Java and Kotlin while preserving conservative, dependency-free analysis.

Completed scope:

* Added Java/Kotlin analyzers, JVM project metadata, detector integration, and static Gradle/Maven documentation-claim checks.

Dependencies:

* Builds on the `v0.3.1` source-facts substrate and the `v0.3.2` additive report fields.

Acceptance:

* Java/Kotlin findings remain analyzer-scoped and do not claim compiler, classpath, runtime, Android, or dependency-freshness proof.
* Existing command and report schemas remain compatible.

Explicit exclusion:

* Project-wide combined audit defaults, audit profiles, cross-type deduplication, and the `quality`, `project`, and `all` audit types remain planned and unimplemented.

### v0.3.4 — cross-language code-rot fixture and stability pass

Status: **published**.

Purpose:

* Harden the shared TypeScript/JavaScript, Python, Java, and Kotlin source-facts substrate.
* Preserve deterministic path normalization, report schemas, cross-platform fixtures, and documentation/code consistency.

Acceptance:

* Mixed-language fixtures and reports remain deterministic across supported platforms.
* Existing experiment, audit, security-validation, report, plot, screenshot, and gallery behavior remains available.

### v0.4.0 — Android validation MVP

Status: **published**.

Purpose:

* Deliver the non-destructive Android validation MVP.

Implemented capabilities:

* Android project detection, module detection, and Compose/XML/mixed UI classification.
* Android manifest parsing and the original Android audit checks.
* Static Gradle metadata plus closed, explicitly opted-in Gradle operations.
* Android verdicts, text and JSON reports, target mutation evidence, and Play-readiness placeholders.
* Non-destructive defaults: no Gradle process, external tool, or network activity unless explicitly requested.

Acceptance:

* `security:validate --profile android` detects and validates Android targets.
* Default validation remains static, local, deterministic, report-first, and source-preserving.

### v0.4.1 — advanced Android security

Status: **published**.

Purpose:

* Extend the Android MVP with advanced shared substrate and deeper static security evidence.

Implemented capabilities:

* Network Security Config; backup and data-extraction; release/debug configuration.
* Redacted secret candidates and signing-configuration evidence.
* WebView, FileProvider, sensitive storage, sensitive logging, clipboard, and Firebase/Google services checks.
* Optional Semgrep, OSV, Android Lint, and Dependency-Check evidence.
* Nineteen active default checks, `CandidateEvidence`, CLI/report/verdict integration, and stable text/JSON output.
* Zero Gradle operations, zero external tools, and zero network requests by default.

Acceptance:

* Advanced checks feed the same Android validation result, verdict, and reports.
* Optional operations remain closed and auditable; standalone `security:validate` remains available.

### v0.4.2 — Android-aware general security audit adapter

Status: **published**.

Purpose:

* Extend the existing general security audit adapter directly with Android-aware validation without creating a parallel adapter.

Completed scope:

* Reuse the existing `SecurityFinding -> AuditIssue` mapping for general security findings.
* Invoke Android validation programmatically through the existing security audit adapter.
* Add Android status/completeness and `CandidateEvidence` summaries plus Android report references.
* Add an explicit public `audit` CLI opt-in and generic audit text/JSON integration.
* Preserve standalone `security:validate` and default static zero-process behavior.
* Do not map `CandidateEvidence` records to `AuditIssue`; only Android security findings become audit issues.
* Do not add a parallel adapter.

Acceptance:

* The opt-in audit path exposes Android summaries, report references, and mapped Android security findings.
* Generic audit output remains schema-stable and the standalone validator remains authoritative for complete Android validation evidence.
* Package metadata, the `v0.4.2` tag, and the GitHub Release are published; `v0.4.2` is the current npm baseline.

### v0.4.3 — stage-specific bounded-context and workflow-instruction evaluation

Status: **published**.

Purpose:

* Extend the existing experiment and report infrastructure so it can deterministically compare broad and bounded stage-context strategies against identical immutable targets, using explicit fixture expectations and structured packet evidence, without joining or replacing the production execution path of my-dev-kit or my-dev-kit-orchestrator.

Cross-repository dependency order (each repository remains independently releasable; my-dev-kit-lab has no runtime/package dependency on the other two):

1. `my-dev-kit` `1.10.1` — adds architecture/implementation/test-implementation context roles, structured `ContextRequest` input, changed-file/symbol intake, before/after index identities, evidence groups, bounded test-infrastructure discovery, deterministic responsibility mapping, and adequacy/truncation/freshness/provenance reporting on top of the existing context capsule (schema `1.0.0`) and retrieval-audit record (schema `1.0.0`).
2. `my-dev-kit-orchestrator` `1.2.1` — adds a structured workflow/command/rule/report-contract catalog with stable IDs, a deterministic reference resolver, `WorkflowInstructionPacket` assembly, and manual (non-automatic) implementation/test-implementation context-refresh integration into the existing ten-stage feature workflow.
3. `my-dev-kit-lab` `0.4.3` (this repository) — the scope described below.

Ownership boundaries approved for this patch:

* my-dev-kit-lab owns: controlled context-strategy experiments and strategy matrices, explicit fixture expectations, context-size measurement, required-evidence recall, irrelevant-file/irrelevant-instruction inclusion, test-responsibility-mapping completeness, provenance completeness, truncation/adequacy/freshness evaluation, full-file-fallback and unnecessary-read measurement (where source packet/audit data exposes it), repeated-run determinism, target immutability, machine- and human-readable reports, and optional plots/screenshots. It also continues to own the existing security-validation and code-rot-audit systems, unmodified by this patch.
* my-dev-kit owns: repository indexing, architecture/implementation/test-implementation role context, `ContextRequest`, context capsules, retrieval-audit records, changed-file/changed-symbol evidence, before/after index evidence, graph-diff evidence, and repository-evidence adequacy/provenance/test-responsibility-mapping-to-repository-evidence.
* my-dev-kit-orchestrator owns: workflow catalog content, stable workflow/stage/command/rule/report-contract IDs, exact workflow selection and dependency resolution, `WorkflowInstructionPacket`, stage prompt assembly, `TaskState`, stage order, artifact lifecycle, manual context-freshness rules, correction routing, judge interpretation, and publication authorization.
* Explicit non-owner boundaries: my-dev-kit-lab must not become the production repository indexer, the normal context-packet generator, or the workflow-instruction resolver; must not assemble production coding-agent prompts, control stage progression, mark orchestrator stages complete, execute normal production implementation workflows, automatically edit target repositories, become a required production dependency of either upstream project, or authorize publication. my-dev-kit must not own lab strategy verdicts, experiment scoring, or report comparisons. The orchestrator must not own lab metrics, lab report generation, or lab target-immutability evidence.

Problem this patch solves (resolved by the implementation described below):

* Prior evaluation (`src/evaluation/scoreCorrectness.ts` and the `context-strategy-comparison` plugin) was primarily agent-answer and broad-context-size oriented; it did not directly measure whether selected evidence contained required files, symbols, workflow-instruction IDs, contracts, validators, errors, tests, test infrastructure, responsibility mappings, or provenance. It did not measure whether full workflow-library or broad-repository-dump baselines waste context or include irrelevant material relative to a bounded alternative — that must be measured, not assumed. It did not compare architecture-only context against implementation-refreshed and test-refreshed context under identical target conditions to evaluate staleness, or evaluate explicit test-responsibility mappings for test-writing stages. Subjective LLM-based quality/relevance/usefulness judging remains explicitly out of this patch's scope.

In scope for `v0.4.3`:

* Extend the existing `src/experiments` plugin/registry/runner infrastructure (no second runner was created). Extend the existing `context-strategy-comparison` plugin (`src/experiments/plugins/contextStrategyComparison/`) rather than duplicating it; existing strategy IDs `raw-full-file` and `my-dev-kit-guided` are preserved.
* Six new strategy IDs are implemented: `architecture-context-only`, `architecture-plus-implementation-refresh`, `architecture-plus-implementation-and-test-refresh`, `full-workflow-library`, `bounded-workflow-instruction-packet`, and `combined-bounded-stage-context`. They are selected through programmatic strategy-input configuration; no new `experiment:run` CLI flags were added for these paths.
* Exact, non-normalizing readers for the my-dev-kit context capsule, the my-dev-kit retrieval-audit record, and the orchestrator `WorkflowInstructionPacket` are implemented in `src/evaluation/upstreamArtifacts`, each with schema-major validation and explicit failure (not silent reinterpretation) on malformed input or unsupported schema majors. The existing adapter `src/evaluation/runMyDevKitRetrieval.ts` is unchanged and continues to invoke only `index`, `search`, `lookup`, `slice`, and `source`.
* Selectors and consistency diagnostics over the exact reader output are implemented in `src/evaluation/stageContextSelectors`.
* An explicit fixture-expectation contract (`StageContextExpectationFixtureV1` in `src/evaluation/stageContextExpectations`: required/allowed/forbidden evidence, expected artifact states, stable case and expectation IDs) is implemented, extending rather than replacing the existing `BenchmarkTaskAnswerKey`/`ExpectedContextTarget` concepts in `src/evaluation/types.ts`.
* Deterministic, evidence-centered metrics are implemented in `src/evaluation/stageContextMetrics`: character count and estimated tokens (`ceil(characterCount / 4)` per source, explicitly labeled as an estimate), required-evidence recall, allowed-evidence coverage, forbidden-evidence inclusion, irrelevant-file inclusion, irrelevant-instruction inclusion, required-provenance recall, responsibility-mapping completeness, state comparisons, context-size measurement, and explicit `available`/`unavailable`/`not-applicable` metrics for considered-but-unselected reads, unnecessary reads, and target immutability (available only where the published upstream artifacts expose that evidence). Every recall/inclusion metric reports numerator, denominator, and rate explicitly; missing data is reported as unavailable, never coerced to zero.
* Target-immutability before/after snapshot evidence is implemented in `src/evaluation/targetImmutability`: explicit `targetRootPath` and bounded `relativeFilePaths`, configured-file SHA-256 hashes, and read-only Git state capture, with no symbolic-link following and no mutating Git commands. Repeated-run determinism (`repeatCount` 1 through 10, run 1 as baseline, recursive canonicalization, SHA-256 digests) is implemented in `src/evaluation/stageContextDeterminism`. Any target mutation caused by an experiment is reported as a mutation; the target is never auto-cleaned or reset.
* Machine-readable (JSON), human-readable HTML, and human-readable text reports are implemented through the existing `src/report`/`src/report/experiments` infrastructure (`report.json`, `report.html`, `report.txt`), with a bounded detail limit, source-order preservation, explicit missing/not-applicable/zero-occurrence distinctions, and a neutral interpretation with no composite score, grade, ranking, or winning strategy.
* Plot data, SVG plots, screenshots, and gallery integration for this stage-context evidence are not part of this implementation.
* Regression coverage for the existing audit framework (`src/audits`), security-validation framework (`src/securityValidation`), and benchmark/evaluation infrastructure (`src/evaluation`) was verified; none of it was weakened or replaced.

Explicitly out of scope / deferred for `v0.4.3`:

* Production repository indexing, production context generation, workflow-catalog ownership or selection, workflow-stage progression, production prompt assembly, coding-agent execution, or automatic target editing (all remain owned by my-dev-kit or the orchestrator).
* LLM-based strategy grading, assertion-quality scoring, relevance judgment, general prose-usefulness scoring, human-equivalent manual-troubleshooting scoring, and any broad semantic precision/recall platform — these remain deferred pending a future, separately approved decision, and are distinct from the deterministic, fixture-explicit oracle/failure-path evidence this patch does evaluate.
* A shared cross-repository schema package, a production dependency on my-dev-kit or the orchestrator, automatic publication, and any replacement of the existing security or code-rot systems.
* Broader `v0.8.0` retrieval-precision/recall platform work (see the `v0.8.0` entry below) — this patch must not absorb that scope, and that scope must not be used to shrink this patch's required evidence-centered metrics.

Acceptance criteria:

* Every strategy runs against an identical, immutable target and case-expectation set; strategy order, tool versions, and inputs are recorded and fixed.
* Every metric derives from explicit fixture expectations and/or parsed packet/audit data, never from subjective judgment; missing data is reported as unavailable rather than zero.
* Repeated canonical runs (normalizing only timestamps, temporary paths, and timing) produce identical selected evidence, metrics, warnings, adequacy, truncation, and report structure.
* Unsupported context-capsule/retrieval-audit/`WorkflowInstructionPacket` schema majors fail clearly rather than being silently reinterpreted.
* Existing audits, benchmarks, reports, security validation, and CLI behavior regress cleanly; no existing experiment plugin, strategy, report path, or command is removed or broken.
* my-dev-kit-lab remains outside the production execution path of my-dev-kit and the orchestrator, and never becomes a required runtime dependency of either.
* `v0.4.3` was published as the npm/tag/GitHub-Release baseline that superseded `v0.4.2`.

### v0.4.4 — producer-readiness bridge

Status: **published**.

Purpose:

* Extend `v0.4.3`'s `combined-bounded-stage-context` strategy so my-dev-kit-lab can read the frozen my-dev-kit-orchestrator supplemental implementation/test-context packet and retrieval-report documents plus an observed readiness result, and deterministically measure owner, allocation, truncation-cause, supplemental/raw agreement, readiness-agreement, and criticality-overlay evidence — without reimplementing upstream producer owner-selection, evidence-allocation, producer-parity, or orchestrator readiness policy.

Ownership boundaries approved for this patch (unchanged from `v0.4.3`): my-dev-kit-lab owns explicit fixture expectations, deterministic comparison, metric calculation, and neutral reporting; it never recomputes upstream behavior. Readiness remains observed consumer output — the frozen orchestrator commit exposes no on-disk readiness artifact, so it is accepted only as a bounded plain object, never invented as a file format.

In scope for `v0.4.4`:

* Exact readers for the frozen implementation/test-context packet and retrieval-report documents, and a bounded plain-object adapter for the orchestrator readiness result, in `src/evaluation/upstreamArtifacts`.
* Deterministic owner, allocation, truncation-cause, supplemental/raw agreement, readiness-agreement, and criticality-overlay metric calculators in `src/evaluation/stageContextMetrics`, reusing the existing `available`/`unavailable`/`not-applicable` metric model.
* An additive producer-readiness bridge evaluator (`evaluateProducerReadinessBridge`) composing those calculators exactly once per run over already-loaded evidence.
* Additive, optional producer-readiness expectations on `StageContextExpectationFixtureV1` (`src/evaluation/stageContextExpectations`).
* Additive, optional producer-readiness bridge inputs and payload fields on the existing `combined-bounded-stage-context` strategy input/execution types; every existing `v0.4.3` strategy and combined-strategy case without these inputs is unaffected.
* An additive, optional producer-readiness bridge section in the existing `report.json`/`report.html`/`report.txt` pipeline, with the same bounded-detail and neutral-interpretation conventions as `v0.4.3`.
* A deterministic historical producer-to-readiness fixture family (owner false negative/positive, avoidable/genuine-hard-limit/unresolved truncation, supplemental contradiction, readiness identity mismatch, invalid-ready, valid-blocked, valid-refresh-required, criticality mismatch, partial mapping, and a corrected case) reused across focused tests and one complete fixture-to-report integration test.

Explicitly out of scope / deferred for `v0.4.4`:

* Public CLI flags for any producer-readiness bridge input — all inputs remain programmatic.
* A new experiment runner or a parallel report framework.
* Reimplementing upstream owner selection, evidence allocation, producer parity, orchestrator readiness, or readiness issue prioritization.
* A composite score, grade, ranking, or lab-generated release verdict.
* Plots, screenshots, and gallery integration for producer-readiness bridge evidence.
* Package-version bump, release branch, tag, GitHub Release, or npm publication.

Acceptance:

* Every producer-readiness metric explicitly reports `available`, `unavailable`, or `not-applicable`; an available zero, an unavailable reason, and a not-applicable denominator remain distinct everywhere.
* Existing `v0.4.3` strategies, expectation fixtures, and reports remain valid and unchanged when no producer-readiness bridge inputs are supplied.
* No owner-selection, allocation, producer-parity, or readiness policy is duplicated from either frozen upstream repository.
* Repeated canonical runs of the corrected fixture case produce identical canonicalized digests, including the producer-readiness bridge result.
* `v0.4.4` is released after upstream verification, PR merge, main CI, tag, GitHub Release, and npm publish. All release documentation is in final post-publication state.

### v0.4.5 — context-integrity evaluation and frozen ecosystem regression

Status: **published** (2026-08-01).

Purpose:

* Extend the producer-readiness bridge to consume the exact current local my-dev-kit v1.10.4 condition-aware producer contract (role-condition coverage, allocation/spillover diagnostics, required-versus-optional omission) and the exact current local my-dev-kit-orchestrator v1.2.3 run-integrity contract (readiness, prompt authorization, judge integrity, correction routing, final-report eligibility, lifecycle), and calculate bounded agreement across both systems without reimplementing either upstream's policy.
* Preserve a permanent, byte-exact regression fixture for the real my-dev-kit v1.11.0 Batch 1 context-readiness false-negative failure, paired with a corrected-contract replay for the same request/target/index identity, so the failure class cannot silently regress.

Ownership boundaries approved for this patch (unchanged from `v0.4.3`/`v0.4.4`): my-dev-kit-lab parses exact upstream evidence, compares producer and orchestrator claims, and reports agreement/contradiction/unavailable; it never derives an expected judge verdict, selects a correction destination, authorizes a final report, marks a stage complete, or replaces either upstream verdict.

In scope for `v0.4.5`:

* Exact mirrors of the local my-dev-kit v1.10.4 additive producer fields (`roleConditionCoverage`, extended `groupTruncation` allocation/omission fields, `truncation.requiredEvidenceLost`) in `src/evaluation/upstreamArtifacts`, with schema-major-1 legacy compatibility preserved.
* Allocation, spillover, condition-coverage, witness, and last-witness-loss metrics, and producer-condition / requiredEvidenceLost / producer-readiness agreement calculators, in `src/evaluation/stageContextMetrics`.
* An exact, bounded lab-owned mirror of the local my-dev-kit-orchestrator v1.2.3 run-integrity contract (`RunIntegrityGateResult`, `JudgeIntegrityResult`, `FinalReportEligibilityResult`, and `artifact-state.json` lifecycle records) in `src/evaluation/upstreamArtifacts` and `src/evaluation/stageContextSelectors`, since the orchestrator itself exposes these as in-memory structured results plus one lifecycle JSON file rather than one combined on-disk artifact.
* Readiness/prompt, readiness/expected-judge, expected/actual-judge, judge/correction, judge/final-eligibility, eligibility/final-artifact, and lifecycle-integrity agreement calculators, plus one bounded end-to-end agreement summary, composed once through the existing `evaluateProducerReadinessBridge`.
* A permanent, byte-exact-where-applicable frozen fixture pair under `tests/fixtures/ecosystem/context-integrity/v0.4.5/`: the real preserved my-dev-kit v1.11.0 Batch 1 failed run, and a corrected-contract replay for the same request/target/index identity, both with SHA-256 provenance manifests, a 49-case negative matrix, deterministic repeated-evaluation verification, and fixture/target immutability verification.
* Additive `report.json`/`report.txt`/`report.html` sections presenting the above through the existing bounded-detail, availability, and neutral-interpretation conventions.

Explicitly out of scope / deferred for `v0.4.5`:

* Public CLI flags or a new command family for context-integrity evaluation — all inputs remain programmatic/fixture-driven.
* A live, full ten-stage AI-authored replay of the regressed feature; the corrected-replay fixture is a hand-distilled representation of the exact validated contracts for the same request/target/index identity, not a byte-exact generated run.
* A composite score, grade, ranking, winner, or lab-generated release verdict.
* Release-process mechanics; these were handled by the repository's standard readiness and release workflows rather than by the context-integrity feature itself.

Acceptance:

* Current and legacy (schema-major-1) producer artifacts both parse; unknown additive fields and missing legacy diagnostics remain distinct from fabricated zero/false/empty values.
* Required and optional evidence omission remain distinguishable everywhere they are reported, including through the false-negative regression fixture.
* The frozen failed-run fixture evaluates deterministically to `contradiction-present`; the corrected-replay fixture evaluates deterministically to `full-agreement`; both remain stable across repeated evaluation and fixture-immutability checks.
* No upstream producer, orchestrator, readiness, judge, correction, or lifecycle policy is reimplemented or overridden by a lab-owned verdict.

### v0.4.6 — installed-package CLI and runtime-boundary correction

Status: **published**.

Purpose:

* Correct the installed-package architecture so the published npm package exposes the existing user-facing lab capabilities through a coherent supported CLI instead of requiring a source checkout for documented security, audit, and related workflows.
* Separate the installed package location, writable lab workspace/output location, and inspected target-project location so the npm installation itself is not treated as the writable tool workspace.
* Preserve all existing experiment, audit, security-validation, Android, report, gallery, and v0.4.3-v0.4.5 evaluation behavior while fixing packaging and command-surface structure before v0.5.0 warm-index work begins.

Implemented:

* One compiled installed CLI router (`dist/scripts/cli.js`, routed through `src/cli/runLabCli.ts`) whose subcommands delegate to existing implementation owners under `src/commands/` rather than duplicating product logic. Public routes: `--help`/`--version`, `security validate`, `audit`, `experiment list`/`describe`/`run`/`controlled`, `report render`, `plots generate`, `gallery build`, `demo final`, plus the historical direct final-demo invocation form.
* Repository `npm run` commands refactored into thin adapters over the same `src/commands/` owners the installed CLI calls — one implementation per capability. Developer-only commands (`security:deps`/`package`/`codeql`/`semgrep`, fuzz smoke, `test`, `docs:check`, benchmark verification, `report:context-integrity-smoke`, visualization demos) remain repository-only `npm run` commands; none were promoted into the public installed CLI.
* An explicit runtime path model (`src/runtime/`, `LabExecutionContext`): read-only `packageRoot` (discovered by walking up from the executing module's own location, never from `process.cwd()`), `invocationCwd` (explicit relative paths resolve here), writable `workspaceRoot` (default `<home>/.my-dev-kit-lab`, overridable via a global `--workspace <path>` that must precede the command), and `resourceRoot` for bundled runtime resources, resolved with path-semantics containment rather than string-prefix matching.
* Safe default output behavior for installed execution: `audit` and `security validate` root their implicit (no explicit `--out`) output under `workspaceRoot` when invoked through the installed CLI, never under the installed package directory or the inspected target; `experiment run`'s implicit output root moved under `workspaceRoot/lab-output/experiments/...` (same subdirectory shape as before). Explicit output paths keep unchanged resolution semantics.
* A reconciled npm package-content allowlist limited to the resources the installed CLI and its bundled runtime resources actually require, with a package-content regression test confirming removed developer-only content does not reappear.
* A permanent packed-tarball acceptance gate (`npm run verify:packed-package`): build, a real `npm pack`, install the exact tarball into a clean temporary consumer project, execute the installed binary, and verify default-workspace output, explicit-workspace output, target immutability, and installed-package immutability via recursive SHA-256 snapshot comparison.
* `engines.node` raised to `>=24`; GitHub Actions CI standardized on Node `24` and `latest` across Ubuntu/macOS/Windows; the pre-release readiness workflow tracks Node `latest`; both workflows run `npm run verify:packed-package`.
* A resolved transitive `nanoid` devDependency security advisory (lockfile-only correction); the published runtime dependency tree was unaffected.

Acceptance (met):

* A user can install or invoke the published package without cloning the repository and run the supported installed CLI command families listed above — proven by the packed-package acceptance gate against a real tarball in a clean consumer project.
* `npm run` contributor aliases and the installed CLI use the same underlying behavior owners; there is no second security, audit, experiment, or report implementation.
* The package installation directory and target projects are not used as the default writable location; the acceptance gate proves both remain byte-for-byte unchanged after installed audit/security execution.
* The exact npm artifact contains every required runtime module/resource; no installed command depends on source-only `scripts/*.ts`, `tsx`, TypeScript, Vitest, or Playwright.
* GitHub CI passed for Linux/macOS/Windows × Node 24/latest against the release PR and merged main.
* Existing v0.4.3, v0.4.4, and v0.4.5 fixtures, metrics, reports, audits, security validation, Android validation, and experiment behavior remain compatible — no security check, audit detector, Android behavior, experiment scoring, or report schema changed.

Explicit exclusions (deferred, not part of v0.4.6):

* No warm-index reuse experiment implementation; that remains v0.5.0.
* No new security checks, Android checks, audit detector families, experiment metrics, scoring rules, or upstream producer/orchestrator policy.
* No manual pentest work.
* No public visualization-demo CLI routing.

### Post-v1 / version TBD — manual pentest

Status: **deferred**.

* Manual pentest is no longer assigned to v0.4.0 and is not assigned to v0.4.1 or v0.4.2.
* It remains a human-led post-v1 / version-TBD workflow.
* Automated security or Android validation must never be described as manual pentesting.

### v0.5.0 — warm-index reuse experiment support

Status: **planned; not implemented**.

Purpose:

* Add a plugin for testing the strongest my-dev-kit value case: indexing once and reusing the index across multiple tasks.

Features:

* Add warm-index-reuse experiment plugin.
* Add setup step to index a project once.
* Run multiple benchmark tasks using the same index.
* Compare against raw-full-file context per task.
* Measure index build time, retrieval time per task, raw context size, retrieved context size, amortized index cost, correctness, duration, and token usage when available.
* Add report section explaining cold cost versus warm cost.
* Add plots for amortized index cost, raw versus retrieved context size, correctness, and cumulative token usage.

Acceptance:

* Warm-index experiment runs with fake-agent.
* Reports clearly separate one-time index cost from per-task retrieval cost.
* Results do not overclaim token savings when token totals are unavailable.

### v0.5.1 — expanded warm-index benchmark suite

Status: **planned; not implemented**.

Purpose:

* Add enough tasks to make warm-index reuse meaningful.

Features:

* Add multiple cases per benchmark project.
* Add localized tasks.
* Add cross-module tasks.
* Add broad-change tasks as negative controls.
* Add answer keys for all new tasks.
* Add expected relevant files and symbols for retrieval evaluation.
* Add benchmark metadata for task locality.

Acceptance:

* At least five tasks exist for the medium benchmark project.
* At least five tasks exist for the large/mixed benchmark project.
* Reports can compare warm-index behavior as task count increases.

### v0.5.2 — warm-index real-agent campaigns

Status: **planned; not implemented**.

Purpose:

* Run Codex and Claude on warm-index experiments with structured partial-outcome reporting.

Features:

* Add real-agent warm-index campaign presets.
* Add reduced-size campaign for Codex timeout isolation.
* Add Claude token-unavailable explanation.
* Add partial-result friendly report sections.
* Add screenshots and gallery output.

Acceptance:

* Campaigns can run with Codex and Claude.
* Partial outcomes are structured.
* Reports distinguish infrastructure success from agent/provider limitations.

### v0.6.0 — index freshness and changed-file detection

Status: **planned; not implemented**.

Purpose:

* Detect source changes that may invalidate indexed context.

Features:

* Record index manifest metadata.
* Track indexed files, file hashes, modified timestamps where useful, my-dev-kit version, command used, and generated artifacts.
* Add changed-file detection against the current working tree.
* Add reportable index freshness status:

  * fresh
  * stale
  * partially stale
  * unknown

Acceptance:

* Lab can detect changed files after an index was built.
* Freshness status appears in experiment artifacts and reports.

### v0.6.1 — affected-neighborhood experiments

Status: **planned; not implemented**.

Purpose:

* Measure graph-neighborhood targeting after localized changes.

Features:

* Use my-dev-kit graph outputs to map changed files and symbols to affected nodes.
* Determine whether a future task overlaps affected nodes.
* Add affected-neighborhood metrics:

  * changedFileCount
  * changedSymbolCount
  * affectedNodeCount
  * affectedEdgeCount
  * taskOverlapCount
  * taskOverlapPercent
  * reindexRecommendation

Acceptance:

* Experiment can classify next task as related or unrelated to a prior change.
* Report explains whether reindex was recommended.

### v0.6.2 — incremental-change and staleness plugin

Status: **planned; not implemented**.

Purpose:

* Compare stale, refreshed, and incrementally updated index behavior after controlled code changes.

Features:

* Add incremental-change-staleness plugin.
* Define change scenarios:

  * unrelated file change
  * local implementation change
  * exported symbol change
  * public API change
  * import graph change
  * test-only change
* Run next tasks with stale index, refreshed full index, and partial refresh where available.
* Score correctness and retrieval safety.
* Report stale-index risk.

Acceptance:

* Plugin demonstrates safe and unsafe stale-index scenarios.
* Reports do not recommend skipping reindex unless evidence supports it.

### v0.6.3 — partial-refresh planning

Status: **planned; not implemented**.

Purpose:

* Add evidence and planning support for bounded index refreshes.

Features:

* Add experiment treatments:

  * my-dev-kit-full-refresh
  * my-dev-kit-no-refresh
  * my-dev-kit-changed-files-refresh
  * my-dev-kit-affected-neighborhood-refresh
* If my-dev-kit does not yet support partial reindex, simulate or mark treatment unavailable.
* Document dependency on future my-dev-kit support.

Acceptance:

* Lab can model partial-refresh experiments even if my-dev-kit support is incomplete.
* Reports clearly distinguish implemented behavior from planned capability.

### v0.7.0 — context-window scaling plugin

Status: **planned; not implemented**.

Purpose:

* Measure raw and guided strategies under increasing repository and context sizes.

Features:

* Add context-window-scaling plugin.
* Define context budgets:

  * 8k
  * 16k
  * 32k
  * 64k
  * custom
* Measure raw context estimated tokens, retrieved context estimated tokens, whether raw context fits, whether retrieved context fits, correctness, omitted relevant files, and context budget utilization.
* Add report sections for context fit/fail.
* Add plots for raw versus retrieved context size, success rate by context budget, and correctness by context budget.

Acceptance:

* Experiment can mark raw strategy as context-too-large without treating it as a normal failure.
* my-dev-kit-guided treatment can be evaluated under the same budget.

### v0.7.1 — synthetic large-repository generator

Status: **planned; not implemented**.

Purpose:

* Generate reproducible repositories with controlled scale and topology.

Features:

* Add deterministic benchmark generator for synthetic TypeScript and Python repositories.
* Generate configurable file count, module depth, internal imports, symbol count, test count, task locality, and repeated patterns.
* Add answer keys for generated tasks.

Acceptance:

* Generated projects can be used in context-window experiments.
* Generated source is deterministic and maintainable.

### v0.7.2 — real-world and local-repository experiments

Status: **planned; not implemented**.

Purpose:

* Support repeatable campaigns against explicitly selected local repositories.

Features:

* Add support for external benchmark subject paths.
* Add safety checks for ignored files and large files.
* Add no-commit/no-modification policy for external source.
* Add report metadata for external repo name, commit, and size.
* Add privacy-safe artifact policies.

Acceptance:

* User can run lab experiments against a local repo path.
* Reports capture enough metadata to reproduce the experiment without copying private code.

### v0.8.0 — retrieval precision/recall plugin

Status: **planned; not implemented**.

Purpose:

* Measure whether retrieval includes required context and excludes irrelevant context without requiring real agents.

Features:

* Add retrieval-precision-recall plugin.
* Run my-dev-kit search, lookup, source, and slice commands.
* Compare retrieved files and symbols against answer keys.
* Measure file precision, file recall, symbol precision, symbol recall, fact coverage, irrelevant context ratio, retrieved token count, and missed required context.

Acceptance:

* Experiment does not require real agents.
* Retrieval metrics are deterministic.
* Reports identify missed files/symbols and irrelevant retrieved context.

### v0.8.1 — retrieval query strategy comparison

Status: **planned; not implemented**.

Purpose:

* Compare different ways of asking my-dev-kit for context.

Features:

* Compare keyword search, symbol lookup, graph neighborhood, source slice, data-model graph, model-view-lineage, and combined graph-guided workflows.
* Add strategy-specific metrics.
* Add report section showing which retrieval strategy worked best for each task type.

Acceptance:

* Lab can compare multiple my-dev-kit retrieval workflows without running coding agents.

### v0.8.2 — context-pack generation experiments

Status: **planned; not implemented**.

Purpose:

* Evaluate reproducible, auditable task-specific context packs.

Features:

* Add context-pack treatment.
* Generate context pack containing task summary, relevant files, relevant symbols, source slices, call relationships, tests, and evidence notes.
* Compare context pack size and coverage against raw full-file context.
* Add report preview of context pack.

Acceptance:

* Context pack artifacts are generated.
* Reports show context pack coverage and size.

### v0.9.0 — agent-success-rate plugin

Status: **planned; not implemented**.

Purpose:

* Compare task completion and correctness across context strategies.

Features:

* Add agent-success-rate plugin.
* Run agents on implementation tasks.
* Capture changed files.
* Run benchmark tests.
* Score tests passed, expected files modified, unexpected files modified, answer-key facts satisfied, regression failures, time, and tokens if available.
* Add safe sandbox/copy workflow for benchmark projects.
* Preserve diffs as artifacts.
* Add edit-quality and blast-radius metrics.
* Add multi-attempt repair mode as an optional experiment mode.

Acceptance:

* Fake-agent or deterministic fixture can simulate edits.
* Real-agent campaign can run with guarded local benchmark copies.
* Reports show diff summary, test result summary, blast radius, and repair-attempt labeling where applicable.

### v0.9.1 — normalized provider telemetry and campaign scheduler

Status: **planned; not implemented**.

Purpose:

* Normalize available provider/CLI telemetry and make real-agent campaigns safer to run incrementally.

Features:

* Improve agent output parsing.
* Add token usage reliability levels:

  * provider-reported
  * cli-reported
  * parsed-from-output
  * unavailable
  * estimated
* Add duration source metadata.
* Add status taxonomy:

  * completed
  * failed
  * timeout
  * invalid-output
  * agent-unavailable
  * agent-limit-reached
  * token-unavailable
* Add campaign queue.
* Add one-case-at-a-time mode.
* Add resume mode.
* Add skip completed runs.
* Add rate/limit pause handling.
* Add per-agent timeout presets.
* Add campaign progress summary.

Acceptance:

* Reports make clear which comparisons are strong, partial, or unavailable.
* Interrupted campaigns can resume.
* Partial results are preserved.

### v0.9.2 — hardened real-agent prompts and report/gallery generalization

Status: **planned; not implemented**.

Purpose:

* Harden real-agent prompt contracts and generalize reports/gallery for stable release readiness.

Features:

* Add stricter output schemas for Codex and Claude.
* Add short-form prompt mode.
* Add no-extra-explanation mode.
* Add bounded tool-use mode.
* Add max command count guidance.
* Add per-agent prompt templates.
* Make report renderer fully plugin-aware.
* Add report section registry.
* Add glossary links for every metric.
* Add report-level caveats generated from metric reliability.
* Improve static HTML report UX.
* Make gallery the entry point for many experiment outputs.

Acceptance:

* Invalid-output rate improves in smoke campaigns.
* Reports compare prompt template versions.
* Existing context-strategy report renders through generic report framework.
* Warm-index, retrieval, context-window, audit, security, and mobile reports can share or link through consistent infrastructure where appropriate.
* Gallery can browse multiple experiment and validation outputs.

## Stable and post-stable releases

### v1.0.0 — stable framework release

Status: **planned; not implemented**.

Purpose:

* Release my-dev-kit-lab as a stable experiment, audit, automated security-validation, Android validation, reporting, and evidence framework after all prerequisite `v0.x` work; manual pentest remains post-v1.

Required capabilities:

* Stable experiment plugin framework.
* Stable `context-strategy-comparison` plugin.
* Warm-index-reuse experiment support.
* Retrieval precision/recall experiment support.
* Context-window scaling experiment support.
* At least partial index freshness/staleness support.
* Agent-success-rate experiment support.
* Stable audit framework with code rot, quality, and security summary support.
* Stable automated security validation.
* Android validation profile support.
* Stable artifact schema versioning.
* Stable report output.
* Stable gallery output.
* Strong documentation.
* Public examples.
* Deterministic fake demos.
* Structured real-agent partial outcomes.
* No known critical build/test failures.

Acceptance:

* Users can add a new experiment type without copying the whole pipeline.
* Users can audit a target project before implementation or release preparation.
* Users can validate a local Android project for release preparation without signing, publishing, or modifying target source files.
* Reports explain metrics, findings, confidence, and limitations clearly.
* All core tests pass.
* Verify passes.
* Cross-platform CI passes.

### v1.1.0 — incremental index and stale-context proof

Status: **planned; not implemented**.

Purpose:

* Productize evidence for incremental indexing and stale-context controls.

Features:

* Stronger changed-node and affected-neighborhood experiments.
* Partial-refresh treatment support if my-dev-kit supports it.
* Stale-index risk reporting.
* Reindex recommendation reports.
* Incremental workflow diagrams and tutorials.

### v1.2.0 — large-repository, external-repository, and mobile scaling

Status: **planned; not implemented**.

Purpose:

* Expand reproducible evidence across larger repositories, explicitly selected local repositories, and additional mobile project profiles.

Features:

* External repo subject support.
* Synthetic large-repo generator.
* Context-window scaling campaigns.
* Large-repo report templates.
* Privacy-safe artifact policies.
* Reproducibility metadata.
* Additional mobile validation profiles after Android is stable, such as Flutter, React Native, iOS SwiftUI, Kotlin Multiplatform, Expo, and Capacitor/Ionic.

### v1.3.0 — agent productivity and edit quality

Status: **planned; not implemented**.

Purpose:

* Consolidate agent-success, edit-quality, and repair evidence.

Features:

* Stronger agent-success experiments.
* Diff artifact capture.
* Test-pass scoring.
* Blast-radius scoring.
* Multi-attempt repair experiment mode.
* Real-agent campaign presets.
* Cross-project implementation-readiness evidence.

### v1.4.0 — publication and evidence portal

Status: **planned; not implemented**.

Purpose:

* Generalize reports, plots, screenshots, validation summaries, mobile reports, audit outputs, and gallery output into a publication-oriented evidence portal.

Features:

* Curated example reports.
* Public demo screenshots.
* Release-linked evidence bundles.
* Comparison summaries across experiment types.
* Audit and security evidence summaries.
* Android validation example reports.
* Documentation for interpreting evidence responsibly.
* Gallery as a navigable evidence portal.

## Command design principles

Future work should extend the existing experiment, audit, and security-validation command families through validated flags when practical. It should not create one command per detector, platform, or report type. Candidate syntax remains version-specific planning until implementation confirms parser and registry conventions.

Manual-pentest commands remain intentionally absent because that workflow is deferred to post-v1/version TBD. See [COMMANDS.md](COMMANDS.md) for the implemented command surface.

## Mobile validation boundaries

my-dev-kit-lab mobile support means:

* Detect mobile project type.
* Validate Android project structure.
* Audit Android security risks.
* Run safe Gradle validation commands when requested.
* Inspect build, test, lint, and package metadata where available.
* Generate text and JSON reports.
* Produce a release-preparation verdict.
* Preserve non-destructive behavior.

my-dev-kit-lab mobile support does not mean:

* Creating Android apps.
* Bootstrapping mobile projects.
* Indexing Android code for retrieval.
* Publishing to Google Play.
* Uploading to Play Console.
* Signing releases.
* Managing signing secrets.
* Creating keystores.
* Editing target Gradle files.
* Updating target dependencies.
* Automatically fixing target code.
* Modifying target projects by default.

## Architecture direction

Future versions must extend the existing experiment, audit, security-validation, Android, report, and gallery ownership boundaries rather than create parallel runners, adapters, or presentation systems. Production indexing and workflow orchestration remain outside my-dev-kit-lab. See [ARCHITECTURE.md](ARCHITECTURE.md) for current ownership and each version section above for planned dependencies and exclusions.

## Validation expectations for every release

Every version's acceptance criteria must include relevant regression, compatibility, non-destructive-target, report-schema, documentation, and cross-platform checks. Exact commands and release gates belong in [WORKFLOWS.md](WORKFLOWS.md); current syntax belongs in [COMMANDS.md](COMMANDS.md).

## Key rule

Use one framework per responsibility:

* Experiments measure behavior across experiment variants.
* Security validation performs automated target security checks.
* Manual pentest support generates human-led testing plans, checklists, findings, and reports.
* Mobile validation inspects platform-specific project security, build, package, and release-readiness risks.
* Audits inspect project health across code rot, code quality, and security summaries.
* Reports render evidence and results.

Do not collapse everything into one vague system.

Do not add many commands when flags can express the difference.

Do not break existing experiment framework commands.

Do not make mobile validation destructive.

Do not let my-dev-kit-lab become an app generator, publisher, signer, or Play Store uploader.
