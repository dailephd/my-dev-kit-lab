# Changelog

All notable changes to my-dev-kit-lab are documented here.

## [Unreleased] - v0.2.0

Generic experiment-plugin foundation and first plugin conversion.

### Added

- Added generic experiment plugin contracts, registry, execution context, target model, config validation result, and normalized result model.
- Added shared local target metadata resolution used by both experiment targets and security validation targets.
- Added `context-strategy-comparison` as the first registered experiment plugin for the existing raw-full-file vs my-dev-kit-guided workflow.
- Added plugin result metadata output at `experiment-plugin-result.json` while preserving the existing `experiment-summary.json`, `experiment-runs.json`, and `experiment-comparisons.json` artifacts.

### Changed

- Routed the existing controlled experiment command wrapper through the `context-strategy-comparison` plugin without changing the public command arguments or legacy artifact behavior.

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

### Next roadmap phase

The next major development phase is a generic experiment-plugin framework. The current raw-vs-indexed pipeline will become the first experiment plugin (`context-strategy-comparison`). Future plugins will cover warm-index reuse, incremental-change staleness, context-window scaling, retrieval precision/recall, and agent-success-rate experiments.
