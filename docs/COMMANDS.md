# Commands

## Current command families

This reference describes the implemented my-dev-kit-lab command surface. It covers repository verification, experiments, evidence rendering, generic audits, security validation, Android validation, and documentation checks. Planned commands and flags belong in [ROADMAP.md](ROADMAP.md), not in current syntax examples.

## Installation and validation

Current repository validation commands:

- `npm install`
- `npm ci`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run verify`
- `npm run docs:check`

Use `npm ci` for a reproducible clean install when `package-lock.json` is present. Use `npm install` during normal dependency development. `npm run verify` builds and executes the complete repository verification chain; `npm run docs:check` validates documentation structure, lifecycle claims, required releases, roadmap order, and protected capability families.

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
- `npm run generate-prompt-variants`
- `npm run run-agent-prompt`
- `npm run evaluate-token-savings`

Typical examples:

```bash
npm run experiment:list
npm run experiment:describe -- --experiment context-strategy-comparison
npm run experiment:run -- --experiment context-strategy-comparison --target /path/to/local/project --agents fake-agent --complexities short --no-screenshot
```

```powershell
npm run experiment:run -- --experiment context-strategy-comparison --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --agents fake-agent --complexities short --no-screenshot
```

`experiment:run` options for `context-strategy-comparison`:

| Option | Allowed value or default |
|---|---|
| `--experiment <id>` | Required; currently `context-strategy-comparison` |
| `--target <path>` | Optional; defaults to self mode |
| `--out <dir>` | Defaults to `lab-output/context-strategy-comparison` |
| `--cases <path>` | Defaults to `examples/token-savings-cases.json` |
| `--project-profiles <path>` | Defaults to `benchmarks/contracts/benchmark-project-profiles.json` |
| `--case <ids>` | Optional comma-separated case filter |
| `--benchmark-project <ids>` | Optional comma-separated project filter |
| `--agents <ids>` | `fake-agent`, `codex`, `claude`; defaults to `fake-agent` |
| `--strategies <ids>` | `raw-full-file`, `my-dev-kit-guided`; defaults to both |
| `--complexities <ids>` | `short`, `medium`, `long`, `multi-step`; defaults to `short` |
| `--timeout-ms <n>` / `--max-runs <n>` | Optional positive integers |
| `--continue-on-failure` / `--no-continue-on-failure` | Defaults to continue |
| `--include-real-agents` / `--require-agents` | Opt into or require configured provider CLIs |
| `--command-template-codex <template>` / `--command-template-claude <template>` | Optional provider command templates |
| `--no-screenshot` | Accepted for compatibility; plugin-aware reporting does not capture one yet |

Current behavior:

- `context-strategy-comparison` is the only registered plugin
- omitting `--target` uses self mode
- target projects are not modified by experiment execution

Outputs are written beneath the selected `--out` directory. Invalid experiment IDs or configuration fail with a nonzero exit code. Real-agent commands can also record structured partial outcomes such as timeouts, unavailable agents, usage limits, or invalid output.

### v0.4.3 stage-context strategies

Six additional strategy IDs are implemented in the `context-strategy-comparison` plugin: `architecture-context-only`, `architecture-plus-implementation-refresh`, `architecture-plus-implementation-and-test-refresh`, `full-workflow-library`, `bounded-workflow-instruction-packet`, and `combined-bounded-stage-context`. They are selected through programmatic `v043StrategyInputs`/`v043RunAssurance` configuration passed to the plugin, not through `experiment:run` CLI flags — no new command-line options were added for these paths. The default `experiment:run -- --strategies` selection remains `raw-full-file` and `my-dev-kit-guided`; the six new strategies must be selected explicitly.

## Reports, plots, and gallery

| Command | Purpose |
|---|---|
| `npm run render-experiment-report` | Render JSON and HTML from experiment artifacts |
| `npm run generate-experiment-plots` | Produce plot data and deterministic SVG charts |
| `npm run run-visualization-demos` | Run my-dev-kit visualization examples |
| `npm run build-gallery` | Build a gallery manifest and static HTML index |
| `npm run capture-demo-report` | Capture an optional report screenshot |
| `npm run run-final-demo` | Run the deterministic experiment-to-gallery workflow |
| `npm run lab-demo` | Run the compact lab demonstration |

Each command accepts its own input and output options. Use the examples in [WORKFLOWS.md](WORKFLOWS.md) for ordered procedures and [GALLERY.md](GALLERY.md) for gallery-specific paths and limitations.

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

| Option | Allowed value or default |
|---|---|
| `--target <path>` | Optional; defaults to self mode |
| `--checks <ids>` | Any implemented check IDs listed below; explicit selection overrides profile defaults |
| `--profile <id>` | `node-cli-package`, `local-tool`, `npm-package`, `android`; optional |
| `--format <ids>` | `text`, `json`, or both; defaults to both |
| `--fail-on <level>` | `blocker`, `high`, `medium`, `low`; defaults to `blocker` |
| `--out <dir>` | Defaults to `reports/security` |
| `--report-prefix <name>` | Optional; otherwise derived from target metadata |
| `--android-gradle-operations <ids>` | Closed list: `wrapper-version`, `tasks`, `assemble-debug`, `unit-test-debug`, `lint-debug`; defaults to none |
| `--android-external-tools <ids>` | Closed list: `semgrep`, `osv`, `android-lint`, `dependency-check`; defaults to none |
| `--android-external-network <policy>` | `deny` or `allow-requested`; defaults to `deny` |

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
- `android`

Current profile rule:

- `--profile android` is implemented and selects the static Android validation path
- Compose/XML/mixed classification is detected within that profile; `android-compose` is not an accepted profile

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
- no `--profile` and no `--checks` runs `deps,package,static,cli-adversarial,fuzz`
- explicit `--checks` overrides profile defaults
- Android defaults start zero Gradle operations, external tools, and network operations; all three require closed, profile-specific opt-ins
- reports default to `reports/security/<prefix>-security-validation.txt` and `.json`, subject to `--format`
- the exit status follows the selected `--fail-on` threshold; invalid options or targets fail cleanly

## Audit commands

The generic audit framework runs conservative repository-health checks. It is separate from `security:validate`: selecting the `security` audit type adapts the standalone validator's results into the audit report while preserving the original security report.

Current implemented command:

- `npm run audit`

### `npm run audit`

Current options:

| Option | Allowed value or default |
|---|---|
| `--target <path>` | Optional; defaults to self mode |
| `--types <ids>` | `code-rot`, `security`, or both; defaults to `code-rot` |
| `--include <ids>` | `docs`, `tests`, `package`, `architecture`, `cli`; defaults to all |
| `--format <ids>` | `text`, `json`, or both; defaults to both |
| `--fail-on <level>` | `blocker`, `high`, `medium`, `low`, `none`; defaults to `blocker` |
| `--out <path>` | Optional report output directory |
| `--android` | Optional; requires `--types` to include `security` |

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
npm run audit -- --target /path/to/android/project --types security --android --format text,json --fail-on none
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
- `--android` runs the same nineteen static Android checks through the existing adapter; confirmed findings can map to audit issues, while `CandidateEvidence` remains review-only
- omitting `--android` starts no Android validation
- reports are written under `reports/audits/<type>/code-rot-audit.txt` and/or `code-rot-audit.json` by default (the report filename is fixed regardless of `--types`; only the containing directory changes, e.g. `reports/audits/security/` for `--types security`)
Current report details:

- JSON reports include source-facts, Python project metadata, and security-summary fields where applicable; JVM metadata remains detector input rather than a separate top-level field.
- The security summary records verdicts, check/finding counts, mapped issue counts, and links to the original security reports. Skipped optional checks remain skips and never become issues or passes.
- Source-facts findings are conservative candidate evidence. The language analyzers do not provide type checking, full module/classpath resolution, runtime reachability, clone detection, coverage proof, compiler execution, Gradle/Maven execution, or target-test execution.
- The audit command has no `--checks`, `--profile`, `--languages`, or `--frameworks` option. Android audit integration uses only `--android`.

Unsupported command/profile names such as `android-compose`, `security:pentest`, `security:android`, `mobile:detect`, and `mobile:validate` are not current syntax. See [ROADMAP.md](ROADMAP.md) for approved future scope.
