# Current State

This document records the repository's operational state. It is the source of truth for what is implemented, planned, blocked, validated, and next.

## Version and publication state

- Package: `@dailephd/my-dev-kit-lab`
- Package version: `0.4.3`
- Latest release: `v0.4.3` published on npm, as a Git tag, and as a GitHub Release (previous release: `v0.4.2`)
- Next planned version: `v0.5.0`; planned, not implemented

See [CHANGELOG.md](../CHANGELOG.md) for release history and [ROADMAP.md](ROADMAP.md) for the complete future plan.

## Operational state

- Current branch: `main`
- Active planned version: `v0.5.0`; planned, not implemented
- Workflow stage: `v0.4.3` released; no active workflow stage in progress
- Release blockers: none; `v0.4.3` has completed the pre-release readiness, cross-platform, security, and code-rot workflow and is published
- Exact next action: begin `v0.5.0` (warm-index reuse) planning and implementation when prioritized

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

## Current commands

The implemented command families cover experiments, reports and visualizations, generic audits, standalone security validation, Android validation, and repository verification. See [COMMANDS.md](COMMANDS.md) for exact syntax, flags, defaults, outputs, and exit behavior.

## Current architecture

The repository has one experiment runtime, one audit framework, one standalone security-validation framework, and one Android subsystem integrated through the existing security adapter. Shared reporting and presentation modules serve all four. See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership, flows, contracts, extension points, and failure boundaries.

## Experimental versus planned

`context-strategy-comparison` is implemented but its registry status is `experimental`. Real-agent campaigns are implemented but depend on locally configured provider CLIs and may produce partial outcomes.

The audit framework, language-aware code-rot detectors, security adapter, Android validation, and Android audit extension are implemented through v0.4.2. The Android extension maps confirmed findings, keeps `CandidateEvidence` separate, and includes bounded status, completeness, and report-reference summaries.

`v0.4.3` stage-specific bounded-context and workflow-instruction evaluation is implemented and published; see the `Implemented` section above. Within that implementation, CLI flags for selecting the six new strategies through `experiment:run` are **not implemented** — they are configured programmatically. Plots, screenshots, and gallery integration for the new stage-context evidence are likewise **not implemented**.

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

## Validation state

`npm run typecheck`, `npm run build`, the focused `v0.4.3` test suites (`tests/evaluation/upstreamArtifacts`, `tests/evaluation/stageContextSelectors`, `tests/evaluation/stageContextExpectations`, `tests/evaluation/stageContextMetrics`, `tests/evaluation/targetImmutability`, `tests/evaluation/stageContextDeterminism`, `tests/experiments/contextStrategyComparison`, `tests/report/experiments`), `npm run test:evaluation`, and `npm run test:experiments` pass.

The full pre-release readiness suite (`npm run test`, `npm run verify`, `npm run docs:check`, cross-platform CI, `npm run security:validate`, and `npm run audit`) ran as a single combined gate against the `v0.4.3` release commit and passed before publication.

## Blockers

There are no documentation, factual, or implementation blockers for the released `v0.4.3` implementation.

## Next step

Begin `v0.5.0` (warm-index reuse) planning when prioritized. See [ROADMAP.md](ROADMAP.md) for `v0.5.0`'s dependencies and acceptance criteria.
