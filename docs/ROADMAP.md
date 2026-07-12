# Roadmap

This roadmap separates the implemented baseline from planned work. A version listed here is not released or implemented unless explicitly marked as current or completed.

The roadmap follows semantic version order. `v1.0.0` is the stable release after the complete `v0.x` development track; it is newer than every `v0.x` release.

## Version sequence

```mermaid
flowchart LR
  A[v0.2.0<br/>plugin framework] --> B[v0.2.1<br/>previous baseline]
  B --> C[v0.2.2<br/>published security-validation baseline]
  C --> D[v0.3.0-v0.3.4<br/>published audit and code-rot track]
  D --> E[v0.4.0<br/>published Android MVP]
  E --> F[v0.4.1 published advanced Android security] --> G[v0.4.2 implemented on feature branch, unreleased]
  G --> H[individual v0.5.0 through v0.9.2<br/>experiment evidence releases]
  G --> H[v1.0.0<br/>stable framework]
  H --> I[v1.1.0-v1.4.0<br/>post-stable releases]
```

## Product direction

my-dev-kit-lab is the experiment, evidence, reporting, security-validation, audit, and release-readiness companion for my-dev-kit.

my-dev-kit-lab should remain validation-first, evidence-first, and non-destructive by default. It should not become a project generator, app publisher, signing tool, Play Console uploader, or automatic fixer.

The strongest product thesis remains:

* my-dev-kit helps when a repository is larger than the task.
* my-dev-kit-lab should prove when my-dev-kit is useful, not claim that my-dev-kit always saves tokens.
* The most important usefulness cases are large repositories, localized tasks, warm index reuse, context-window limits, retrieval precision, stale-index risk detection, and better coding-agent edit quality.
* Security validation, audit reporting, code rot detection, code quality checks, mobile validation, and manual pentest support should strengthen release-readiness and implementation-readiness workflows around this evidence system.

## Current baseline

### v0.2.0 — completed

* Generic experiment-plugin contracts, registry, runner, configuration, target model, and normalized results.
* `context-strategy-comparison` as the first experiment plugin.
* Existing raw-full-file versus my-dev-kit-guided behavior preserved through the plugin.
* Target-aware experiment execution.
* Plugin-aware JSON and HTML reports.
* Backward-compatible `experiment:list`, `experiment:describe`, `experiment:run`, and legacy controlled-experiment workflows.
* Reusable target-aware automated security validation carried forward from earlier security work.

### v0.2.1 — previous package baseline

* Correct target-project execution of `test:security` during external-target validation, including installed-package execution.
* Documentation synchronized with the implemented plugin and security-validation architecture.
* Fortification continues after this baseline without changing the backward-compatible `security:validate` command.
* The current package baseline is not the final security, audit, mobile, or pentest architecture.

### v0.2.2 — fortified automated security validation (published)

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

Command direction:

* Keep existing commands:

  * `npm run security:validate`
  * `npm run security:validate -- --target <path>`

* Current flags:

  * `--checks deps,package,static,cli-adversarial,fuzz,boundary,subprocess,secrets,network`
  * `--profile node-cli-package|local-tool|npm-package`
  * `--format text|json|text,json`
  * `--fail-on blocker|high|medium|low`
  * `--out <path>`

Current architecture:

* `src/securityValidation/attackScenarios/`
* `src/securityValidation/attackScenarios/profiles/`
* `src/securityValidation/attackScenarios/scenarios/`
* `src/securityValidation/attackScenarios/reportSchemaGuard.ts`
* `src/securityValidation/cliAdversarial/`
* `src/securityValidation/validate/`
* `src/securityValidation/report/`
* `scripts/security/validate.ts`
* `tests/security/attackScenarios/`

Current status:

* Existing `security:validate` behavior remains backward compatible.
* Existing dependency, package, static-scan, fuzz, and CLI adversarial checks still work.
* All 9 accepted `--checks` ids have implementation coverage.
* New attack scenarios produce structured evidence and report metadata.
* Target project files are not modified by default.
* Optional unavailable tools are reported as skipped, not passed.
* Existing experiment framework behavior is unchanged.

## Planned v0.x development track

### v0.3.0 — generic audit framework and code rot detector (published)

The generic audit framework and code-rot detector described below were published in v0.3.0.

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

Command direction:

* Add one main audit command:

  * `npm run audit`

