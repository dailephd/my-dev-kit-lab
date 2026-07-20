# Changelog

All notable changes to my-dev-kit-lab are documented here.

## [Unreleased]

No implementation changes are recorded. `v0.4.3` remains planned and not implemented; its complete scope, dependencies, exclusions, and acceptance criteria are preserved in [docs/ROADMAP.md](docs/ROADMAP.md).

## [0.4.2] - 2026-07-12

Extended the existing general security audit adapter with Android-aware validation. This is the latest release.

### Added

- Extended the existing general security audit adapter with an explicit `--android` opt-in when `--types` includes `security`, and added `--help`/`-h` to the `audit` CLI.
- Added direct programmatic Android validation reusing the existing `SecurityFinding`-to-`AuditIssue` mapping, with Android requested/applicable/status/verdict summaries, confirmed-finding and mapped-issue counts, and separate `CandidateEvidence` summaries that are never mapped to a confirmed `AuditIssue`.
- Added contained Android text/JSON report references and a bounded Android section in both the generic audit text report and the generic audit JSON report (a 17th top-level `androidSecurity` field), with text/JSON parity.
- Isolated Android validator failures from the rest of the audit run: a thrown Android error is captured as a bounded, stack-trace-free failure status without discarding already-collected non-Android issues.
- Preserved deterministic issue ordering and aggregation: non-Android issues are ordered first, Android issues follow in check/finding order, and repeated runs against unchanged fixtures produce identical issue IDs, order, and summary counts.
- Preserved standalone `security:validate` as the authoritative source of complete Android validation evidence; the audit adapter only reuses and links to it.
- Added a required `Check documentation consistency` (`npm run docs:check`) step to both the pre-release Node 26 readiness workflow and ordinary CI, running on every operating system in the existing Windows/macOS/Linux matrix, so documentation/roadmap consistency is verified cross-platform before broader validation.

### Compatibility and limitations

- The default audit path starts no Android validation. The opted-in Android path remains static and starts zero Gradle, external-tool, and network processes by default.
- Manual pentest, runtime/device analysis, APK/AAB inspection, signing verification, and automatic fixes remain out of scope.

## [0.4.1] - 2026-07-12

Added advanced Android security validation on top of v0.4.0. At publication, v0.4.1 superseded v0.4.0.

### Added

- Added the advanced Android rule/evidence substrate and eleven internal advanced check families: Network Security Config and cleartext traffic review, backup and data-extraction-rules review, debuggable and release configuration review, redacted hardcoded-secret detection, signing-configuration leak review, WebView and FileProvider analysis, sensitive storage/logging/clipboard analysis, and Firebase and Google services configuration and local rules review.
- Added opt-in Semgrep, OSV-Scanner, Android Lint, and OWASP Dependency-Check evidence with closed tool IDs, bounded artifacts, and default network denial.
- Activated nineteen default Android checks (eight `v0.4.0` checks plus eleven `v0.4.1` advanced internal checks) and added explicit `--android-external-tools` and `--android-external-network` CLI options.
- Added CandidateEvidence presentation plus advanced-security, external-tool, artifact, and candidate summaries to both text and JSON reports, with text/JSON parity.

### Compatibility and limitations

- Default Android validation starts zero Gradle operations, zero external-tool processes, and zero network operations.
- Advanced checks remain static-analysis-based and conservative: no APK/AAB inspection, no signing verification, no emulator/device validation, and no Play compliance or manual penetration testing.
- Optional Semgrep/OSV-Scanner/Android Lint/Dependency-Check evidence depends on external tool availability; missing tools are skipped, not treated as failures.
- Android AuditIssue mapping remains future `v0.4.2` work.

## [0.4.0] - 2026-07-11

Android/mobile validation MVP published as `v0.4.0`.

### Added

