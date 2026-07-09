# Commands

This document describes the current command surface in my-dev-kit-lab and the limited planned command direction that is relevant to the roadmap.

Current rule: do not treat planned commands or planned flags as implemented behavior.

## Installation and validation

Current repository validation commands:

- `npm install`
- `npm ci`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run verify`

Focused validation scripts from `package.json`:

- `npm run test:benchmarks`
- `npm run test:report`
- `npm run test:screenshot`
- `npm run test:evaluation`
- `npm run test:gallery`
- `npm run test:demo`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:agents`
- `npm run test:experiments`
- `npm run test:plots`
- `npm run test:visualization-demos`
- `npm run verify:benchmarks`

## Experiment commands

Current implemented commands:

- `npm run experiment:list`
- `npm run experiment:describe -- --experiment context-strategy-comparison`
- `npm run experiment:run -- --experiment context-strategy-comparison`
- `npm run run-controlled-experiment`
- `npm run render-experiment-report`
- `npm run generate-experiment-plots`
- `npm run run-visualization-demos`
- `npm run build-gallery`
- `npm run run-final-demo`
- `npm run generate-prompt-variants`
- `npm run run-agent-prompt`
- `npm run evaluate-token-savings`
- `npm run lab-demo`
- `npm run capture-demo-report`

Typical examples:

```bash
npm run experiment:list
npm run experiment:describe -- --experiment context-strategy-comparison
npm run experiment:run -- --experiment context-strategy-comparison --target /path/to/local/project --agents fake-agent --complexities short --no-screenshot
```

```powershell
npm run experiment:run -- --experiment context-strategy-comparison --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --agents fake-agent --complexities short --no-screenshot
```

Current behavior:

- `context-strategy-comparison` is the only registered plugin
- omitting `--target` uses self mode
- target projects are not modified by experiment execution

## Security-validation commands

Current implemented commands:

- `npm run security:deps`
- `npm run security:package`
- `npm run security:codeql`
- `npm run security:semgrep`
- `npm run test:security`
- `npm run test:fuzz:smoke`
- `npm run security:validate`

### `npm run security:validate`

Current options:

- `--target <path>`
- `--checks <ids>`
- `--profile <id>`
- `--format text|json|text,json`
- `--fail-on blocker|high|medium|low`
- `--out <dir>`
- `--report-prefix <name>`

Current check groups:

- `deps`
- `package`
- `static`
- `cli-adversarial`
- `fuzz`
- `boundary`
- `subprocess`
- `secrets`
- `network`

Current implemented profiles:

- `node-cli-package`
- `local-tool`
- `npm-package`

Current profile rule:

- `android` and `android-compose` are not implemented today
- future Android profile support is planned for `v0.4.x`

Examples:

```bash
npm run security:validate
npm run security:validate -- --target /path/to/project
npm run security:validate -- --checks deps,package,static,cli-adversarial,fuzz --format text,json
npm run security:validate -- --profile node-cli-package --format json
```

```powershell
npm run security:validate -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"
```

Current behavior:

- target files are not modified by default
- optional tools can be skipped and are reported as skipped, not passed
- this is automated validation, not manual pentest

## Audit commands

The generic audit framework is implemented. `code-rot` was implemented in `v0.3.0`; `security` is implemented in the checked-out `v0.3.2` release-prepared package state. The audit framework is separate from `security:validate`: `npm run audit -- --types security` adapts `security:validate`'s internals and report family into the audit report surface, but does not replace the standalone `security:validate` command.

Current implemented command:

- `npm run audit`

### `npm run audit`

Current options:

- `--target <path>`
- `--types <ids>`
- `--include <ids>`
- `--format text|json|text,json`
- `--fail-on blocker|high|medium|low|none`
- `--out <path>`

Current implemented audit types:

- `code-rot`
- `security`
- `code-rot,security` (combined; comma-separated multi-type selection)

Current planned-but-not-implemented audit types:

- `quality`
- `project`
- `all`

Examples:

```bash
npm run audit
npm run audit -- --types code-rot --fail-on none
npm run audit -- --target /path/to/local/project --types code-rot --include docs,tests,package,architecture,cli
npm run audit -- --types security --fail-on none
npm run audit -- --target /path/to/local/project --types security --fail-on none
npm run audit -- --types code-rot,security --fail-on none
npm run audit -- --target /path/to/local/project --types code-rot,security --fail-on none
```