* Use flags instead of separate audit commands:

  * `npm run audit -- --target <path> --types code-rot`
  * `npm run audit -- --target <path> --types code-rot --include docs,tests,package,architecture,cli`
  * `npm run audit -- --target <path> --types code-rot --format text,json`

Suggested architecture:

* `src/audits/core/`
* `src/audits/codeRot/`
* `src/audits/codeRot/detectors/`
* `src/report/audits/`
* `scripts/audits/runAudit.ts`
* `tests/audits/core/`
* `tests/audits/codeRot/`

Acceptance:

* `npm run audit -- --target <path> --types code-rot` works.
* Reports include target metadata, tool metadata, timestamp, summary, issue counts, evidence, severity, confidence, recommended action, validation commands, release-blocking flag, implementation-blocking flag, and auto-fix eligibility.
* No target files are modified.
* Invalid targets fail cleanly.
* JSON schema is stable.
* Windows paths work.
* Existing experiment commands still work.
* Existing `security:validate` still works.

Published scope:

* `npm run audit` is implemented; `--types code-rot` is the only implemented audit type.
* `--types quality`, `--types security`, `--types project`, and `--types all` are recognized but fail cleanly with exit code `2` rather than running.
* All 10 code-rot detector families are implemented and registered: `stale-command-reference`, `docs-code-mismatch`, `package-release-rot`, `duplicate-implementation-candidate`, `dead-code-candidate`, `test-rot`, `architecture-drift`, `dependency-environment-rot`, `cross-platform-rot`, `security-validation-assumption-rot`.
* Target resolution, project inventory scanning, and source-of-truth collection are implemented in `src/audits/core`.
* The audit report schema is stable at `schemaVersion` `"1.0"` with 13 top-level fields; `metadata.auditTypes` is included.
* Reports are written under `reports/audits/code-rot/` by default.
* External-target audits are non-destructive.
* This work has not been committed as a numbered release, tagged, or published to npm.

### v0.3.1 — code quality detector

Purpose:

* Add code-quality checks as a separate audit detector family.
* Keep code quality separate from code rot and security, while allowing shared evidence in unified audit reports.

Features:

* Detect overly large files.
* Detect overly large functions where deterministic analysis is feasible.
* Detect high-complexity candidates.
* Detect duplicate implementation candidates.
* Detect poor module boundaries.
* Detect missing tests for exported public modules.
* Detect testability issues.
* Detect TypeScript strictness/config drift.
* Detect lint/tooling absence or inconsistency.
* Detect dependency bloat signals.
* Treat findings as maintainability risks, not automatic proof of bad code.

Command direction:

* Reuse:

  * `npm run audit`

* Add:

  * `npm run audit -- --target <path> --types quality`
  * `npm run audit -- --target <path> --types code-rot,quality`
  * `--quality-checks complexity,duplication,modularity,testability,typescript,lint,deps`

Suggested architecture:

* `src/audits/codeQuality/`
* `src/audits/codeQuality/detectors/`
* `tests/audits/codeQuality/`

Acceptance:

* Quality findings use the shared audit issue schema.
* Quality findings include evidence and confidence.
* Quality detector does not duplicate code rot detector logic unnecessarily.
* Existing code rot audit still works.
* Existing security validation still works.
* Existing experiment commands still work.

### v0.3.2 — security results in unified audit reports

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

Command direction:

* Keep:

  * `npm run security:validate`
  * `npm run security:validate -- --target <path>`

* Extend:

  * `npm run audit -- --target <path> --types security`
  * `npm run audit -- --target <path> --types code-rot,quality,security`
  * `--security-checks deps,package,static,cli-adversarial,fuzz,attack-scenarios,secrets,network`

Suggested architecture:

* `src/audits/security/`
* `src/audits/security/securityAuditAdapter.ts`
* `src/audits/security/mapSecurityFindingToAuditIssue.ts`
* `src/audits/core/auditSource.ts`
* `src/audits/core/auditResultMerger.ts`
* `tests/audits/security/`

Acceptance:

* `security:validate` remains backward compatible.
* `npm run audit -- --target <path> --types security` works.
* Audit reports include security findings in the shared issue model.
* Audit reports link or reference generated security reports.
* Optional skipped security tools are represented correctly.
* Existing security reports remain available.
* Existing experiment framework remains unchanged.