- Added the Android/mobile validation substrate and the canonical `security:validate --profile android` path.
- Added Android project detection and classification (application, library, multi-module, mixed, partial, and non-Android targets) and Compose/XML/mixed/uncertain UI-toolkit classification.
- Added independent `AndroidManifest.xml` parsing across modules, with permission, exported-component, intent-filter, and deep-link audit families producing conservative `SecurityFinding` evidence.
- Added static Gradle wrapper and module metadata extraction: namespace, applicationId, versionCode/versionName, minSdk/targetSdk/compileSdk, build-type/source-set metadata, Android Gradle Plugin/Kotlin Android/Compose evidence, and version-catalog evidence.
- Added an explicitly opt-in, five-operation allowlisted Gradle validation path (`--android-gradle-operations wrapper-version,tasks,assemble-debug,unit-test-debug,lint-debug`) that never executes arbitrary Gradle tasks and is disabled by default.
- Added Android text and JSON reports under the existing `reports/security/` root, an Android verdict policy, release-metadata summaries, Play-readiness checklist placeholders, and target-mutation evidence.
- Added `security:validate --help` / `-h` no-work help handling and unknown top-level option rejection.

### Compatibility and limitations

- `v0.4.0` preserves the existing `security:validate` command surface and report root; it adds the `android` profile and `--android-gradle-operations` option without changing any other profile's behavior.
- Android manifests are parsed independently and are not merged; selected local references are resolved conservatively while full overlays are not; Gradle files are parsed statically and are not evaluated; dynamic Gradle values may remain unresolved.
- `v0.4.0` does not inspect APK/AAB contents, validate signing, run emulators/devices, verify Digital Asset Links or domain ownership, check live Google Play policy, upload applications, or provide automatic fixes.
- `v0.4.1` advanced Android checks and `v0.4.2` Android audit-adapter mapping remain planned and out of scope. Manual pentest remains a deferred, post-v1 / version-TBD workflow, not assigned to v0.4.x.

## [0.3.4] - 2026-07-10

Published package version 0.3.4, superseding v0.3.3.

### Added

- Added mixed-language audit stability coverage across the committed Batch 1 fixture corpus and full detector registry.
- Added repeated-run audit report determinism coverage for JSON/text output, security-summary isolation, and run-order stability.
- Added focused cross-platform/path and CRLF/LF stability coverage in `tests/audits/crossPlatformPathStability.test.ts`, including separator normalization, paths with spaces, report output safety, security report filename-prefix sanitization, and Java/Kotlin/docs-code-mismatch line-ending robustness.

### Changed

- Hardened `collectSourceFacts()` to normalize inventory `relativePath` values before reading files or returning source-fact identities, so separator-only path variants do not leak into analyzer inputs, report evidence, or downstream lookups.
- Reconciled README/current-state/roadmap/architecture/commands/workflows/project-overview/security docs with the published `v0.3.4` state, with `v0.3.3` documented as the previous published baseline.

### Compatibility and limitations

- `v0.3.4` preserves the existing command surface: it does not change audit/security command names, add new CLI commands, or modify the audit report schema or `SourceFacts` schema.
- `v0.3.4` keeps `quality`, `project`, and `all` audit types planned and not implemented.
- `v0.3.4` keeps Android validation, Gradle/Maven execution, Java/Kotlin compiler execution, JVM dependency freshness checks, and JVM package/environment rot detection out of scope.

## [0.3.3] - 2026-07-10

Java/Kotlin code-rot support, published on top of the previously published `v0.3.2` baseline. Package metadata is `0.3.3`; the npm registry now contains `0.3.3`. `v0.3.2` remains the previous published baseline.

### Added

