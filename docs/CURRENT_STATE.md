# Current State

This file is the concise source of truth for the checked-in implementation. The current published npm baseline is `@dailephd/my-dev-kit-lab` `0.3.1`. `v0.3.0` added the generic audit framework and the first implemented code-rot detector family; `v0.3.1` added the language-aware code-rot substrate and TypeScript/JavaScript analyzer support. The checked-out package state is `v0.3.2` release-prepared (version-bumped, not published): Python code-rot support and a first security-validation audit adapter.

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
- A stable, versioned audit report schema (`schemaVersion` `"1.0"`) with text and JSON renderers; `metadata.auditTypes` is included alongside `metadata.auditType`. The published `v0.3.1` package state added the `sourceFacts` summary field; the checked-out `v0.3.2` release-prepared state adds `pythonProjectMetadata` and `securitySummary`, for 16 top-level report fields.
- Audit reports are written under `reports/audits/<type>/` by default (`code-rot-audit.txt`/`code-rot-audit.json`), or under `--out <path>` when supplied.
- Self and explicit local-project (non-destructive) audit targets.
- The audit framework does not shell out to `security:validate`; the security audit adapter reuses `securityValidation`'s exported functions directly, and `security:validate` does not call the audit framework.

## Active branch status

The current published npm baseline is `v0.3.1`. It added normalized language/file-role inventory, a source facts model, source facts collection, a language analyzer registry, a TypeScript/JavaScript syntax analyzer, and source-facts-aware detector/report integration.

The checked-out package state adds `v0.3.2` release-prepared work (version-bumped, not published):

- a dependency-free Python source-facts analyzer (imports including relative dotted imports, `__all__`, module-level/class-body declarations)
- Python project metadata collection (`pyproject.toml`, `requirements.txt`, `setup.py`/`setup.cfg`, `tox.ini`, `pytest.ini` presence, best-effort project name, pytest-configuration flag)
- Python-aware signals in the `dead-code-candidate`, `duplicate-implementation-candidate`, and `test-rot` detectors
- the security-validation audit adapter (`--types security`, `--types code-rot,security`) described above

The TypeScript/JavaScript analyzer supports `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` files where files are within the analyzer size bound and parse without syntax diagnostics. The Python analyzer is regex/line-based and dependency-free. Java and Kotlin are classified by inventory but remain fallback-only: no parser/analyzer is registered for them.

The source-facts-aware code-rot behavior is conservative:

- `dead-code-candidate` merges parsed relative import/re-export basenames into reverse-reference checks (Python: cross-file `from module import name` reference checks).
- `duplicate-implementation-candidate` adds source-facts-derived duplicate exported declaration candidate signals for selected non-generic declaration kinds, grouped per-analyzer so TypeScript/JavaScript and Python candidates never merge into one group.
- `test-rot` uses analyzer-recorded relative imports, including dynamic `import()` (TypeScript/JavaScript) and dotted relative imports (Python), to find missing targets missed by regex-only scanning.

The implementation does not perform TypeScript Program semantic analysis, type checking, full module resolution, `tsconfig` path alias resolution, coverage analysis, clone detection, runtime reachability analysis, Python runtime execution, Python dependency resolution, or target-file modification.

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

The generic audit framework, code-rot detector family, and TypeScript/JavaScript language-aware substrate are implemented in the current published `v0.3.1` baseline. The checked-out package state adds `v0.3.2` release-prepared work: Python code-rot support and the security-validation audit adapter described above.

The following remain planned, not implemented:

- the `quality` code-quality detector family and audit type
- project-wide default audit behavior combining multiple audit types (`project`/`all` audit types)
- cross-type issue deduplication or release-readiness aggregation across audit families
- Java/Kotlin source-facts analyzer support in `v0.3.3`
- cross-language stability and fixture coverage in `v0.3.4`
- Android automated security validation in `v0.4.0` through `v0.4.1`, and an Android-specific extension of the security audit adapter in optional `v0.4.2`
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

The current published npm baseline is `v0.3.1`. The checked-out package state is `v0.3.2` release-prepared: Python code-rot support and a first security-validation audit adapter. Java/Kotlin and cross-language stability remain planned for `v0.3.3` through `v0.3.4`. Android automated security validation follows in `v0.4.0` through `v0.4.1`, with an Android-specific extension of the security audit adapter as optional `v0.4.2` work. See [ROADMAP.md](ROADMAP.md) for the complete sequence and [WORKFLOWS.md](WORKFLOWS.md) for implementation-completion workflow stages.