### v0.3.3 — project-wide audit command

Purpose:

* Make the audit framework easy to use before implementation, refactor, release readiness, or publication.
* Provide a single memorable project-wide audit command.

Features:

* Add audit profiles.
* Add default profile detection.
* Add combined audit summary.
* Add issue deduplication across code rot, quality, and security.
* Add source attribution for each issue.
* Add release-readiness recommendation.
* Add implementation-readiness recommendation.
* Add suggested next steps grouped by category.
* Add stable JSON output for future orchestrator integration.
* Write combined reports under `reports/audits/project/`.

Command direction:

* Main command:

  * `npm run audit -- --target <path>`

* Specialized behavior through flags:

  * `--types code-rot,quality,security`
  * `--include docs,tests,package,dependencies,cross-platform,architecture,cli,security`
  * `--security-checks deps,package,static,cli-adversarial,fuzz,attack-scenarios,secrets,network`
  * `--quality-checks complexity,duplication,modularity,testability,typescript,lint,deps`
  * `--rot-checks stale-references,docs-code-mismatch,duplicates,dead-code,test-rot,architecture,package,cross-platform,security-assumptions`
  * `--profile node-cli-package,local-tool,npm-package,web-app`
  * `--format text,json`
  * `--fail-on blocker,high,medium,low,none`

Suggested architecture:

* `src/audits/core/auditProfile.ts`
* `src/audits/core/auditProfileResolver.ts`
* `src/audits/core/auditResultMerger.ts`
* `src/audits/core/auditIssueDeduper.ts`
* `src/audits/core/auditRecommendation.ts`
* `src/audits/core/auditReadinessVerdict.ts`
* `src/audits/profiles/`
* `tests/audits/integration/`

Acceptance:

* `npm run audit -- --target <path>` works as the main project-wide audit.
* `--types code-rot`, `--types quality`, `--types security`, and `--types code-rot,quality,security` all work.
* One report contains combined findings without losing category or source attribution.
* Duplicate findings are merged or cross-linked.
* Report states whether the project is ready for implementation, refactor, release preparation, or publication.
* Existing `security:validate` remains available.
* Existing experiment framework remains available.

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

Status: **published**; current npm baseline.

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

Status: **implemented on `feature/v0.4.2-android-audit-adapter` (Batches 1–3 complete), unreleased**.

Purpose:

* Extend the existing general security audit adapter directly with Android-aware validation without creating a parallel adapter.

Implemented branch scope:

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
* Package version remains 0.4.1 until a separately authorized release.

### Post-v1 / version TBD — manual pentest

Status: **deferred**.

* Manual pentest is no longer assigned to v0.4.0 and is not assigned to v0.4.1 or v0.4.2.
* It remains a human-led post-v1 / version-TBD workflow.
* Automated security or Android validation must never be described as manual pentesting.

### v0.5.0 — warm-index reuse experiment support

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

Purpose:

* Compare different ways of asking my-dev-kit for context.

Features:

* Compare keyword search, symbol lookup, graph neighborhood, source slice, data-model graph, model-view-lineage, and combined graph-guided workflows.
* Add strategy-specific metrics.
* Add report section showing which retrieval strategy worked best for each task type.

Acceptance:

* Lab can compare multiple my-dev-kit retrieval workflows without running coding agents.

### v0.8.2 — context-pack generation experiments

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
* Manual pentest plan/checklist/report support.
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
* Users can generate manual pentest plans and checklists.
* Reports explain metrics, findings, confidence, and limitations clearly.
* All core tests pass.
* Verify passes.
* Cross-platform CI passes.

### v1.1.0 — incremental index and stale-context proof

Purpose:

* Productize evidence for incremental indexing and stale-context controls.

Features:

* Stronger changed-node and affected-neighborhood experiments.
* Partial-refresh treatment support if my-dev-kit supports it.
* Stale-index risk reporting.
* Reindex recommendation reports.
* Incremental workflow diagrams and tutorials.

### v1.2.0 — large-repository, external-repository, and mobile scaling

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

## Command surface direction

Commands to keep:

* `npm run experiment:list`
* `npm run experiment:describe`
* `npm run experiment:run`
* `npm run security:validate`
* `npm run audit`
* `npm run security:pentest`

Commands to avoid unless truly necessary:

