# Current State

This document records the repository's operational state. It is the source of truth for what is implemented, planned, blocked, validated, and next.

## Version and publication state

- Package: `@dailephd/my-dev-kit-lab`
- Package version: `0.4.5` (unchanged by the v0.4.6 implementation work; version bump belongs to release preparation)
- Latest release: `v0.4.5`, published on npm, as a Git tag, and as a GitHub Release (previous release: `v0.4.4`)
- Current repository implementation: `v0.4.6` (installed-package architecture correction) is implementation-complete on the development branch but **not yet published**. Do not treat it as available in the published `v0.4.5` package.
- Active planned version: `v0.5.0` (warm-index reuse experiment support), planned to begin after `v0.4.6` publishes. `v0.5.0` implementation has not begun.
- `v0.4.5` delivers context-integrity validation against published `@dailephd/my-dev-kit@1.10.4` and `@dailephd/my-dev-kit-orchestrator@1.2.3`; see [ROADMAP.md](ROADMAP.md) for its preserved scope and the future plan.
- Node support baseline: `engines.node` is `>=24`. GitHub Actions CI validates Node `24` and Node `latest` across Ubuntu, macOS, and Windows; Node `22` is no longer part of the supported matrix. The pre-release readiness workflow tracks Node `latest` rather than a hard-coded version.

See [CHANGELOG.md](../CHANGELOG.md) for release history and [ROADMAP.md](ROADMAP.md) for the complete future plan.

## Operational state

- Latest published-release branch: `main` (published `v0.4.5` state)
- `v0.4.5` release branch: `release/v0.4.5` (merged to main)
- Historical implementation branch: `fix/v0.4.5-context-integrity-validation`
- Current v0.4.6 implementation branch: `fix/v0.4.6-runtime-context-foundation`
- Published-release workflow stage: `v0.4.5` is released; implementation, individual readiness, coordinated cross-repository validation, published-upstream revalidation, release validation, tagging, GitHub Release creation, and npm publication are complete.
- v0.4.6 workflow stage: all six implementation batches (runtime/package-resource foundation, CLI router, low-risk installed routes, security/experiment routes, packed-package acceptance gate + CI, package-content and documentation reconciliation) are complete. **Pre-release readiness for v0.4.6 has not started.** v0.4.6 has not been tagged, released, or published.
- Validation result (v0.4.5, published): the live producer-to-orchestrator-to-lab path reached full agreement with zero contradictions; the coordinated negative matrix, shared security and package parity, determinism, target immutability, and candidate immutability checks passed. Published registry packages `@dailephd/my-dev-kit@1.10.4` and `@dailephd/my-dev-kit-orchestrator@1.2.3` were revalidated before release.
- Validation result (v0.4.6, unpublished): local Node 24 validation (`typecheck`, `verify`, full test suite, `npm run verify:packed-package`) passes on the implementation branch; see "Validation state" below for the exact gates run.
- Exact next action: run v0.4.6 pre-release readiness (full local validation, GitHub Node 24/latest CI evidence, release/package/documentation readiness gates) before any release preparation, tagging, or publication.

## Implemented