```powershell
npm run audit -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --types code-rot --fail-on none
npm run audit -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --types security --fail-on none
npm run audit -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --types code-rot,security --fail-on none
```

Current behavior:

- `code-rot` and `security` run today; `quality`, `project`, and `all` are recognized but fail cleanly instead of running
- the default, no-flag `npm run audit` run is unchanged — it still runs `code-rot` only; `security` must be explicitly requested via `--types`
- audit findings are heuristic candidates, not proof of defects
- target files are not modified
- audit does not auto-fix issues
- reports are written under `reports/audits/<type>/code-rot-audit.txt` and/or `code-rot-audit.json` by default (the report filename is fixed regardless of `--types`; only the containing directory changes, e.g. `reports/audits/security/` for `--types security`)
- the `v0.3.1` package state added source-facts summaries to audit reports; the checked-out `v0.3.2` release-prepared state adds Python project metadata and the security summary described below, without adding new command flags

`v0.3.1` report details (published):

- JSON reports include a top-level `sourceFacts` summary with `totalFilesAnalyzed`, `filesByLanguage`, `filesByParseStatus`, `analyzerDiagnosticCount`, `filesWithDiagnosticsCount`, and `warnings`.
- Text reports include a `Source facts` section with analyzed-file and parse-status counts.
- Source-facts-derived issue evidence is still conservative candidate evidence. It can mention parsed TypeScript/JavaScript imports, exports, declarations, dynamic imports, or duplicate declaration candidates.
- TypeScript/JavaScript source facts are syntax-only and single-file; they do not imply type-checking, full module resolution, `tsconfig` path alias resolution, runtime reachability, clone detection, or coverage analysis.

Checked-out `v0.3.2` report details (release-prepared, not published):

- JSON/text reports include a top-level `pythonProjectMetadata` field: presence booleans for `pyproject.toml`, `requirements.txt`, `setup.py`, `setup.cfg`, `tox.ini`, `pytest.ini`, plus a best-effort project name and a pytest-configuration flag. Populated (all-false/null where absent) regardless of `--types`.
- Source-facts-derived evidence can also mention parsed Python imports, `__all__`, and module/class-level declarations. Python static analysis is regex/line-based and dependency-free; it does not execute Python, perform type checking, or resolve dependencies.
- Running `--types security` (or `--types code-rot,security`) adds a top-level `securitySummary` field: `ran`, `verdict`/`verdictLabel`/`recommendedNextStep`, check counts (`totalChecks`/`checksPassed`/`checksWarning`/`checksFailed`/`checksSkipped`), `findingCounts` (`blocker`/`major`/`minor`/`informational`), `mappedIssueCount`, and `reportPaths` (`text`/`json`) pointing at the original `reports/security/*.txt`/`*.json` report. `securitySummary.ran` is `false` (all other fields null/zero) when `security` was not selected.
- Security findings are mapped into the `issues` array with `auditType: "security"` and `detectorId: "security-validation-adapter"`. Severity maps blocker→blocker, major→high, minor→medium, informational→info. Skipped optional security checks (e.g. an unavailable static-scan tool) are represented only in `securitySummary`'s check counts — never as an issue, never as a passed check.
- The security audit adapter runs the same default check groups `security:validate` runs with no flags (`deps`, `package`, `static`, `cli-adversarial`, `fuzz`); there is currently no `--checks`/`--profile` passthrough on the `audit` command itself.

## Planned command direction

These examples are future direction only. They are not current behavior unless the corresponding roadmap version is implemented.

Planned `v0.3.x` direction:

- language-aware code-rot support may later add selectors such as `--languages`; there is no current `--languages` flag
- framework-aware code-rot profile selection is future/TBD; there is no current `--frameworks` flag

Planned `v0.4.0` direction:

- `npm run security:validate -- --target <path> --profile android`
- `npm run security:validate -- --target <path> --profile android-compose`

Planned optional `v0.4.2` direction (Android-specific extension of the already-implemented `--types security` adapter):

- `npm run audit -- --target <path> --types security --profile android`

There is currently no `--profile` flag on `npm run audit` (the security audit adapter always uses `security:validate`'s no-flag default check selection), and no `npm run audit:all`, `npm run audit:quality`, `npm run security:pentest`, `npm run security:android`, `npm run mobile:detect`, or `npm run mobile:validate` script.
