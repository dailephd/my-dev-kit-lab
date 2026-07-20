# Current State

This document records the repository's operational state. It is the source of truth for what is implemented, planned, blocked, validated, and next.

## Version and publication state

- Package: `@dailephd/my-dev-kit-lab`
- Package version: `0.4.2`
- Latest release: verified external evidence identifies `v0.4.2` on npm, as a Git tag, and as a GitHub Release
- Next planned version: `v0.4.3`, unreleased and not implemented

See [CHANGELOG.md](../CHANGELOG.md) for release history and [ROADMAP.md](ROADMAP.md) for the complete future plan.

## Operational state

- Current branch: `docs/documentation-editorial-review`
- Active planned version: `v0.4.3`; implementation has not started
- Workflow stage: repository-wide documentation editorial review
- Release blockers: none for the already-published `v0.4.2`
- Exact next action: resolve or formally waive the out-of-scope Windows test-environment blocker, then review this pushed editorial branch through the normal pull-request process; begin v0.4.3 only under separate implementation authorization

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

## Current commands

The implemented command families cover experiments, reports and visualizations, generic audits, standalone security validation, Android validation, and repository verification. See [COMMANDS.md](COMMANDS.md) for exact syntax, flags, defaults, outputs, and exit behavior.

## Current architecture

The repository has one experiment runtime, one audit framework, one standalone security-validation framework, and one Android subsystem integrated through the existing security adapter. Shared reporting and presentation modules serve all four. See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership, flows, contracts, extension points, and failure boundaries.

## Experimental versus planned

`context-strategy-comparison` is implemented but its registry status is `experimental`. Real-agent campaigns are implemented but depend on locally configured provider CLIs and may produce partial outcomes.

The audit framework, language-aware code-rot detectors, security adapter, Android validation, and Android audit extension are implemented through v0.4.2. The Android extension maps confirmed findings, keeps `CandidateEvidence` separate, and includes bounded status, completeness, and report-reference summaries.

The following remain planned, not implemented:

- the `quality` code-quality detector family and audit type
- project-wide default audit behavior combining multiple audit types (`project`/`all` audit types)
- cross-type issue deduplication or release-readiness aggregation across audit families
- JVM package/environment rot and Gradle/Maven dependency freshness checks
- framework-aware code-rot profiles after the language-aware track is stable
- manual pentest workflow after `v1.0.0` (post-v1 / version TBD)
- `v0.4.3`: deterministic evaluation of stage-specific bounded repository context and workflow-instruction strategies (context-capsule/retrieval-audit/`WorkflowInstructionPacket` readers, an expanded strategy matrix, fixture-based evidence metrics, target immutability, and reports), extending the existing `context-strategy-comparison` plugin and depending on upstream `my-dev-kit` `1.10.1` and `my-dev-kit-orchestrator` `1.2.1` output contracts — see [ROADMAP.md](ROADMAP.md)
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

## Validation state

The forensic recovery baseline passed `docs:check`, the focused documentation regressions, typecheck, build, the complete test suite, `verify`, safe CLI discovery/help smokes, and the Node 26 GitHub Actions matrix on Ubuntu, macOS, and Windows.

On this editorial branch, `docs:check`, all 57 documentation-preservation regressions, typecheck, build, every dedicated `verify` test family, benchmark verification, and the safe CLI discovery/help smokes pass. The combined test command remains blocked on this Windows host by two environment-dependent Claude adapter assertions: after other test files run, `env: { PATH: "" }` does not hide an installed `claude.exe` because the process retains the case-distinct `Path` entry. The same five-test Claude adapter file passes when run in the dedicated agent suite. This branch does not alter the adapter or its tests because product behavior and non-documentation test fixes are outside the editorial scope.

## Blockers

There are no factual, release, or implementation blockers for this documentation-only editorial pass. Full-suite validation has the Windows `Path`/`PATH` blocker described above; resolving it requires a separate product/test change. Version v0.4.3 remains outside this branch's scope.

## Next step

Resolve or formally waive the Windows Claude adapter test-environment blocker, then review `docs/documentation-editorial-review` through the normal pull-request process. After the documentation work is reviewed and merged, v0.4.3 may begin only under separate implementation authorization. See [ROADMAP.md](ROADMAP.md) for its dependencies and acceptance criteria.
