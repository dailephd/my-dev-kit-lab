# Current State

This file is the concise source of truth for the checked-in implementation. The current published npm baseline is `@dailephd/my-dev-kit-lab` `0.3.0`. `v0.3.0` added the generic audit framework and the first implemented code-rot detector family.

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
- Generic audit framework in `src/audits`, with `npm run audit` as the CLI entrypoint (`scripts/audits/runAudit.ts`). Only the `code-rot` audit type is implemented; `quality`, `security`, and `project` audit types are planned and fail cleanly (exit code 2) rather than running.
- 10 code-rot detector families are implemented and registered: `stale-command-reference`, `docs-code-mismatch`, `package-release-rot`, `duplicate-implementation-candidate`, `dead-code-candidate`, `test-rot`, `architecture-drift`, `dependency-environment-rot`, `cross-platform-rot`, `security-validation-assumption-rot`.
- A stable, versioned audit report schema (`schemaVersion` `"1.0"`) with text and JSON renderers; `metadata.auditTypes` is included alongside `metadata.auditType`. The release-prepared `v0.3.1` package state includes the `sourceFacts` summary field in addition to the `v0.3.0` top-level report fields.
- Audit reports are written under `reports/audits/code-rot/` by default, or under `--out <path>` when supplied.
- Self and explicit local-project (non-destructive) audit targets.
- The audit framework does not call `security:validate`, and `security:validate` does not call the audit framework; the two remain separate, independently runnable tools.

## Active branch status

`v0.3.1` is release-prepared in the checked-out package state but is not published. It adds normalized language/file-role inventory, a source facts model, source facts collection, a language analyzer registry, a TypeScript/JavaScript syntax analyzer, and source-facts-aware detector/report integration.

The TypeScript/JavaScript analyzer supports `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` files where files are within the analyzer size bound and parse without syntax diagnostics. Python, Java, and Kotlin are classified by inventory but remain fallback-only: no parser/analyzer is registered for them in `v0.3.1`.

The source-facts-aware code-rot behavior is conservative:

- `dead-code-candidate` merges parsed relative import/re-export basenames into reverse-reference checks.
- `duplicate-implementation-candidate` adds source-facts-derived duplicate exported declaration candidate signals for selected non-generic declaration kinds.
- `test-rot` uses analyzer-recorded relative imports, including dynamic `import()`, to find missing targets missed by regex-only scanning.

The implementation does not perform TypeScript Program semantic analysis, type checking, full module resolution, `tsconfig` path alias resolution, coverage analysis, clone detection, runtime reachability analysis, or target-file modification.

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

The generic audit framework and code-rot detector are implemented in the current published `v0.3.0` baseline. The checked-out package is release-prepared for the `v0.3.1` TypeScript/JavaScript language-aware code-rot substrate described above.

The following remain planned, not implemented:

- Python source-facts analyzer support in `v0.3.2`
- Java/Kotlin source-facts analyzer support in `v0.3.3`
- cross-language stability and fixture coverage in `v0.3.4`
- Android automated security validation in `v0.4.0` through optional `v0.4.2`
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

The current published npm baseline is `v0.3.0`. The checked-out package is release-prepared for `v0.3.1` language-aware code-rot substrate plus TypeScript/JavaScript support. Python, Java/Kotlin, and cross-language stability remain planned for `v0.3.2` through `v0.3.4`. Android automated security validation follows in `v0.4.0` through optional `v0.4.2`. See [ROADMAP.md](ROADMAP.md) for the complete sequence and [WORKFLOWS.md](WORKFLOWS.md) for implementation-completion workflow stages.
