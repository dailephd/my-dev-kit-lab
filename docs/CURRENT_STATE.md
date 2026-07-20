# Current State

This file is the concise source of truth for the checked-in implementation. The working-tree package version is `@dailephd/my-dev-kit-lab` `0.4.2`. `v0.4.2` (Android-aware extension of the security audit adapter) is the latest npm-published version and the current baseline. `v0.4.3` (deterministic evaluation of stage-specific bounded repository context and workflow-instruction strategies) is planned but not implemented; see [ROADMAP.md](ROADMAP.md) for the full plan. See [CHANGELOG.md](../CHANGELOG.md) for the complete release history.

## Operational state

- Recovery branch: `fix/documentation-plan-restoration`
- Active planned version: `v0.4.3`; implementation has not started
- Workflow stage: documentation-history recovery, reconciliation, and preservation hardening
- Release blockers: none for the already-published `v0.4.2`; this documentation recovery must pass repository validation before merge
- Validation state: `docs:check`, focused documentation regressions, typecheck, build, the complete test suite, `verify`, and safe CLI help/discovery smokes pass on this recovery branch
- Exact next action: merge the documentation-recovery pull request after required checks pass, then begin `v0.4.3` only under separate implementation authorization

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

## Language and analyzer notes

Normalized language/file-role inventory, a source facts model, source facts collection, and a language analyzer registry back the code-rot detectors across languages:

- The TypeScript/JavaScript analyzer supports `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` files where files are within the analyzer size bound and parse without syntax diagnostics.
- The Python analyzer is regex/line-based and dependency-free, covering imports (including relative dotted imports), `__all__`, and module-level/class-body declarations, plus project metadata detection (`pyproject.toml`, `requirements.txt`, `setup.py`/`setup.cfg`, `tox.ini`, `pytest.ini`).
- The Java analyzer (`.java`) and Kotlin analyzer (`.kt`, `.kts`) are conservative and dependency-free: they use scanners/regex plus brace-depth tracking, not compiler parsing or symbol resolution, alongside JVM project metadata collection for static Gradle/Maven/source-set/wrapper detection.

The source-facts-aware code-rot behavior is conservative:

- `dead-code-candidate` merges parsed relative import/re-export basenames into reverse-reference checks (Python: cross-file `from module import name` reference checks).
- `duplicate-implementation-candidate` adds source-facts-derived duplicate exported declaration candidate signals for selected non-generic declaration kinds, grouped per-analyzer so TypeScript/JavaScript and Python candidates never merge into one group.
- `test-rot` uses analyzer-recorded relative imports, including dynamic `import()` (TypeScript/JavaScript) and dotted relative imports (Python), to find missing targets missed by regex-only scanning.
- `dead-code-candidate` adds Java/Kotlin declaration candidate checks only for top-level declarations with conservative JVM naming/lifecycle exclusions; it does not attempt method/constructor-level dead-code detection.
- `duplicate-implementation-candidate` keeps Java, Kotlin, Python, and TypeScript/JavaScript declaration groups analyzer-scoped rather than merging same-named declarations across languages.
- `test-rot` uses JVM import facts plus recognized `src/main/{java,kotlin}` and `src/test/{java,kotlin}` directories for best-effort Java/Kotlin missing-import checks, without compiler/classpath awareness.
- `docs-code-mismatch` checks Java/Kotlin backtick-quoted FQCN-shaped symbol claims and static Gradle/Maven command/feature claims against scanned JVM metadata. Android validation is implemented separately under `src/mobile/android`; it is not part of this code-rot detector.

The language-aware code-rot analyzers do not perform TypeScript Program semantic analysis, type checking, full module resolution, `tsconfig` path alias resolution, coverage analysis, clone detection, runtime reachability analysis, Python runtime execution, Python dependency resolution, Java/Kotlin compiler parsing, Java/Kotlin type/classpath resolution, Gradle/Maven execution, target-project test execution, or JVM dependency freshness checks. Android validation is a separate implemented static subsystem. No default audit or validation path modifies target source files.

## Current commands

```powershell
npm run experiment:list
npm run experiment:describe -- --experiment context-strategy-comparison
npm run experiment:run -- --experiment context-strategy-comparison --target <path>
npm run security:validate
npm run security:validate -- --target <path>
npm run security:validate -- --checks boundary,subprocess,secrets,network --format text,json
npm run security:validate -- --profile local-tool --format json
npm run audit -- --target <path> --types code-rot
npm run audit -- --types code-rot --format text,json --fail-on none
npm run audit -- --types security --format text,json --fail-on none
npm run audit -- --target <path> --types security --format text,json --fail-on none
npm run audit -- --types code-rot,security --format text,json --fail-on none
npm run security:validate -- --target <android-project-path> --profile android
npm run audit -- --target <android-project-path> --types security --android --format text,json --fail-on none
```

`npm run run-controlled-experiment` and the demo/report/plot/gallery commands remain supported. See [COMMANDS.md](COMMANDS.md) for the complete package-script inventory.

## Current architecture

| Path | Responsibility |
|---|---|
| `src/core` | Shared process, path, token, and local-target utilities |
| `src/experiments` | Plugin contracts, registry, runner, targets, configuration, and results |
| `src/experiments/plugins/contextStrategyComparison` | Current raw-versus-guided experiment plugin |
| `scripts/experiments` | User-facing experiment command entrypoints |
| `src/evaluation` | Benchmark contracts, controlled runs, metrics, and correctness |
| `src/agents` | Fake-agent, Codex, and Claude adapters |
| `src/report` | Shared and legacy report infrastructure |
| `src/report/experiments` | Plugin-aware experiment reports |
| `src/securityValidation` | Automated security-validation checks, orchestration, and reports |
| `scripts/security` | Security command entrypoints |
| `src/audits` | Generic audit framework: target/config/registry/runner (`core`), code-rot detectors (`codeRot`), security audit adapter and Android integration (`security`), and report model/renderers (`report`) |
| `scripts/audits` | `runAudit.ts` — `npm run audit` entrypoint |
| `src/mobile/android` | Android detection, manifest parsing, static Gradle metadata, and advanced security checks |
| `src/plots`, `src/screenshot`, `src/gallery`, `src/visualizationDemos` | Evidence presentation and demo output |

## Experimental versus planned

`context-strategy-comparison` is implemented but its registry status is `experimental`. Real-agent campaigns are implemented but depend on locally configured provider CLIs and may produce partial outcomes.

The generic audit framework, code-rot detector family, TypeScript/JavaScript/Python/Java/Kotlin language-aware substrate, the security-validation audit adapter, Android validation, and the Android-aware extension of that adapter (`audit --types security --android`, confirmed-finding mapping, Android status/completeness and CandidateEvidence summaries, and text/JSON report references) are all implemented, merged, and published in releases through `v0.4.2`.

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

## Next step

`v0.4.2` (Android-aware extension of the security audit adapter) is published and is the current npm baseline. The next planned patch is `v0.4.3` (deterministic evaluation of stage-specific bounded repository context and workflow-instruction strategies), which depends on upstream `my-dev-kit` `1.10.1` and `my-dev-kit-orchestrator` `1.2.1` output contracts and has not been implemented. See [ROADMAP.md](ROADMAP.md) for the complete version sequence and [WORKFLOWS.md](WORKFLOWS.md) for workflow stages.