- Generic experiment-plugin runtime in `src/experiments`.
- Registry containing one experimental plugin: `context-strategy-comparison`.
- Raw-full-file versus my-dev-kit-guided behavior routed through that plugin while preserving legacy artifacts and commands.
- Self and explicit local-project experiment targets.
- Plugin-aware JSON and HTML reports in `src/report/experiments`.
- Benchmark metadata, prompt variants, fake-agent, Codex, and Claude adapters.
- Correctness, token, duration, status, reliability, plot, screenshot, visualization, gallery, and final-demo workflows.
- Automated security validation in `src/securityValidation`, covering dependency and package checks, CLI adversarial checks, CodeQL/Semgrep integration, bounded fuzz smoke, structured reports, and release verdicts.
- Attack-scenario security validation in `src/securityValidation/attackScenarios`, covering boundary, subprocess, secrets, and network checks with reusable profiles, payload/evidence models, report-schema guarding, and verdict-impact metadata.
- Self and explicit local-project security-validation targets.
- Generic audit framework in `src/audits`, with `npm run audit` as the CLI entrypoint (`scripts/audits/runAudit.ts`). `code-rot` and `security` audit types are implemented; `quality`, `project`, and `all` audit types are planned and fail cleanly (exit code 2) rather than running.
- 10 code-rot detector families are implemented and registered: `stale-command-reference`, `docs-code-mismatch`, `package-release-rot`, `duplicate-implementation-candidate`, `dead-code-candidate`, `test-rot`, `architecture-drift`, `dependency-environment-rot`, `cross-platform-rot`, `security-validation-assumption-rot`.
- A security-validation audit adapter in `src/audits/security` implements the `security` audit type: it calls `runSecurityValidation()` directly, maps findings into audit issues, and preserves the original `reports/security/*.txt`/`*.json` report family. `security:validate` remains a separate, independently runnable, unmodified command.
- A stable, versioned audit report schema (`schemaVersion` `"1.0"`) with text and JSON renderers; `metadata.auditTypes` is included alongside `metadata.auditType`. `v0.3.1` added the `sourceFacts` summary field; `v0.3.2` adds `pythonProjectMetadata` and `securitySummary`, for 16 top-level report fields.
- Audit reports are written under `reports/audits/<type>/` by default (`code-rot-audit.txt`/`code-rot-audit.json`), or under `--out <path>` when supplied.
- Self and explicit local-project (non-destructive) audit targets.
- The audit framework does not shell out to `security:validate`; the security audit adapter reuses `securityValidation`'s exported functions directly, and `security:validate` does not call the audit framework.
- Java/Kotlin implementation: dependency-free Java and Kotlin source-facts analyzers, JVM project metadata collection (Gradle/Maven/wrapper/source-set presence only), Java/Kotlin detector integration for `dead-code-candidate`, `duplicate-implementation-candidate`, `test-rot`, and Java/Kotlin/Gradle/Maven docs-code-mismatch support.
- Cross-language stability hardening: mixed-language fixture corpus and invariant coverage, full-registry mixed-language detector stability tests, repeated-run audit report determinism tests, cross-platform/path normalization coverage, and CRLF/LF source parsing coverage.
- Android validation in `src/mobile/android`, reachable through `security:validate --profile android`: project detection and classification, manifest parsing, permission/exported-component/intent-filter/deep-link audits, static Gradle metadata, and eleven advanced internal checks (network security config, backup/release configuration, redacted secrets, signing configuration, WebView/FileProvider, sensitive storage/logging/clipboard, and Firebase/Google services), for nineteen default checks. Optional opt-in Gradle operations and external tools (Semgrep, OSV-Scanner, Android Lint, Dependency-Check) remain off by default with zero network access.
- Android-aware generic audit integration in `src/audits/security`: `npm run audit -- --types security --android` runs the same static Android validation through the existing security audit adapter, mapping confirmed findings into audit issues while keeping `CandidateEvidence` as a separate, review-only summary.
- `v0.4.3` stage-specific bounded-context and workflow-instruction evaluation is implemented and published: exact `ContextCapsule`/`RetrievalAuditRecord`/`WorkflowInstructionPacket` readers and selectors in `src/evaluation/upstreamArtifacts` and `src/evaluation/stageContextSelectors`; the `StageContextExpectationFixtureV1` contract in `src/evaluation/stageContextExpectations`; six new `context-strategy-comparison` strategies (`architecture-context-only`, `architecture-plus-implementation-refresh`, `architecture-plus-implementation-and-test-refresh`, `full-workflow-library`, `bounded-workflow-instruction-packet`, `combined-bounded-stage-context`) selected through programmatic configuration; evidence-centered metrics in `src/evaluation/stageContextMetrics`; read-only target immutability in `src/evaluation/targetImmutability`; repeated-run determinism in `src/evaluation/stageContextDeterminism`; and bounded `report.json`/`report.html`/`report.txt` output in `src/report/experiments`. See [ROADMAP.md](ROADMAP.md) for the complete scope, dependencies, and acceptance criteria.
- Implemented but unpublished compatibility work accepts my-dev-kit's additive major-1 audit repository identity, preserves absence in legacy audits, and extends existing pair diagnostics to detect repository-root and manifest-schema disagreement. No new CLI command or orchestrator-readiness implementation is added.
- `v0.4.4` producer-readiness bridge is released: exact readers for the frozen my-dev-kit-orchestrator supplemental implementation/test context packet and retrieval-report documents, and a bounded plain-object adapter for the orchestrator's readiness result (`src/evaluation/upstreamArtifacts`); deterministic owner, allocation, truncation-cause, supplemental/raw agreement, readiness-agreement, and criticality-overlay metrics (`src/evaluation/stageContextMetrics`); an additive producer-readiness bridge evaluator (`evaluateProducerReadinessBridge`) that composes those metrics over already-loaded evidence; additive optional producer-readiness expectations on `StageContextExpectationFixtureV1` (`src/evaluation/stageContextExpectations`); optional producer-readiness bridge inputs on the `combined-bounded-stage-context` strategy, loaded once per run and reported through the existing `report.json`/`report.txt`/`report.html` pipeline as an additive, optional section. Readiness remains a programmatic plain-object input only — the frozen orchestrator commit exposes no on-disk readiness artifact, and no readiness/producer-parity/owner-selection/allocation policy is duplicated. No public CLI flags were added.
- `v0.4.5` context-integrity validation is released: condition-aware producer evidence mirrored from the published `my-dev-kit` `v1.10.4` contract (`roleConditionCoverage`, allocation/spillover `GroupTruncationEntry` fields, `truncation.requiredEvidenceLost`) in `src/evaluation/upstreamArtifacts`; allocation, spillover, condition-coverage, and agreement metrics in `src/evaluation/stageContextMetrics`; run-integrity evidence mirrored from the published `my-dev-kit-orchestrator` `v1.2.3` contract (`RunIntegrityGateResult`, `JudgeIntegrityResult`, `FinalReportEligibilityResult`, plus `artifact-state.json` lifecycle records) and corresponding agreement calculators, composed additively through the existing `evaluateProducerReadinessBridge`; a frozen, hash-verified ecosystem regression fixture pair under `tests/fixtures/ecosystem/context-integrity/v0.4.5/` — a byte-exact real historical failed run and a hand-distilled corrected-replay counterpart representing the same validated `v1.10.4`/`v1.2.3` contracts, plus a 49-case negative matrix, hash verification, determinism, and fixture-immutability checks; and a bounded, additive `ContextIntegrityReportV1` JSON/text/HTML report layer in `src/report/experiments` that reuses the existing bounded-list/availability report primitives rather than duplicating them. The lab evaluates **agreement** between producer, readiness, judge, correction, eligibility, and lifecycle evidence — it does not reimplement or duplicate upstream policy, and it reports contradictions rather than resolving them. No CLI flags and no composite score, grade, ranking, or winner were added.
- `v0.4.6` installed-package architecture correction is **implemented but not yet published**: a `LabExecutionContext` runtime foundation (`src/runtime/`) with distinct `invocationCwd`/`packageRoot`/`workspaceRoot`/`resourceRoot` roots and cwd-independent package-root discovery and package-resource resolution; one compiled installed CLI router (`src/cli/`, bin `dist/scripts/cli.js`) exposing `--help`, `--version`, `security validate`, `audit`, the `experiment` family (`list`/`describe`/`run`/`controlled`), `report render`, `plots generate`, `gallery build`, and `demo final`, plus the historical direct final-demo invocation form for backward compatibility; shared `src/commands/` owners called by both the installed CLI and the existing `npm run` contributor scripts (no duplicated implementations); a global `--workspace` option defaulting to `<home>/.my-dev-kit-lab`, used for implicit audit/security output without redirecting explicit output paths or moving target/package roots; a permanent packed-tarball installation/execution acceptance gate (`npm run verify:packed-package`) that builds, packs, installs the exact tarball into a clean consumer, executes the installed binary, and verifies target/installed-package immutability and workspace output boundaries; removal of an eager `typescript` devDependency import from audit module initialization (now loaded lazily, only when a source file is actually analyzed) that the acceptance gate surfaced as a real installed-runtime defect; `engines.node` raised to `>=24`; GitHub Actions CI standardized on Node `24` and `latest` across Ubuntu/macOS/Windows, with the pre-release workflow tracking Node `latest`; and a reconciled npm package-content allowlist (see [ROADMAP.md](ROADMAP.md) for the full six-batch breakdown). No security check, audit detector, Android behavior, experiment scoring, report schema, or CLI syntax for any existing route changed.