* `npm run audit:code-rot`
* `npm run audit:quality`
* `npm run audit:security`
* `npm run audit:release`
* `npm run audit:docs`
* `npm run audit:tests`
* `npm run audit:package`
* `npm run mobile:detect`
* `npm run mobile:validate`
* `npm run mobile:release-check`
* `npm run security:android`

Preferred flag-based usage:

* Code rot only:

  * `npm run audit -- --target <path> --types code-rot`

* Quality only:

  * `npm run audit -- --target <path> --types quality`

* Security summary only:

  * `npm run audit -- --target <path> --types security`

* Full project audit:

  * `npm run audit -- --target <path> --types code-rot,quality,security`

* Automated security validation:

  * `npm run security:validate -- --target <path> --checks deps,package,static,cli-adversarial,fuzz,attack-scenarios`

* Android validation:

  * `npm run security:validate -- --target <path> --profile android`
  * `npm run security:validate -- --target <path> --profile android-compose`

* Manual pentest plan:

  * `npm run security:pentest -- --mode plan,checklist --target <path> --profile node-cli-package`

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

## Current boundaries

* `context-strategy-comparison` is the implemented experiment plugin.
* Automated security validation is implemented; a complete manual pentest framework is planned.
* The generic audit framework and code-rot releases through v0.3.4 are published. The published audit types are `code-rot` and `security`; broader quality/project audit families remain planned unless implementation proves otherwise.
* Android/mobile validation profiles are planned.
* Warm-index reuse, index freshness, context scaling, retrieval precision/recall, and agent-success plugins are planned.
* The evidence does not establish that my-dev-kit always saves tokens.
* The strongest thesis is that reusable structural indexing, graph-guided retrieval, targeted source slices, and auditable context selection help when a repository is larger than the task.

## Architecture direction

```mermaid
flowchart TD
  A[Experiments<br/>src/experiments] --> R[Evidence reports<br/>src/report]
  S[Security validation<br/>src/securityValidation] --> R
  M[Mobile validation<br/>src/mobile] --> S
  M --> R
  P[Manual pentest<br/>src/securityValidation/manualPentest] --> R
  Q[Project audits<br/>src/audits] --> R
  Q --> S
  Q --> M
  R --> G[Gallery and evidence portal]
```

Responsibility split:

* `src/experiments/` stays focused on experiment plugins and experiment execution.
* `src/securityValidation/` stays focused on automated security validation and manual pentest support.
* `src/mobile/` supports mobile project detection and platform-specific validation evidence, starting with Android.
* `src/audits/` becomes the unified project audit framework for code rot, code quality, and security summaries.
* `src/report/experiments/` stays focused on experiment reports.
* `src/report/audits/` becomes the shared audit report renderer.
* `src/report/securityManual/` supports manual pentest artifacts if manual reporting is too specialized for generic audit reports.
* `scripts/experiments/` contains experiment commands only.
* `scripts/security/` contains security validation and manual pentest commands.
* `scripts/audits/` contains the single audit entrypoint.
* `reports/security/` contains automated security validation reports.
* `reports/security/manual/` contains manual pentest artifacts.
* `reports/audits/` contains unified audit reports.

## Validation expectations for every release

Every release should run the relevant subset of:

* `npm install`
* `npm run build`
* `npm run test`
* `npm run verify`
* `npm run security:validate`
* `npm run security:validate -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"`
* `npm run security:validate -- --target "Z:\Users\newuser\Projects\scientific-literature-explorer-v1"`
* `npm run experiment:list`
* `npm run experiment:describe -- --experiment context-strategy-comparison`
* `npm run experiment:run -- --experiment context-strategy-comparison --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --case todo-ts-create-task --agents fake-agent --complexities short --no-screenshot`
* `npm pack --dry-run`

When Android validation exists, Android-profile releases should additionally run fixture-backed checks for:

* Android project detection.
* Android Compose detection.
* Android manifest audit.
* Android permission audit.
* Android exported component audit.
* Android deep link audit.
* Android network security audit.
* Android backup/data extraction audit.
* Android debug/release configuration audit.
* Android hardcoded secret scan.
* Android report schema stability.
* Android non-destructive target validation.
* Optional tool skipped-check handling.

GitHub Actions matrix should continue to cover:

* Ubuntu Node 24
* Ubuntu Node 22
* macOS Node 24
* macOS Node 22
* Windows Node 24
* Windows Node 22

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
