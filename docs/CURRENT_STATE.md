# Current State

This file is the concise source of truth for the checked-in implementation. The current published npm baseline is `@dailephd/my-dev-kit-lab` `0.3.3`. `v0.3.0` added the generic audit framework and the first implemented code-rot detector family; `v0.3.1` added the language-aware code-rot substrate and TypeScript/JavaScript analyzer support; `v0.3.2` added Python code-rot support and a first security-validation audit adapter; `v0.3.3` adds Java/Kotlin code-rot support. Package metadata is `0.3.3`, and the npm registry contains `0.3.3`.

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
- Published `v0.3.3` Java/Kotlin implementation: dependency-free Java and Kotlin source-facts analyzers, JVM project metadata collection (Gradle/Maven/wrapper/source-set presence only), Java/Kotlin detector integration for `dead-code-candidate`, `duplicate-implementation-candidate`, `test-rot`, and Java/Kotlin/Gradle/Maven docs-code-mismatch support.

## Active branch status

The current published npm baseline is `v0.3.3`. `v0.3.1` added normalized language/file-role inventory, a source facts model, source facts collection, a language analyzer registry, a TypeScript/JavaScript syntax analyzer, and source-facts-aware detector/report integration.

`v0.3.2` adds:

- a dependency-free Python source-facts analyzer (imports including relative dotted imports, `__all__`, module-level/class-body declarations)
- Python project metadata collection (`pyproject.toml`, `requirements.txt`, `setup.py`/`setup.cfg`, `tox.ini`, `pytest.ini` presence, best-effort project name, pytest-configuration flag)
- Python-aware signals in the `dead-code-candidate`, `duplicate-implementation-candidate`, and `test-rot` detectors
- the security-validation audit adapter (`--types security`, `--types code-rot,security`) described above

The published `v0.3.3` work adds:

- a dependency-free Java analyzer for `.java`
- a dependency-free Kotlin analyzer for `.kt` and `.kts`
- JVM project metadata collection for static Gradle/Maven/source-set/wrapper detection and a best-effort project name
- Java/Kotlin support in `dead-code-candidate`, `duplicate-implementation-candidate`, and `test-rot`
- Java/Kotlin symbol-claim support and static Gradle/Maven command/feature-claim support in `docs-code-mismatch`

The TypeScript/JavaScript analyzer supports `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` files where files are within the analyzer size bound and parse without syntax diagnostics. The Python analyzer is regex/line-based and dependency-free. The Java and Kotlin analyzers are also conservative and dependency-free: they use scanners/regex plus brace-depth tracking, not compiler parsing or symbol resolution.

The source-facts-aware code-rot behavior is conservative:

- `dead-code-candidate` merges parsed relative import/re-export basenames into reverse-reference checks (Python: cross-file `from module import name` reference checks).
- `duplicate-implementation-candidate` adds source-facts-derived duplicate exported declaration candidate signals for selected non-generic declaration kinds, grouped per-analyzer so TypeScript/JavaScript and Python candidates never merge into one group.
- `test-rot` uses analyzer-recorded relative imports, including dynamic `import()` (TypeScript/JavaScript) and dotted relative imports (Python), to find missing targets missed by regex-only scanning.
- `dead-code-candidate` adds Java/Kotlin declaration candidate checks only for top-level declarations with conservative JVM naming/lifecycle exclusions; it does not attempt method/constructor-level dead-code detection.
- `duplicate-implementation-candidate` keeps Java, Kotlin, Python, and TypeScript/JavaScript declaration groups analyzer-scoped rather than merging same-named declarations across languages.
- `test-rot` uses JVM import facts plus recognized `src/main/{java,kotlin}` and `src/test/{java,kotlin}` directories for best-effort Java/Kotlin missing-import checks, without compiler/classpath awareness.
- `docs-code-mismatch` now checks Java/Kotlin backtick-quoted FQCN-shaped symbol claims and static Gradle/Maven command/feature claims against scanned JVM metadata, while keeping Android validation as planned/out-of-scope.

The implementation does not perform TypeScript Program semantic analysis, type checking, full module resolution, `tsconfig` path alias resolution, coverage analysis, clone detection, runtime reachability analysis, Python runtime execution, Python dependency resolution, Java/Kotlin compiler parsing, Java/Kotlin type/classpath resolution, Gradle/Maven execution, target-project test execution, JVM dependency freshness checks, Android validation, or target-file modification.

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
| `src/audits` | Generic audit framework: target/config/registry/runner (`core`), code-rot detectors (`codeRot`), and report model/renderers (`report`) |
| `scripts/audits` | `runAudit.ts` — `npm run audit` entrypoint |
| `src/plots`, `src/screenshot`, `src/gallery`, `src/visualizationDemos` | Evidence presentation and demo output |

## Experimental versus planned

`context-strategy-comparison` is implemented but its registry status is `experimental`. Real-agent campaigns are implemented but depend on locally configured provider CLIs and may produce partial outcomes.

The generic audit framework, code-rot detector family, TypeScript/JavaScript, Python, Java, and Kotlin language-aware substrate, and the security-validation audit adapter are all implemented in the current published `v0.3.3` baseline.

The following remain planned, not implemented:

- the `quality` code-quality detector family and audit type
- project-wide default audit behavior combining multiple audit types (`project`/`all` audit types)
- cross-type issue deduplication or release-readiness aggregation across audit families
- cross-language stability and broader mixed-language fixture hardening in `v0.3.4`
- Android automated security validation in `v0.4.0` through `v0.4.1`, and an Android-specific extension of the security audit adapter in optional `v0.4.2`
- JVM package/environment rot and Gradle/Maven dependency freshness checks
- framework-aware code-rot profiles after the language-aware track is stable
- manual pentest workflow after `v1.0.0` (post-v1 / version TBD)
- warm-index, freshness/staleness, context-window scaling, retrieval precision/recall, and agent-success experiment plugins
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

## Next planned work

The current published npm baseline is `v0.3.3`, which added Java/Kotlin code-rot support on top of the previously published `v0.3.2` baseline (Python code-rot support and a first security-validation audit adapter). Cross-language stability follows in `v0.3.4`. Android automated security validation follows in `v0.4.0` through `v0.4.1`, with an Android-specific extension of the security audit adapter as optional `v0.4.2` work. See [ROADMAP.md](ROADMAP.md) for the complete sequence and [WORKFLOWS.md](WORKFLOWS.md) for implementation-completion workflow stages.