## Current commands

The implemented command families cover experiments, reports and visualizations, generic audits, standalone security validation, Android validation, and repository verification. See [COMMANDS.md](COMMANDS.md) for exact syntax, flags, defaults, outputs, and exit behavior.

## Current architecture

The repository has one experiment runtime, one audit framework, one standalone security-validation framework, and one Android subsystem integrated through the existing security adapter. Shared reporting and presentation modules serve all four. See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership, flows, contracts, extension points, and failure boundaries.

## Experimental versus planned

`context-strategy-comparison` is implemented but its registry status is `experimental`. Real-agent campaigns are implemented but depend on locally configured provider CLIs and may produce partial outcomes.

The audit framework, language-aware code-rot detectors, security adapter, Android validation, and Android audit extension are implemented through v0.4.2. The Android extension maps confirmed findings, keeps `CandidateEvidence` separate, and includes bounded status, completeness, and report-reference summaries.

`v0.4.3` stage-specific bounded-context and workflow-instruction evaluation is implemented and published; see the `Implemented` section above. Within that implementation, CLI flags for selecting the six new strategies through `experiment:run` are **not implemented** — they are configured programmatically. Plots, screenshots, and gallery integration for the new stage-context evidence are likewise **not implemented**.

`v0.4.5` context-integrity validation is published; see the `Implemented` section above. It has no CLI flags (evaluation remains programmatic/test-driven, as with `v0.4.3`), no plots/screenshot/gallery integration, and no live full ten-stage replay — the corrected-replay fixture is a hand-distilled representation of the validated `v1.10.4`/`v1.2.3` contracts, not a byte-exact generated run.

