# Changelog

All notable changes to my-dev-kit-lab are documented here.

## [0.3.1] - Unreleased

Language-aware code-rot substrate plus TypeScript/JavaScript support. This version is implemented on the active branch but is not published.

### Added

- Added normalized language and file-role metadata to the audit inventory scanner, including `filesByLanguage` and `filesByRole` report summaries.
- Added the source facts model, source facts collector, language analyzer registry, and fallback behavior for eligible source/test files without a registered analyzer.
- Added the syntax-only TypeScript/JavaScript analyzer for `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` files.
- Added source-facts-aware code-rot signals:
  - `dead-code-candidate` merges parsed relative import/re-export basenames into reverse-reference checks.
  - `duplicate-implementation-candidate` adds source-facts-derived duplicate exported declaration candidate signals.
  - `test-rot` uses analyzer-recorded relative imports, including dynamic `import()`, to find missing targets missed by regex-only scanning.
- Added source-facts summaries to JSON and text audit reports. JSON reports include top-level `sourceFacts`; text reports include a `Source facts` section.
- Added end-to-end and focused tests for source facts collection, TypeScript/JavaScript analyzer behavior, detector integration, report model/rendering, and the real audit registry path.

### Fixed

- Fixed `.mts` and `.cts` source-role eligibility for source-facts collection.
- Fixed audit text rendering so an evidence entry with both `message` and `excerpt` renders both.

### Compatibility and limitations

- No audit command flags were added or changed.
- Audit issue shape remains unchanged.
- Python, Java, and Kotlin remain fallback-only in `v0.3.1`; no parser/analyzer is registered for them.
- TypeScript/JavaScript analysis is syntax-only and single-file. It does not perform TypeScript Program semantic analysis, type checking, full module resolution, `tsconfig` path alias resolution, coverage analysis, clone detection, runtime reachability analysis, or target-file modification.
- Audit findings remain heuristic and conservative; they are candidates for review, not proof of a defect.

## [0.3.0] - Published

Generic audit framework and code-rot detector. `v0.3.0` is the current published baseline.

### Added

- Added `npm run audit` command (`scripts/audits/runAudit.ts`) as the audit framework CLI entrypoint.
- Added the generic audit framework in `src/audits`: target resolution, config/flag parsing (`--target`, `--types`, `--include`, `--format`, `--fail-on`, `--out`), detector registry, and exit-code policy (`0`/`1`/`2`).
- Added a project inventory scanner and a source-of-truth collector so detectors read pre-collected, consistent project state instead of re-scanning.
- Added the code-rot detector family: `stale-command-reference`, `docs-code-mismatch`, `package-release-rot`, `duplicate-implementation-candidate`, `dead-code-candidate`, `test-rot`, `architecture-drift`, `dependency-environment-rot`, `cross-platform-rot`, `security-validation-assumption-rot` (10 detectors).
- Added a stable, versioned audit report schema (`schemaVersion` `"1.0"`, 13 top-level fields) with text and JSON renderers and a sanitized text-report writer.
- Added fail-on severity policy (`blocker`, `high`, `medium`, `low`, `none`) shared between the runner and the report model.
- Added external-target-safe report writing: audits against a local target project do not modify target files; generated reports stay under the tool root's `reports/audits/` unless `--out` redirects them.
- Added integration hardening and regression test coverage under `tests/audits/` and `tests/audits/codeRot/` (CLI options, target resolution, inventory, source-of-truth, detectors, report schema/writer, fail-on behavior, external targets, self-audit smoke, detector-error hardening).
- Kept the audit framework and `security:validate` independent: `npm run audit` does not call `security:validate`, and `security:validate` does not call the audit framework.
- Validated cross-platform behavior on the latest Node.js LTS-adjacent release (v26.4.0) across Windows, Linux, and macOS.

### Fixed

- Fixed a test flake in `securityProfileSelectionIntegration.test.ts`.
- Fixed a cross-platform bug in `resolveCommand` (`src/core`): the POSIX branch never checked `PATH` for a matching executable, so `security:validate` could falsely report a blocker on Linux/macOS when optional static-analysis tools (e.g. Semgrep) were absent from expected locations but present on `PATH`.

