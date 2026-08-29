# Commands

## Current command families

This reference describes the implemented my-dev-kit-lab command surface. It covers repository verification, experiments, evidence rendering, generic audits, security validation, Android validation, and documentation checks. Planned commands and flags belong in [ROADMAP.md](ROADMAP.md), not in current syntax examples.

### Current execution boundary

v0.4.6 implements a supported installed `my-dev-kit-lab` CLI (see "Installed CLI commands" below) but has not been published to npm; the latest published package remains v0.4.5. In the currently published v0.4.5 package, the `my-dev-kit-lab` binary only runs the final-demo entrypoint, and commands such as `security:validate`, `audit`, and the `experiment` family are only reachable through `npm run ...` from a source checkout.

Once v0.4.6 is published, the commands documented under "Installed CLI commands" become available without cloning this repository. Until then, use the `npm run` commands documented under "Contributor / developer npm scripts". Both paths call the same underlying command owners — there is no separate implementation.

## Installed CLI commands (v0.4.6, not yet published)

After v0.4.6 is published, invoking the installed `my-dev-kit-lab` binary (installed globally, via `npx`, or as a local project dependency) exposes this command tree:

```
my-dev-kit-lab --help | -h
my-dev-kit-lab --version | -V

my-dev-kit-lab [--workspace <path>] security validate [options]
my-dev-kit-lab [--workspace <path>] audit [options]

my-dev-kit-lab [--workspace <path>] experiment list
my-dev-kit-lab [--workspace <path>] experiment describe --experiment <id>
my-dev-kit-lab [--workspace <path>] experiment run --experiment <id> [options]
my-dev-kit-lab [--workspace <path>] experiment controlled [options]

my-dev-kit-lab [--workspace <path>] report render [options]
my-dev-kit-lab [--workspace <path>] plots generate [options]
my-dev-kit-lab [--workspace <path>] gallery build [options]

my-dev-kit-lab demo final [options]
```

Every command and family also accepts `--help`/`-h` for bounded usage text. `--help`/`--version` with no other arguments, and no arguments at all, print top-level help and exit `0`.

### Global `--workspace` option

`--workspace <path>` is a global option and, when used, must appear before the command (for example `my-dev-kit-lab --workspace ./lab-state audit ...`). It selects the writable lab workspace:

- omitted: defaults to `<home>/.my-dev-kit-lab`
- absolute path: used as given
- relative path: resolved against the directory the command was invoked from (not the installed package location)

Commands that have an implicit (no explicit `--out`) writable output — currently `audit` and `security validate` — write that implicit output beneath the workspace. Commands that require an explicit `--out`/output option (`experiment run`, `experiment controlled`, `report render`, `plots generate`, `gallery build`, `demo final`) keep that path's existing resolution behavior unchanged; explicit paths are never redirected under the workspace. The installed package directory and the inspected `--target` project are never used as the default writable location.

### `my-dev-kit-lab security validate`

Same command owner and options as `npm run security:validate` (see "Security-validation commands" below), reached through the installed CLI instead of a source checkout. `--out` defaults to `<workspace>/reports/security` when omitted.

### `my-dev-kit-lab audit`

Same command owner and options as `npm run audit` (see "Audit commands" below). `--out` defaults to `<workspace>/reports/audits/<type>` when omitted.

### `my-dev-kit-lab experiment list`

Lists registered experiment plugins (currently `context-strategy-comparison`). Accepts `--json` for machine-readable output. Read-only; does not require a writable workspace and works when the package root, invocation directory, and workspace all differ.

### `my-dev-kit-lab experiment describe --experiment <id>`

Describes one registered experiment plugin: metadata, purpose, supported variants, required/optional config fields, target behavior, and expected reports. Accepts `--json`. Read-only. Unknown plugin IDs fail with exit code `1`.

### `my-dev-kit-lab experiment run --experiment <id> [options]`

Same command owner and options as `npm run experiment:run` (see "Experiment commands" below). Two differences from the source-checkout script:

- The default `--cases` (`examples/token-savings-cases.json`) and default `--project-profiles` (`benchmarks/contracts/benchmark-project-profiles.json`) resolve as bundled package resources, independent of the invocation directory.
- When `--out` is omitted, the implicit output root is `<workspace>/lab-output/experiments/<plugin>/<target>/<run>/` (same subdirectory shape as the source-checkout default, rooted under the workspace instead of the tool root).

### `my-dev-kit-lab experiment controlled [options]`

Runs the `context-strategy-comparison` plugin's legacy controlled-experiment path directly (not through the generic plugin runner). Options:

| Option | Allowed value or default |
|---|---|
| `--cases <path>` | Required |
| `--out <dir>` | Required |
| `--project-profiles <path>` | Defaults to the bundled `benchmarks/contracts/benchmark-project-profiles.json` package resource |
| `--case <ids>` | Optional comma-separated case filter |
| `--benchmark-project <ids>` | Optional comma-separated project filter |
| `--agents <ids>` | `fake-agent`, `codex`, `claude`; defaults to `fake-agent` |
| `--strategies <ids>` | `raw-full-file`, `my-dev-kit-guided` |
| `--complexities <ids>` | `short`, `medium`, `long`, `multi-step` |
| `--timeout-ms <n>` / `--max-runs <n>` | Optional positive integers |
| `--continue-on-failure` / `--no-continue-on-failure` | Defaults to continue |
| `--require-agents` / `--include-real-agents` | Require or allow configured provider CLIs |
| `--command-template-codex <template>` / `--command-template-claude <template>` | Optional provider command templates |