`v0.4.6` installed-package architecture correction is implemented on the current branch but **not published**; see the `Implemented` section above. Within its implemented scope, none of the following were added: `security deps`/`package`/`codeql`/`semgrep`/fuzz-smoke routing, visualization-demo routing, warm-index reuse, a new security check, a new audit detector, or any new Android capability — all remain source-checkout-only or future-version scope. Do not treat the installed CLI routes documented in [COMMANDS.md](COMMANDS.md) as available until v0.4.6 is actually published.

The following remain planned, not implemented:

- the `quality` code-quality detector family and audit type
- project-wide default audit behavior combining multiple audit types (`project`/`all` audit types)
- cross-type issue deduplication or release-readiness aggregation across audit families
- JVM package/environment rot and Gradle/Maven dependency freshness checks
- framework-aware code-rot profiles after the language-aware track is stable
- manual pentest workflow after `v1.0.0` (post-v1 / version TBD)
- warm-index, freshness/staleness, context-window scaling, retrieval precision/recall, and agent-success experiment plugins (`v0.5.x` through `v0.8.x`)
- normalized telemetry, campaign scheduler, prompt hardening, and generalized publication portal

## Limitations

- The implemented security framework is automated CLI/package validation with adversarial checks; it is not a manual pentest framework.
- Profile behavior is currently limited to default check selection and scenario applicability filtering.
- Secret leakage and network/local-first checks are bounded automated checks, not exhaustive proofs.
- Package-boundary scenario severity is still result-level rather than per-evidence-item.
- Some security tools are optional and may be reported as skipped when unavailable.
- Fake-agent token totals are estimates. Provider telemetry differs by adapter and can be unavailable.
- Results are evidence for specific targets, tasks, agents, and configurations; they do not prove universal token savings.
- Only one experiment plugin is currently registered.
- The published upstream `ContextCapsule`/`RetrievalAuditRecord` artifacts that the implemented `v0.4.3` readers consume do not expose considered-but-unselected reads or unnecessary-read evidence; those metrics report `unavailable` with an explicit reason rather than zero.
- Estimated token counts in the `v0.4.3` context-size metric use `ceil(characterCount / 4)` per source and are heuristic, not provider telemetry.
- The `v0.4.5` corrected-replay fixture is a hand-distilled representation of the validated local `my-dev-kit` `v1.10.4` and `my-dev-kit-orchestrator` `v1.2.3` contracts for the same request, target, and active-index identity as the paired failed-run fixture. It is not a live capture of a complete ten-stage AI-authored implementation workflow, and it is not proof that every future run against these contracts will behave identically.
- The `v0.4.5` orchestrator agreement evidence does not read a literal upstream `promptMode` field; `stageMayRenderNormalPrompt`, derived from structured blocked-stage evidence, is the bounded substitute used throughout the metrics and reports.