- Added dependency-free Java and Kotlin source-facts analyzers (`src/audits/core/javaAnalyzer.ts`, `src/audits/core/kotlinAnalyzer.ts`) and registered them in the language analyzer registry alongside the existing TypeScript/JavaScript and Python analyzers.
- Added JVM project metadata collection (`src/audits/core/jvmProjectMetadata.ts`) for static Gradle/Maven/wrapper/source-set presence and a best-effort project name. It never executes Gradle, Maven, compilers, or target tests.
- Added shared JVM source-facts helpers (`src/audits/codeRot/utils/jvmSourceFactsUtils.ts`) reused by Java/Kotlin detector integrations.
- Added Java/Kotlin source-facts-aware signals to the existing `dead-code-candidate`, `duplicate-implementation-candidate`, and `test-rot` detectors, with conservative JVM-specific evidence wording.
- Added Java/Kotlin docs-code-mismatch support for backtick-quoted FQCN-shaped symbol claims and static Gradle/Maven command/feature claims. Android current-state mismatch detection remains part of the existing docs-code-mismatch mechanism only.
- Added focused Java/Kotlin analyzer, JVM metadata, detector, and mixed-language integration coverage under `tests/audits/`.

### Changed

- Preserved the existing audit command surface: `npm run audit -- --types code-rot`, `--types security`, and `--types code-rot,security` remain the implemented audit paths, with `code-rot` still the only default audit type.
- Preserved the existing audit report schema: no `SourceFacts` schema change, no new top-level audit report field, and no new audit type were added for `v0.3.3`.

### Compatibility and limitations

- Java/Kotlin analysis is conservative and scanner-based. It does not perform compiler parsing, type resolution, classpath/symbol resolution, runtime reachability analysis, or target-project test execution.
- Java/Kotlin support does not execute Gradle, Maven, Android tooling, or network-backed dependency checks. Static JVM metadata is presence/simple-text-extraction only.
- Java/Kotlin field/property extraction, Java text-block special handling, Kotlin extension-function receiver semantics, and method/constructor-level dead-code detection are not implemented.
- JVM package/environment rot remains deferred because the existing `dependency-environment-rot` detector is still npm/Node-specific.
- `security:validate` remains preserved and unchanged from `v0.3.2`.
- `quality`, `project`, and `all` audit types remain planned; `--types quality`/`project`/`all` still fail cleanly with exit code 2.
- Android validation remains planned and out of scope for `v0.3.3`.

## [0.3.2] - 2026-07-09

Python code-rot support and a first security-validation audit adapter, implemented on top of the published `v0.3.1` baseline. Published.

### Added

- Added a dependency-free Python source-facts analyzer (`src/audits/core/pythonAnalyzer.ts`) that extracts imports (including relative dotted imports), `__all__`, and module-level/class-body declarations from `.py` files, registered in the language analyzer registry alongside the existing TypeScript/JavaScript analyzer.
- Added Python project/config metadata collection (`src/audits/core/pythonProjectMetadata.ts`): presence detection for `pyproject.toml`, `requirements.txt`, `setup.py`, `setup.cfg`, `tox.ini`, and `pytest.ini`, plus a best-effort project name and pytest-configuration flag. Never executes Python/pip/pytest/tox tooling.
- Added Python-aware signals to the existing `dead-code-candidate`, `duplicate-implementation-candidate`, and `test-rot` code-rot detectors, using an analyzer-id-scoped grouping key so the pre-existing TypeScript/JavaScript duplicate-declaration grouping is unaffected.
- Added `sourceFacts.filesWithDiagnosticsCount` to the audit report's source-facts summary — a language-agnostic count of analyzed files carrying at least one per-file diagnostic.
- Added `pythonProjectMetadata` as a top-level audit report field (JSON and text), populated unconditionally alongside `sourceFacts`.
- Added the security-validation audit adapter (`src/audits/security/securityAuditAdapter.ts`, `mapSecurityFindingToAuditIssue.ts`, `securityAuditTypes.ts`): `npm run audit -- --types security` and `npm run audit -- --types code-rot,security` now run security validation through the shared audit/report surface by calling `runSecurityValidation()` directly (no shelling out to `security:validate`, no console-text parsing).
- Added `securitySummary` as a top-level audit report field (JSON and text): verdict, check counts by status, finding counts by severity, mapped-issue count, and paths to the original `reports/security/*.txt`/`*.json` report.
- Added mapping of `SecurityFinding` results into audit-issue-shaped entries (`auditType: "security"`), preserving severity (blocker/major/minor/informational → blocker/high/medium/info), affected files, recommendation text, and release/implementation-blocking semantics. Skipped optional security checks never appear as issues or as a passed result.
- `security` is now an implemented `--types` value (`IMPLEMENTED_AUDIT_TYPES`), deliberately kept out of `DEFAULT_AUDIT_TYPES` so a default, no-flag `npm run audit` run is unchanged (still `code-rot` only).