### `my-dev-kit-lab report render [options]`

| Option | Allowed value or default |
|---|---|
| `--experiment <dir>` | Required; a controlled-experiment output directory |
| `--out <dir>` | Required |
| `--title <title>` / `--subtitle <subtitle>` | Optional |
| `--screenshot` / `--no-screenshot` | Defaults to no screenshot |
| `--require-screenshot` | Fails unless a screenshot was captured; implies `--screenshot` |
| `--max-prompt-chars <n>` / `--max-file-tree-entries <n>` | Optional positive integers |
| `--plots <dir>` / `--visualizations <dir>` | Optional; included in the report when present |

### `my-dev-kit-lab plots generate [options]`

| Option | Allowed value or default |
|---|---|
| `--experiment <dir>` | Required |
| `--out <dir>` | Required |

### `my-dev-kit-lab gallery build [options]`

| Option | Allowed value or default |
|---|---|
| `--out <dir>` | Required |
| `--report <dir>` / `--plots <dir>` / `--visualizations <dir>` / `--experiment <dir>` | Optional; included in the manifest when present |

### `my-dev-kit-lab demo final [options]`

Same command owner and options as `npm run run-final-demo` (see "Reports, plots, and gallery" below). Runs the full deterministic pipeline: controlled experiment → report → plots → visualization demos → gallery. `--cases`, `--out`, and `--kit-command` are required.

### Legacy direct final-demo invocation

The historical form — the same flags `demo final` accepts, without the `demo final` prefix (for example `my-dev-kit-lab --cases ... --out ... --kit-command ...`) — continues to work for backward compatibility. The router recognizes it only when the first argument is one of the flags final-demo actually accepts; unrecognized top-level commands are rejected rather than silently treated as final-demo.

### Not yet routed through the installed CLI

`security deps`, `security package`, `security codeql`, `security semgrep`, `security fuzz`, and any visualization-demo subcommand are not implemented as installed CLI routes. Attempting them returns the usage exit code. They remain source-checkout `npm run` workflows (see below).

## Contributor / developer npm scripts

The commands in this section run from a cloned repository checkout. Some are contributor aliases into the same command owners the installed CLI uses (`security:validate`, `audit`, `experiment:list`/`describe`/`run`, `run-controlled-experiment`, `render-experiment-report`, `generate-experiment-plots`, `build-gallery`, `run-final-demo`); others are source-checkout-only developer tooling with no installed-CLI equivalent (`security:deps`, `security:package`, `security:codeql`, `security:semgrep`, `test:fuzz:smoke`, `report:context-integrity-smoke`, `run-visualization-demos`, and the build/test/verify/docs-check commands below).

## Installation and validation

Current repository validation commands:

- `npm install`
- `npm ci`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run verify`
- `npm run docs:check`

Use `npm ci` for a reproducible clean install when `package-lock.json` is present. Use `npm install` during normal dependency development. `npm test` runs the canonical complete Vitest suite (every `tests/**/*.spec.ts` file, including the focused subsets listed below). `npm run verify` runs the non-test verification chain (build, benchmark-fixture verification) and intentionally excludes the test suite, so complete validation requires both `npm run test` and `npm run verify`, in either order but each exactly once; `npm run docs:check` validates documentation structure, lifecycle claims, required releases, roadmap order, and protected capability families.

Focused validation scripts from `package.json` are developer conveniences that each run a subset of files already executed by `npm test`; they are not additional required gates and are not chained into `verify`:

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
- `npm run verify:benchmarks` (distinct, non-test benchmark-fixture validation — this one runs as part of `npm run verify`)

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

### v0.4.4 producer-readiness bridge (released)

`combined-bounded-stage-context` optionally accepts additional producer-readiness bridge inputs — the implementation/test-context packet and retrieval-report file paths, and a readiness plain object — through the same programmatic strategy-input configuration described above. No CLI flags exist for these inputs, and none are planned for this patch; readiness in particular has no on-disk file format at the frozen orchestrator commit and is only ever accepted as a plain object.

### v0.4.5 context-integrity evaluation

Context-integrity evaluation (condition-aware producer evidence vs. orchestrator run-integrity evidence, evaluated against the frozen `tests/fixtures/ecosystem/context-integrity/v0.4.5/` fixture pair) has no dedicated `experiment:run` command or CLI flags; it is exercised through tests (`npm run test:evaluation`, `npm run test:report`) and through:

```bash
npm run report:context-integrity-smoke
```

This takes no arguments. It loads both frozen fixtures, evaluates each through the existing producer-readiness bridge, and writes `ContextIntegrityReportV1` JSON/text/HTML reports to `lab-output/context-integrity-report-smoke/` for manual inspection. It is a developer convenience, not part of any release-readiness gate or the audited command surface in the tables below.

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