## Validation state

`npm run typecheck`, `npm run build`, the focused `v0.4.3` test suites (`tests/evaluation/upstreamArtifacts`, `tests/evaluation/stageContextSelectors`, `tests/evaluation/stageContextExpectations`, `tests/evaluation/stageContextMetrics`, `tests/evaluation/targetImmutability`, `tests/evaluation/stageContextDeterminism`, `tests/experiments/contextStrategyComparison`, `tests/report/experiments`), `npm run test:evaluation`, and `npm run test:experiments` pass.

The full pre-release readiness suite (`npm run test`, `npm run verify`, `npm run docs:check`, cross-platform CI, `npm run security:validate`, and `npm run audit`) ran as a single combined gate against the `v0.4.3` release commit and passed before publication.

`v0.4.4` released after full validation: canonical `npm test` + `npm run verify` executed once each, docs:check, security:validate, code-rot audit (PASS_WITH_REVIEW_ITEMS, no blockers), report smoke (deterministic, zero mutation), package dry-run inventory clean, published-upstream compatibility confirmed with my-dev-kit@1.10.3 + orchestrator@1.2.2. All PR and main CI passed before merge/tag/publish.

`v0.4.5` completed individual pre-release readiness after clean installation, full and focused tests, fixture/Git-blob portability, determinism, immutability, report smoke and inspection, documentation, security, code-rot, package-content, and Windows/Linux/macOS × Node.js 22/24 CI validation. The corrected candidates then passed coordinated cross-repository validation, and the exact lab candidate passed published-upstream revalidation against the registry releases before release preparation.

`v0.4.6` (unpublished) local validation on Node 24, run at the end of each implementation batch and again after package/documentation reconciliation: `npm run typecheck`, `npm run verify` (build + benchmark verification), the full `npm run test` suite, and the real `npm run verify:packed-package` acceptance gate (build → actual `npm pack` → install the exact tarball into a clean temporary consumer → execute the installed binary against help/version/experiment/audit/security routes → verify default and explicit workspace output locations, target immutability, and installed-package immutability) all pass. GitHub Actions CI (Ubuntu/macOS/Windows × Node 24/latest) is configured for this branch; whether it has actually run against the latest push should be checked directly rather than assumed from this document.

## Blockers

Release blockers for published `v0.4.5`: none.

`v0.4.6` (unpublished) blockers: none known against the implemented scope. It has not undergone pre-release readiness, has not been tagged, and has not been published — those are upcoming workflow stages, not blockers.

## Next step

Run v0.4.6 pre-release readiness: full local validation on Node 24, GitHub Node 24/latest CI evidence, and release/package/documentation readiness gates, to determine whether the implementation is ready for release preparation (version bump, tagging, publication). Do not begin v0.5.0 implementation before v0.4.6 pre-release readiness and publication are complete.