### Changed

- Extracted the `SecurityReport`-object-assembly step out of `scripts/security/validate.ts` into `src/securityValidation/report/buildSecurityReport.ts` so the audit adapter can reuse it without duplicating logic. Output of `security:validate` is unchanged.
- Widened `reportFilenamePrefix()`'s parameter type to a narrow `Pick<SecurityValidationTarget, ...>` so the audit adapter can call it without re-resolving the validation target a second time. All existing callers are unaffected.

### Compatibility and limitations

- `npm run security:validate` (self and `--target <path>`) is unchanged — verified against the full existing security test suite plus a live smoke run.
- `npm run audit -- --types code-rot` is unchanged.
- The audit report's top-level schema grows from 14 fields (`v0.3.1`) to 16 fields: `pythonProjectMetadata` and `securitySummary` are additive; `schemaVersion` stays `"1.0"`.
- Python static analysis remains conservative: regex/line-based, dependency-free, single-file. It does not perform Python runtime execution, type checking, dependency resolution, or cross-file call-graph analysis. `references` are intentionally left empty for Python (no call/identifier tracking).
- Java and Kotlin remain fallback-only; no analyzer is registered for them.
- `quality`, `project`, and `all` audit types remain planned; `--types quality`/`project`/`all` still fail cleanly with exit code 2.
- The security audit adapter runs the same default check groups `security:validate` uses with no flags (`deps`, `package`, `static`, `cli-adversarial`, `fuzz`); there is no `--checks`/`--profile` passthrough on the `audit` command.

## [0.3.1] - 2026-07-09

Language-aware code-rot substrate plus TypeScript/JavaScript support. Published.

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
- Added the latest-Node cross-platform readiness workflow for `windows-latest`, `macos-latest`, and `ubuntu-latest` on Node `26.5.0`.

### Fixed

- Fixed `.mts` and `.cts` source-role eligibility for source-facts collection.
- Fixed audit text rendering so an evidence entry with both `message` and `excerpt` renders both.
- Fixed the audit validation reliability issue by isolating the expensive `security:validate` smoke path in the audit command tests and pinning Vitest worker settings with `vitest.config.ts`.

### Compatibility and limitations

- No audit command flags were added or changed.
- Audit issue shape remains unchanged.
- Python, Java, and Kotlin remain fallback-only in `v0.3.1`; no parser/analyzer is registered for them.
- TypeScript/JavaScript analysis is syntax-only and single-file. It does not perform TypeScript Program semantic analysis, type checking, full module resolution, `tsconfig` path alias resolution, coverage analysis, clone detection, runtime reachability analysis, or target-file modification.
- Audit findings remain heuristic and conservative; they are candidates for review, not proof of a defect.

## [0.3.0] - Published

Generic audit framework and code-rot detector. Published; superseded by `v0.3.1` as the current published baseline.

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

- Added security-validation planning and framework documentation for the staged release-security track.
- Added security validation core types, configuration, command runner, and test matrix scaffolding.
- Added dependency validation through `security:deps`.
- Added package-content validation through `security:package`.
- Added initial security unit coverage through `test:security`.
- Added Windows-safe npm command resolution for security scripts.
- Added parsers and runners for `npm audit`, `npm audit --omit=dev`, `npm ls --all`, `npm outdated`, and optional OSV-Scanner execution.
- Added forbidden package-content detection and structured `npm pack --dry-run` parsing.

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