### Limitations

- Only the `code-rot` audit type is implemented. `quality`, `security`, `project`, and `all` audit types are recognized as valid `--types` identifiers but are rejected with a clear message and exit code `2` rather than running.
- Audit findings are heuristic and conservative; they are candidates for review, not proof of a defect.

## [0.2.2] - 2026-07-07

### Added

- Implemented the `v0.2.2` automated security-validation fortification work; version bumped and release-preparation validation completed.
- Added `security:validate` support for `--checks`, `--profile`, `--format`, `--fail-on`, and `--out` while preserving backward-compatible no-flag and `--target` behavior.
- Added the attack-scenario framework, reusable security profiles, payload/evidence models, and concrete boundary, subprocess, secrets, and network scenarios.
- Added fail-on threshold behavior, profile-aware default check selection, scoped-run reporting, and verdict-reason summaries.
- Added metadata-driven `verdictImpact` categorization and `reportSchemaGuard` baseline-diff structural-injection protection.
- Added schema/report hardening, text-report sanitization regression coverage, and output format/location consistency validation.

### Fixed

- Fixed a cross-platform bug in the path-traversal attack scenario where a backslash-style traversal payload was incorrectly expected to be rejected on POSIX platforms (Linux/macOS), where `\` is a literal filename character rather than a path separator. Verified via the project's own CI matrix (ubuntu-latest/macos-latest/windows-latest x Node 20/22).

### Documentation

- Synchronized current-state, architecture, command, security-validation, and project-overview documentation with the `v0.2.2` implementation and package version.
- Replaced the stale roadmap with a semantically ordered plan from v0.2.1 through v1.4.0, placing stable v1.0.0 after all prerequisite v0.x work.
- Clarified that automated security validation is implemented, while the generic audit framework, code rot and quality detectors, unified audits, and manual pentest framework are planned.

## [0.2.1] - 2026-06-25

Target-aware security-validation correction.

### Fixed

- Corrected external-target `test:security` execution so it runs in the selected target project, including installed-package validation paths.

## [0.2.0] - 2026-06-23

Generic experiment-plugin foundation, first plugin conversion, target-aware execution, plugin-aware reports, and user-facing command surface.

### Added

- Added generic experiment plugin contracts, registry, execution context, target model, config validation result, and normalized result model.
- Added shared local target metadata resolution used by both experiment targets and security validation targets.
- Added `context-strategy-comparison` as the first registered experiment plugin for the existing raw-full-file vs my-dev-kit-guided workflow.
- Added plugin result metadata output at `experiment-plugin-result.json` while preserving the existing `experiment-summary.json`, `experiment-runs.json`, and `experiment-comparisons.json` artifacts.
- Added target-aware experiment execution for explicit local projects via `experiment:run -- --target <path>`.
- Added plugin-aware JSON and HTML reports with plugin, target, variant, case, metric, artifact, warning, skip, and failure metadata.
- Added `experiment:list`.
- Added `experiment:describe`.
- Added `experiment:run`.
- Documented `context-strategy-comparison` as the first experiment plugin.

### Changed

- Routed the existing controlled experiment command wrapper through the `context-strategy-comparison` plugin without changing the public command arguments or legacy artifact behavior.
- Preserved existing raw-vs-indexed workflow behavior through the plugin runner and kept old controlled-experiment commands available.

### Validation

- `npm install`
- `npm run build`
- `npm run test`
- `npm run verify`
- `npm run security:deps`
- `npm run security:package`
- `npm run security:codeql`
- `npm run security:semgrep`
- `npm run test:security`
- `npm run test:fuzz:smoke`
- `npm run security:validate`
- `npm run security:validate -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"`
- `npm run security:validate -- --target "Z:\Users\newuser\Projects\scientific-literature-explorer-v1"`
- `npm run experiment:list`
- `npm run experiment:describe -- --experiment context-strategy-comparison`
- `npm run experiment:describe -- --experiment does-not-exist`
- `npm run experiment:run -- --experiment context-strategy-comparison --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --case todo-ts-create-task --agents fake-agent --complexities short --no-screenshot`
- `npm run experiment:run -- --experiment context-strategy-comparison --target "Z:\Users\newuser\Projects\scientific-literature-explorer-v1" --case todo-ts-create-task --agents fake-agent --complexities short --no-screenshot`
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --out lab-output/legacy-v0.2.0-smoke --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot`
- `npm pack --dry-run`

## [0.1.4] - 2026-06-22

Final security-validation gate with reusable multi-project target support.

### Added (reusable target support)

- Added `--target <path>` option to `security:validate`, `security:deps`, `security:package`, `security:semgrep`, and `security:codeql` to validate any local project, not just my-dev-kit-lab itself.
- Added `SecurityValidationTarget` type separating the validation target from the tool root (my-dev-kit-lab).
- Added `resolveValidationTarget(targetPath?, toolRoot)` — validates target path, reads package.json/lockfile/git metadata gracefully; returns null fields on missing metadata rather than crashing.
- Added `reportFilenamePrefix(target)` — generates collision-free filename prefixes: `v0.1.4` for self, `my-dev-kit-v1.2.0` for scoped packages, `biolit-v1` for name-only packages, directory basename for projects with no package.json.
- Added `targetDescription(target)` — human-readable label for report headers.
- Added `isSelf` flag for backward-compatible self-validation when no `--target` is given.
- Added `--out <dir>` option to control report output directory (default: `reports/security/`).
- Added `--report-prefix <name>` option to override the generated filename prefix.
- Report headers now distinguish self-validation (`Package: ...`) from external target validation (`Tool: ..., Target: ...`).
- CLI adversarial tests and fuzz smoke always run against the tool root and are labeled clearly as "tool self-tests, not target-specific."
- Added 23 new unit tests for target resolution in `tests/security/securityValidationTarget.test.ts`.
- Exported `resolveValidationTarget`, `reportFilenamePrefix`, `targetDescription`, `SecurityValidationTarget` from `src/securityValidation/index.ts`.

### Added (security-validation gate)

- Added static scan integration for CodeQL and Semgrep.

### Added

- Added static scan integration for CodeQL and Semgrep.
  - CodeQL: local CLI availability check; full analysis delegates to GitHub Actions.
  - Semgrep: local or npx fallback; `.semgrep.yml` covers subprocess safety, path traversal, unsafe fs.rm, and secret leakage.
  - Both scanners return structured `skipped` results when unavailable — never crash.
- Added bounded fuzz smoke tests (`test:fuzz:smoke`) for 9 security-sensitive parsers and helpers.
  - Seeded PRNG (`0xDEADBEEF`) for deterministic CI reproduction.
  - Completes in under 1 second at default settings (50 iterations per target).
- Added `security:validate` release-gate command that orchestrates all checks and produces a verdict.
- Added text and JSON security-validation report generation to `reports/security/<prefix>-security-validation.{txt,json}`.
- Added release verdict calculation from normalized check results (four verdict categories).
- Added documentation for mandatory checks, optional scanner availability, findings, skipped checks, and release verdicts in `docs/COMMANDS.md`.
- Fixed defensive null guard in `parseNpmOutdated` when JSON value entries contain null.

### Validation

- `npm run build`
- `npm run test` (407 tests, 88 files)
- `npm run verify`
- `npm run security:deps`
- `npm run security:package`
- `npm run security:codeql`
- `npm run security:semgrep`
- `npm run test:security` (165 tests, 12 files)
- `npm run test:fuzz:smoke` (9 targets, 450 iterations)
- `npm run security:validate` (verdict: ready except optional manual checks)
- `npm pack --dry-run`

### Notes

- CodeQL, Semgrep, and OSV-Scanner may be skipped locally if unavailable. Absence is reported as `ready except optional manual checks`, not a blocker.
- Generated security reports are not committed by default (`.gitignore` excludes `reports/security/` outputs).
- This release completes the initial security-validation release-gate track.

## [0.1.2] - 2026-06-22

Security validation foundation and package checks.

### Added

- added security-validation planning and framework documentation for the staged release-security track
- added security validation core types, configuration, command runner, and test matrix scaffolding
- added dependency validation command support through `security:deps`
- added package-content validation command support through `security:package`
- added initial security unit test coverage through `test:security`
- added Windows-safe npm command resolution support used by the security scripts
- added parsers and runners for `npm audit`, `npm audit --omit=dev`, `npm ls --all`, `npm outdated`, and optional OSV-Scanner execution
- added forbidden package-content detection and structured `npm pack --dry-run` parsing

### Validation

- `npm run build`
- `npm run test`
- `npm run verify`
- `npm run security:deps`
- `npm run security:package`
- `npm pack --dry-run`

### Limitations

- full CLI adversarial harness is planned next
- malformed artifact, JSON stdout/stderr, and Graphviz safety tests are not complete yet
- CodeQL and Semgrep integration is planned
- fuzz smoke tests are planned
- `security:validate` and final release security report generation are planned

## [0.1.1] - 2026-06-22

Public release hygiene and cross-platform assurance patch.

### Changed

- cleaned package metadata for the public npm release, including repository, funding, keyword, engine, and bin metadata
- restricted published package contents to runtime assets and the deterministic fake my-dev-kit fixture used by local demos
- improved cross-platform command parsing and Windows `.cmd` shim execution, especially for commands and script paths that contain spaces
- added cross-platform CI coverage for `windows-latest`, `macos-latest`, and `ubuntu-latest`
- updated quickstart and workflow docs with PowerShell guidance and clearer notes about current baseline capabilities versus future roadmap items

### Validation

- `npm run build`
- `npm run test`
- `npm run verify`
- `npm pack --dry-run`

### Notes

- this patch does not add the full security-validation framework
- generic experiment-plugin architecture remains planned for a later release

## [0.1.0] - 2026-06-16

### Initial public baseline

**Experiment pipeline**
- Raw-vs-indexed context experiment: compares `raw-full-file` and `my-dev-kit-guided` strategies across benchmark cases
- Controlled experiment runner with paired run comparison by case, project, agent, and prompt complexity
- Deterministic correctness scoring from benchmark answer keys (not semantic LLM judging)
- Token usage, duration, and status comparisons between matched strategy pairs

**Benchmark projects**
- `todo-ts`, `todo-js`, `todo-python`, `todo-mixed-ts-py` — small baseline projects
- `task-workflow-medium-ts` — medium TypeScript project
- `task-analytics-large-mixed` — large mixed TypeScript/Python project
- Project complexity metrics: file count, lines of code, language count, import count, exported symbol estimate, complexity score (0–100 weighted)

**Agent adapters**
- Fake-agent adapter for deterministic smoke and demo validation (no external CLI required)
- Codex adapter for real-agent campaigns (requires local Codex CLI and usage capacity)
- Claude adapter for real-agent campaigns (requires local Claude CLI; token totals not exposed)
- Windows-safe CLI command resolution

**Report, plot, screenshot, and gallery pipeline**
- HTML experiment report rendering with project profile, strategy comparisons, correctness, token savings, and warnings
- Static SVG plot generation
- Optional PNG screenshot capture via headless browser
- Gallery manifest and static gallery index output

**Documentation**
- Full user-facing documentation: README, PROJECT_OVERVIEW, ARCHITECTURE, WORKFLOWS, COMMANDS, TUTORIAL, METRICS, ROADMAP, GALLERY, CURRENT_STATE
- Metric glossary (docs/METRICS.md)
- Real-agent campaign report and final batch handoff notes

### Known limitations

- Token savings in fake-agent runs are estimated from character counts, not provider billing telemetry
- Claude does not expose token totals; token savings comparisons are unavailable for Claude runs
- Codex runs may produce timeouts, invalid output, or hit session limits
- Small projects may show negative token savings because raw-full-file is cheaper when the entire project fits in context
- Current baseline does not yet prove every future value claim; stronger evidence requires future experiment types

### Roadmap at release time

At v0.1.0 the generic experiment-plugin framework was planned. It was subsequently implemented in v0.2.0 with `context-strategy-comparison` as the first plugin. Later planned plugins cover warm-index reuse, incremental-change staleness, context-window scaling, retrieval precision/recall, and agent-success-rate experiments.
