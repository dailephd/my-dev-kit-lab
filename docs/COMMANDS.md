# Commands

## Current command families

This reference describes the implemented my-dev-kit-lab command surface. It covers repository verification, experiments, evidence rendering, generic audits, security validation, Android validation, and documentation checks. Planned commands and flags belong in [ROADMAP.md](ROADMAP.md), not in current syntax examples.

### Current execution boundary

my-dev-kit-lab ships a supported installed CLI (see "Installed CLI commands" below). The commands documented there are available without cloning this repository. The `npm run` commands documented under "Contributor / developer npm scripts" remain available from a source checkout. Both paths call the same underlying command owners — there is no separate implementation.

## Installed CLI commands

This section describes the current source checkout and published package. The `context-window-scaling` command surface (v0.7.0), including the `--synthetic-config` option added in v0.7.1, is included in the current package.

The `--local-subject-config` option and the external local-repository mode described under `context-window-scaling` were added in v0.7.2 and are included in the current package.

The `retrieval-precision-recall` command surface (v0.8.0), documented below, is included in the current package (released in v0.8.0).

The `retrieval-query-strategy-comparison` command surface (v0.8.1), documented below, is included in the current 0.8.1 package.

Invoking the installed `my-dev-kit-lab` binary (installed globally, via `npx`, or as a local project dependency) exposes this command tree:

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

### `my-dev-kit-lab tutorial`

The tutorial family validates and runs declarative `TutorialScenarioV1` browser scenarios. Validation is read-only and does not require Chromium; execution requires a compatible locally installed Chromium because the package does not download browser binaries automatically.

```text
my-dev-kit-lab tutorial --help
my-dev-kit-lab tutorial validate --scenario <path>
my-dev-kit-lab tutorial validate --scenario <path> --target-contract <path>
my-dev-kit-lab tutorial validate --scenario <path> --target-contract <path> --json
my-dev-kit-lab tutorial run --scenario <path> --target-contract <path>
my-dev-kit-lab tutorial run --scenario <path> --target-contract <path> --out <path>
my-dev-kit-lab tutorial run --scenario <path> --target-contract <path> --json
```

`tutorial validate` accepts `--scenario`, optional `--target-contract`, and `--json`. It returns `0` for valid contracts, `1` for content validation failures, and `2` for usage errors. `tutorial run` requires both contract paths and accepts optional `--out` and `--json`; it returns `0` only for a passed run, `1` for every valid but unsuccessful run (including unavailable Chromium), and `2` for usage errors.

Without `--out`, tutorial runs are created under `<home>/.my-dev-kit-lab/tutorials/<scenario-id>/<run-id>/`, or under the selected global `--workspace`. A relative `--out` resolves against the invocation directory and an absolute `--out` is used exactly as supplied. A run contains `target/`, `artifacts/`, `screenshots/`, `logs/`, and `temporary/` roots.

Canonical artifacts are `artifacts/tutorial.webm`, `artifacts/tutorial.srt`, `artifacts/tutorial.vtt`, `artifacts/tutorial.md`, `artifacts/tutorial-manifest.json`, and the requested `screenshots/<screenshot-id>.png` files. The manifest records scenario/target identity, step actions and assertions, timeline, artifact status, warnings, and cleanup errors. It is runtime evidence; video is reviewable recording, not a substitute for passing assertions.

#### Scenario action vocabulary

Tutorial scenarios (`TutorialScenarioV1`) accept the following exact action vocabulary:

- `goto`
- `click`
- `fill`
- `press`
- `hover`
- `drag`
- `select-option`
- `wait-for`
- `pointer-click`
- `pointer-drag`

##### Action distinction: `click` versus `pointer-click`

- `click`: targets an element directly through Playwright `locator.click()`.
- `pointer-click`: targets a deliberate normalized position inside one located interaction surface using real Playwright `page.mouse` (`move`, `down`, `up`).

Serialized shape:
```json
{
  "type": "pointer-click",
  "locator": { "kind": "test-id", "testId": "pointer-surface" },
  "position": {
    "x": 0.25,
    "y": 0.5
  },
  "coordinateSpace": "fraction",
  "timeoutMs": 5000
}
```

##### Action distinction: `drag` versus `pointer-drag`

- `drag`: performs element-to-element drag-and-drop between distinct source and target locators through Playwright `source.dragTo(target)`:
```json
{
  "type": "drag",
  "source": { "kind": "test-id", "testId": "source-element" },
  "target": { "kind": "test-id", "testId": "target-element" },
  "timeoutMs": 5000
}
```
- `pointer-drag`: performs a position-to-position pointer drag across two distinct normalized positions inside a single located interaction surface:
```json
{
  "type": "pointer-drag",
  "locator": { "kind": "test-id", "testId": "pointer-surface" },
  "from": {
    "x": 0.2,
    "y": 0.25
  },
  "to": {
    "x": 0.8,
    "y": 0.75
  },
  "coordinateSpace": "fraction",
  "timeoutMs": 5000
}
```

##### Action distinction: `press` versus `select-option`

- `press`: real keyboard input dispatched to an element through Playwright `locator.press(key)`. It remains the way to express a genuine keystroke and is unchanged.
- `select-option`: semantic selection of one native HTML `<select>` option through Playwright `locator.selectOption({ value })`. It expresses the intent "choose the option whose HTML value is X" rather than a platform-sensitive navigation path, so it never emulates `ArrowDown`/`Enter`.

Serialized shape:
```json
{
  "type": "select-option",
  "locator": {
    "kind": "role",
    "role": "combobox",
    "name": "Operation"
  },
  "value": "preserve",
  "timeoutMs": 5000
}
```

Validation rules:

- `locator`: required, and validated by the same canonical `TutorialLocatorV1` validator every other locator-based action uses.
- `value`: required, must be a string, and must contain at least one non-whitespace character. An empty or whitespace-only value fails validation.
- `timeoutMs`: optional, and uses the existing tutorial timeout contract (a finite positive integer; `0`, negatives, and non-integers fail).
- Unknown fields are rejected rather than ignored. `label`, `index`, and `values` are unsupported in this contract and therefore fail as unknown fields, as does any other extra field.
- Multi-select is not supported.

Runtime semantics:

- Resolves the element through the canonical locator resolver, then calls `Locator.selectOption({ value }, { timeout })`.
- Succeeds only when the browser reports exactly one selected value and that value equals the requested value. An empty result, a different value, or more than one value fails the action.
- No retry and no fallback: a failure never degrades into `click`, `press`, keyboard navigation, `page.evaluate`, or event dispatch.

##### Coordinate space and validation rules

- `coordinateSpace`: required, and must be `"fraction"`. Coordinates are normalized offsets relative to the element's current bounding box. Absolute page coordinates, screen coordinates, and element-pixel mode do not exist.
- Coordinate bounds: `x` and `y` must be finite numbers in the inclusive range `[0, 1]`. Values `< 0` or `> 1` fail validation.
- Distinct endpoints: `pointer-drag` endpoints (`from` and `to`) must be distinct. Zero-length pointer drags (`from.x === to.x && from.y === to.y`) fail validation.
- Mouse movement: `pointer-drag` executes real Playwright mouse moves with a fixed 8-step sequence (`mouse.move(start)`, `mouse.down()`, `mouse.move(end, { steps: 8 })`, `mouse.up()`).

Every command and family also accepts `--help`/`-h` for bounded usage text. `--help`/`--version` with no other arguments, and no arguments at all, print top-level help and exit `0`.

### Global `--workspace` option

`--workspace <path>` is a global option and, when used, must appear before the command (for example `my-dev-kit-lab --workspace ./lab-state audit ...`). It selects the writable lab workspace:

- omitted: defaults to `<home>/.my-dev-kit-lab`
- absolute path: used as given
- relative path: resolved against the directory the command was invoked from (not the installed package location)

In the installed CLI, commands with an implicit (no explicit `--out`) writable output include `audit`, `security validate`, `experiment run`, and `tutorial run`. They write that default output beneath the workspace; each command's section below gives its directory layout. Commands that require an explicit `--out`/output option (`experiment controlled`, `report render`, `plots generate`, `gallery build`, `demo final`) keep that path's existing resolution behavior unchanged. Explicit output paths for every command are never redirected under the workspace. The installed package directory and the inspected `--target` project are never used as the default writable location.

### `my-dev-kit-lab security validate`

Same command owner and options as `npm run security:validate` (see "Security-validation commands" below), reached through the installed CLI instead of a source checkout. `--out` defaults to `<workspace>/reports/security` when omitted.

### `my-dev-kit-lab audit`

Same command owner and options as `npm run audit` (see "Audit commands" below). `--out` defaults to `<workspace>/reports/audits/<type>` when omitted.

### `my-dev-kit-lab experiment list`

Lists registered experiment plugins: `context-strategy-comparison`, `warm-index-reuse` (introduced in v0.5.0), `incremental-change-staleness` (introduced in v0.6.2), `context-window-scaling` (released in v0.7.0), `retrieval-precision-recall` (released in v0.8.0), and `retrieval-query-strategy-comparison` (released in v0.8.1), with each plugin's status, supported variants, and outputs. Accepts `--json` for machine-readable output. Read-only; does not require a writable workspace and works when the package root, invocation directory, and workspace all differ.

### `my-dev-kit-lab experiment describe --experiment <id>`

Describes one registered experiment plugin: metadata, purpose, supported variants, required/optional config fields, target behavior, and expected reports. Accepts `--json`. Read-only. Unknown plugin IDs fail with exit code `1`.

### `my-dev-kit-lab experiment run --experiment <id> [options]`

Same command owner and options as `npm run experiment:run` (see "Experiment commands" below). Two differences from the source-checkout script:

- The default `--cases` (`examples/token-savings-cases.json`) and default `--project-profiles` (`benchmarks/contracts/benchmark-project-profiles.json`) resolve as bundled package resources, independent of the invocation directory.
- When `--out` is omitted, the implicit output root is `<workspace>/lab-output/experiments/<plugin>/<target>/<run>/` (same subdirectory shape as the source-checkout default, rooted under the workspace instead of the tool root).

`experiment run --help` groups options as common options, a my-dev-kit command override for `warm-index-reuse`, `incremental-change-staleness`, and `context-window-scaling`, `context-window-scaling`-only budget and synthetic-input options, `warm-index-reuse`-only campaign options, and `context-strategy-comparison`-only options. Plugin-specific options are rejected for other plugins rather than ignored. With `--experiment context-window-scaling`, the accepted options are `--out`, `--target`, `--case`, `--synthetic-config`, `--local-subject-config`, `--context-budgets`, and `--kit-command`. It uses its bundled four-case catalog against the Lab itself by default, generated repositories with `--synthetic-config`, or an explicitly selected local Git repository with `--target` plus `--local-subject-config`; the three subject modes are mutually exclusive. In the v0.8.0 source, `--experiment retrieval-precision-recall` accepts `--out`, `--case`, `--benchmark-project`, and `--kit-command` in bundled mode, and `--out`, `--target`, `--local-subject-config`, and `--kit-command` in external mode. `--experiment retrieval-query-strategy-comparison` (released in v0.8.1) accepts exactly the same bundled and external option sets as `retrieval-precision-recall`, plus the `--kit-command` override; it has no strategy option.

#### `warm-index-reuse`

```text
my-dev-kit-lab experiment describe --experiment warm-index-reuse
my-dev-kit-lab experiment run --experiment warm-index-reuse [--target <path>] [--out <dir>] [--cases <path>] [--project-profiles <path>] [--case <ids>] [--benchmark-project <ids>] [--kit-command <command>]
my-dev-kit-lab experiment run --experiment warm-index-reuse --campaign <preset> --include-real-agents [--case <ids>] [--out <dir>]
```

| Option | Allowed value or default |
|---|---|
| `--target <path>` | Optional; defaults to self mode |
| `--out <dir>` | Optional; installed default `<workspace>/lab-output/experiments/warm-index-reuse/<target>/<run>/`, source-checkout default `lab-output/experiments/warm-index-reuse/<target>/<run>/` |
| `--cases <path>` | Defaults to the bundled `examples/token-savings-cases.json`; the dedicated expanded corpus `benchmarks/contracts/warm-index-benchmark-cases.json` must be selected explicitly |
| `--project-profiles <path>` | Defaults to the bundled `benchmarks/contracts/benchmark-project-profiles.json` |
| `--case <ids>` | Optional comma-separated case filter; unknown IDs fail the run |
| `--benchmark-project <ids>` | Optional comma-separated project filter; unknown IDs fail the run |
| `--kit-command <command>` | For `warm-index-reuse`, the my-dev-kit command used to build one index per benchmark project and retrieve per task; defaults to `npx @dailephd/my-dev-kit@latest`. The option is also accepted by `incremental-change-staleness` with that plugin's documented default and semantics below, and is rejected for `context-strategy-comparison`. |
| `--campaign <preset>` | `warm-index-reuse` only, available in the installed v0.5.2 CLI; one of `codex-full`, `claude-full`, `codex-timeout-isolation`. Selects the bundled production corpus and a single real-agent provider for the run; cannot be combined with `--target`, `--cases`, or `--project-profiles` |
| `--include-real-agents` | `warm-index-reuse` only, available in the installed v0.5.2 CLI. Required alongside `--campaign` to run real Codex/Claude providers instead of the deterministic fake agent; rejected without `--campaign` |

Explicit `--cases` and `--project-profiles` paths resolve against the tool root (the installed package root for the installed CLI), so the packaged corpus can be named by its relative path.

Behavior:

- selected cases keep their source order and are grouped by benchmark project in first-seen order; each project group gets exactly one index setup attempt, and every task in the group reuses that index
- every task gets one `raw-full-file` baseline and, when the project's index is ready, one warm retrieval (search, lookup, slice, source); each task side with context evidence is then evaluated once by the deterministic fake agent, or, for a `--campaign` run, once by the selected real-agent provider
- the plugin variants are `raw-full-file` and `warm-index-reuse`; there is no agent-matrix selection: `--agents`, `--strategies`, `--complexities`, and the other agent-matrix options are rejected for this plugin
- `--kit-command` is rejected for `context-strategy-comparison`
- outputs beneath the output root: `warm-index-execution.json` (bounded execution evidence), `indexes/<project>/`, `commands/<project>/`, `agents/<project>/<case>/<variant>/`, and the plugin reports `report.json`, `report.txt`, and `report.html` with a warm-index reuse section
- in the installed v0.6.0 package, the same command also records index freshness evidence automatically and needs no new flag: `warm-index-execution.json` gains a project-level `indexSnapshot` (exact indexed-file SHA-256/size/modified-time evidence, index-command and my-dev-kit version evidence, and a generated-artifact inventory) and a task-level `indexFreshness` (assessed immediately before each task's warm retrieval), and `report.json`, `report.txt`, and `report.html` gain an index freshness summary and per-task freshness presentation. Freshness does not change the exit code or any status, and no reindex action is performed
- in the v0.6.1 package, the same command additionally records affected-neighborhood evidence automatically and needs no new flag or command: `warm-index-execution.json` gains a task-level `affectedNeighborhood` (assessed after that task's freshness and before its warm retrieval; an assessment object, `null` when none was performed, or absent in older artifacts), and `report.json`, `report.txt`, and `report.html` gain an affected-neighborhood summary and per-task presentation with the six metrics, the `related`/`unrelated`/`unknown` relationship, and the `recommended`/`not-indicated`/`unknown` reindex recommendation. It does not change the exit code or any status, and no reindex action is performed
- the run status is `completed`, `partial`, `failed`, or `skipped` from actual outcomes; a failed project index keeps raw evidence and records failed warm outcomes; the command exits `1` when the run status is `failed` or the arguments/configuration are invalid, and `0` otherwise
- the default cases file has one task per benchmark project; to exercise multi-task reuse, select the dedicated expanded benchmark corpus released in v0.5.1 with `--cases benchmarks/contracts/warm-index-benchmark-cases.json`, which holds six tasks each for `task-workflow-medium-ts` and `task-analytics-large-mixed`
- corpus cases carry `taskLocality` benchmark metadata (`localized`, `cross-module`, `broad-change`); it does not change execution, and there is no locality selection option — use `--case` or `--benchmark-project` to narrow a run

```text
my-dev-kit-lab experiment run --experiment warm-index-reuse --cases benchmarks/contracts/warm-index-benchmark-cases.json --benchmark-project task-workflow-medium-ts --out <dir>
```

Real-agent campaigns (available in the installed v0.5.2 CLI):

```text
my-dev-kit-lab experiment run --experiment warm-index-reuse --campaign codex-full --include-real-agents --out <dir>
my-dev-kit-lab experiment run --experiment warm-index-reuse --campaign claude-full --include-real-agents --case warm-medium-complete-idempotent --out <dir>
```

A `--campaign` run requires a locally configured Codex or Claude provider CLI matching the selected preset's agent; it reports partial outcomes (`token-unavailable`, `failed`, `invalid-output`, `agent-unavailable`, `agent-limit-reached`, `timeout`) explicitly rather than treating them as success, and — on a completed run — additionally produces the campaign report/plots/screenshot/gallery presentation described in [ARCHITECTURE.md](ARCHITECTURE.md#real-agent-warm-index-campaign-architecture-v052-released) and [GALLERY.md](GALLERY.md).

See [METRICS.md](METRICS.md#warm-index-reuse-metrics) for the reported metrics and [WORKFLOWS.md](WORKFLOWS.md#real-agent-warm-index-campaign-v052) for the real-agent campaign procedure.

#### `incremental-change-staleness` (introduced in v0.6.2; four-treatment behavior in v0.6.3)

```text
my-dev-kit-lab experiment describe --experiment incremental-change-staleness
my-dev-kit-lab experiment run --experiment incremental-change-staleness [--out <dir>] [--case <ids>] [--kit-command <command>]
```

| Option | Allowed value or default |
|---|---|
| `--out <dir>` | Optional; installed default `<workspace>/lab-output/experiments/incremental-change-staleness/<target>/<run>/` |
| `--case <ids>` | Optional comma-separated subset of the six frozen scenario IDs (`U1`, `L2`, `E1`, `P1`, `I1`, `T1`); defaults to all six. Mutation instructions are never configurable — the packaged scenario catalog is the only mutation authority |
| `--kit-command <command>` | Accepted for `incremental-change-staleness` (in addition to `warm-index-reuse`); the my-dev-kit command used for every treatment index build. Defaults to `npx @dailephd/my-dev-kit@1.12.5`; a custom command must be my-dev-kit 1.12.5 or later |

This plugin is self-only: `experiment describe` lists `Supported targets: self`, and it does not accept `--target`, `--cases`, `--project-profiles`, `--benchmark-project`, `--campaign`, `--include-real-agents`, or any agent-matrix option; it always runs against the lab's own bundled benchmark projects. The generic `--target` option applies only to plugins that support external targets, and `experiment run --help` says so. There is no Lab `--refresh-scope` option: the plugin requests the upstream `changed-files` and `affected-neighborhood` refresh scopes internally per treatment.

Behavior:

- runs exactly four treatments per selected scenario, in fixed order: `stale-index`, `changed-files-refresh`, `affected-neighborhood-refresh`, then `full-refresh` (`experiment describe` shows these as the supported variants)
- each scenario applies its frozen declarative bounded mutation to four independent disposable target copies, proves pre/post controlled-source equivalence, bootstraps a trusted baseline index/snapshot/graph for every treatment before mutation, and clones each partial treatment's baseline into its own refreshed index directory; `stale-index` keeps its pre-mutation baseline with no post-mutation index invocation, the two partial treatments are refreshed in place by my-dev-kit with the requested scope, and `full-refresh` builds a distinct complete post-mutation index
- each partial treatment records what my-dev-kit actually did (`APPLIED_PARTIAL` or, truthfully, `FALLBACK_FULL`); a fallback is reported as not comparable as partial refresh
- exactly three reference comparisons against `full-refresh` are persisted: `stale-index`, `changed-files-refresh`, and `affected-neighborhood-refresh`
- outputs beneath the output root: `incremental-change-staleness-execution.json` (schema `my-dev-kit-lab-incremental-change-staleness-execution-v2`) and the plugin reports `report.json`, `report.txt`, and `report.html` with an incremental-change-staleness section (report schema `my-dev-kit-lab-incremental-change-staleness-report-v2`); historical V1 artifacts and reports remain readable
- the run status is `completed`, `partial`, or `failed` from actual scenario outcomes; a scenario's lifecycle failure is recorded as that scenario's own failed status without fabricating treatment evidence
- no `graph-diff` dependency, no numeric stale-risk score, no treatment winner or ranking, and no safety score are produced

```text
my-dev-kit-lab experiment run --experiment incremental-change-staleness --case U1,L2 --kit-command "node /path/to/my-dev-kit/bin/cli.js" --out <dir>
```

See [METRICS.md](METRICS.md#incremental-change-and-staleness-evidence-v062) (and its partial-refresh subsection) and [WORKFLOWS.md](WORKFLOWS.md#incremental-change-and-staleness-experiment-v062).

#### `context-window-scaling` (released in v0.7.0; `--synthetic-config` added in v0.7.1; local-repository mode added in v0.7.2)

```text
my-dev-kit-lab experiment describe --experiment context-window-scaling
my-dev-kit-lab experiment run --experiment context-window-scaling [--out <dir>] [--case <ids> | --synthetic-config <path> | --target <repository> --local-subject-config <path>] [--context-budgets <values>] [--kit-command <command>]
```

The plugin compares `raw-full-file` and `my-dev-kit-guided` on the bundled self-target case catalog by default, on caller-supplied deterministic synthetic repositories when `--synthetic-config` is given, or on an explicitly selected local Git repository when `--target` and `--local-subject-config` are given. Its default my-dev-kit command is `npx @dailephd/my-dev-kit@latest`.

| Option | Allowed value or default |
|---|---|
| `--out <dir>` | Optional output directory; when omitted the normal experiment default applies beneath `lab-output/experiments/` in a source checkout or the installed workspace |
| `--case <ids>` | Optional comma-separated filter over the bundled four-case catalog; mutually exclusive with `--synthetic-config` |
| `--synthetic-config <path>` | Optional path to a `SyntheticRepositoryConfigV1` JSON file (read-only user input). A relative path resolves against the invocation directory. May be given once, and is mutually exclusive with `--case` because the config owns the generated case set. Generated repositories are written beneath the selected experiment output directory (see below). Without it, the bundled four-case catalog and fixed project are used unchanged |
| `--target <repository>` | Only for external local-repository mode: the root of a local Git worktree. Without `--local-subject-config`, an explicit external `--target` is rejected; bundled and synthetic modes always run against the Lab itself |
| `--local-subject-config <path>` | Only with an external `--target`: path to a `LocalRepositorySubjectConfigV1` JSON file (read-only user input; a relative path resolves against the invocation directory; may be given once). Mutually exclusive with `--case` and `--synthetic-config` |
| `--context-budgets <values>` | Optional comma-separated budgets: `8k`, `16k`, `32k`, `64k`, or positive safe integers such as `12000`; defaults to `8k,16k,32k,64k`. Values are normalized, sorted, and duplicate values after normalization are rejected |
| `--kit-command <command>` | Optional command for my-dev-kit-guided retrieval; defaults to `npx @dailephd/my-dev-kit@latest` |

`--synthetic-config` is a command input selector, not a plugin config field: the plugin's own config remains `contextBudgets` and `kitCommand`, and `--synthetic-config` is rejected for every other experiment. An invalid, unreadable, or infeasible config, or a materialization collision, fails with exit code 1 before any execution artifact or report is written. With `--synthetic-config`, generated repositories live under `<experiment-output>/synthetic-repositories/<case-id>/` as `repository/` plus `synthetic-repository-manifest.json`. They are disposable runtime output, are not benchmark-project-profile entries, and the manifest is separate from the execution artifact (whose V1 schema is unchanged). A minimal config:

```json
{
  "schemaVersion": "1.0.0",
  "cases": [
    {
      "id": "synth-ts",
      "language": "typescript",
      "seed": "example",
      "sourceFileCount": 6,
      "moduleDepth": 3,
      "internalImportCount": 6,
      "symbolCount": 12,
      "testFileCount": 3,
      "taskLocality": "cross-module",
      "repeatedPatternCount": 3
    }
  ]
}
```

```text
my-dev-kit-lab experiment run --experiment context-window-scaling --synthetic-config <path-to-config.json> [--out <run-dir>]
```

**Subject modes.** Exactly one applies per run:

| Mode | How it is selected | Notes |
|---|---|---|
| Bundled | no `--target`, no `--synthetic-config`, no `--local-subject-config` | The bundled four-case catalog and fixed project, run against the Lab itself; `--case` may filter it |
| Synthetic | `--synthetic-config <path>` | Generated repositories beneath the output directory; `--target` and `--case` are rejected |
| External local repository | `--target <repository> --local-subject-config <path>` | A local Git worktree; `--case` and `--synthetic-config` are rejected |

Incompatible combinations exit with code 1 before any output is created: `--local-subject-config` without an external `--target`; an external `--target` without `--local-subject-config`; `--synthetic-config` together with `--target` or `--local-subject-config`; `--case` together with `--synthetic-config` or `--local-subject-config`; and a repeated `--local-subject-config`.

**External local-repository mode.** `--target` must be the root of a Git worktree with at least one commit (a subdirectory, a non-Git directory, or a repository without a commit is rejected, as is a target that is the Lab itself). The output directory must be outside the repository: an `--out` equal to or inside the target is rejected before anything is created. The repository is treated as read-only. Contexts are built only from regular files inside each case's `sourceRoots` that Git does not ignore (Git decides ignore status) and that are at most 1 MiB; ignored files, oversized files, symbolic links, and other special entries are excluded from both the raw and the my-dev-kit-guided treatments. The guided treatment uses the real my-dev-kit through the existing `--kit-command` (default `npx @dailephd/my-dev-kit@latest`), indexing the repository into private scratch state that is removed after the run. The repository state is compared before and after the run; a detected change fails the run and is not reverted.

A minimal `LocalRepositorySubjectConfigV1` file:

```json
{
  "schemaVersion": "1.0.0",
  "subjectId": "my-project",
  "cases": [
    {
      "id": "find-total",
      "title": "Find where the total is computed",
      "sourceRoots": ["src"],
      "query": "Where is the order total computed?",
      "expectedFiles": ["src/orders/total.ts"],
      "expectedSymbols": ["computeTotal"],
      "rawIncludeGlobs": ["src/**/*.ts"]
    }
  ]
}
```

`subjectId` is the logical name that appears in reports in place of the repository path. Optional case fields are `answerKey`, `expectedFacts`, `taskLocality`, `promptComplexityHint`, `projectComplexityRelevance`, and `notes`.

A successful external-local run writes `context-window-scaling-execution.json`, `report.json`, `report.txt`, `report.html`, and `local-repository-subject-manifest.json` to the output directory. Durable output omits the repository path, source text, and file names: exact file identities appear as numbered placeholders (`<redacted file 1>`, `<redacted file 2>`, ...), the artifact marks them with `fileIdentityRedaction: "redacted"`, the report target carries `privacyProjection: "external-local-redacted"`, and the report's output paths are bare file names with the output directory itself redacted. A placeholder means a file identity existed and was intentionally withheld; counts stay exact, an empty list still means no files, and `null` still means unavailable. The manifest records the logical subject ID, the full Git commit, the branch (or `null`), whether the working tree was dirty, the safety policy, the source roots, case IDs, and aggregate counts (eligible files and bytes, Git-ignored, oversized, symbolic-link, and other excluded entries, and an extension summary). A failed external-local run exits nonzero and prints a bounded error without paths or file names; it writes no report, execution artifact, or manifest.

The bundled and synthetic modes reject an external `--target` and unrelated common/plugin options. Budgets classify the estimated size of each constructed context; they do not truncate/rebuild contexts or configure a provider model window. Correctness comes from one deterministic fake-agent evaluation per treatment and is context-independent in the current harness. The execution artifact and reports contain bounded evidence, never context text. See [WORKFLOWS.md](WORKFLOWS.md#context-window-scaling-experiment-v070) and [METRICS.md](METRICS.md#context-window-scaling-evidence-v070).

#### `retrieval-precision-recall` (v0.8.0)

This surface is included in the current package (released in v0.8.0).

```text
my-dev-kit-lab experiment describe --experiment retrieval-precision-recall
my-dev-kit-lab experiment run --experiment retrieval-precision-recall [--out <dir>] [--case <ids>] [--benchmark-project <ids>] [--kit-command <command>]
my-dev-kit-lab experiment run --experiment retrieval-precision-recall --target <repository> --local-subject-config <path> [--out <dir>] [--kit-command <command>]
```

The plugin has one variant, `my-dev-kit-retrieval`. For each case it runs my-dev-kit search, then lookup, slice, and source for the top search candidate, and compares the retrieved files and symbols with the case answer key. No agent is invoked. Its default my-dev-kit command is `npx @dailephd/my-dev-kit@latest`.

**Bundled mode** (no `--target`) runs the frozen bundled 12-case corpus (`benchmarks/contracts/warm-index-benchmark-cases.json`, two benchmark projects) against the Lab itself, with one index per project and one retrieval per case.

| Option | Allowed value or default |
|---|---|
| `--out <dir>` | Optional output directory; the normal experiment default applies when omitted |
| `--case <ids>` | Optional comma-separated filter over the bundled case IDs; corpus order is preserved |
| `--benchmark-project <ids>` | Optional comma-separated filter over the bundled benchmark project IDs |
| `--kit-command <command>` | Optional my-dev-kit command; defaults to `npx @dailephd/my-dev-kit@latest` |

The production corpus and its project profiles are bundled and frozen: `--cases` and `--project-profiles` are not accepted for this plugin.

**External-local mode** runs the same lifecycle over an explicitly selected local Git repository. `--target <repository>` and `--local-subject-config <path>` (a `LocalRepositorySubjectConfigV1` file, the same schema described above for `context-window-scaling`) are required together; either one alone is rejected. `--case` and `--benchmark-project` are rejected in this mode because the config owns the case set. The output directory must be outside the repository, and the repository is treated as read-only.

Each case used for retrieval precision and recall needs deterministic ground truth: nonempty `expectedFiles` and `expectedSymbols`, and an `answerKey` whose `expectedFiles` and `expectedSymbols` agree with them, whose `expectedFacts` have unique IDs, and whose `expectedContextTargets` map those fact IDs to the files and symbols that must be retrieved (`factIds`), so fact coverage can be calculated without matching text. Cases with incomplete ground truth are rejected before execution. Each case's `sourceRoots` are indexed exactly as configured, with one private index per case.

A successful bundled run writes `retrieval-precision-recall-execution.json`, `report.json`, `report.html`, and `report.txt` to the output directory. A successful external-local run writes the same four files plus `local-repository-subject-manifest.json`. Runtime indexes and command stdout and stderr are private scratch state and are removed rather than kept in the final output.

A safety or execution failure in an external-local run exits nonzero and writes no normal artifact, report, or manifest family; partial private artifacts are not kept for inspection. One failing case fails the whole run. Durable external output redacts the repository path, file, symbol, and fact identities, case titles, and retrieval warning text, and keeps the numeric metrics. The console summary of a successful run can still show the physical output directory, so treat console output as local. Very long output or target paths can fail cleanly under platform path limits.

See [WORKFLOWS.md](WORKFLOWS.md#retrieval-precision-recall-experiment-v080) and [METRICS.md](METRICS.md#retrieval-precision-recall-evidence-v080).

#### `retrieval-query-strategy-comparison` (v0.8.1)

This surface is included in the current 0.8.1 package.

```text
my-dev-kit-lab experiment list
my-dev-kit-lab experiment describe --experiment retrieval-query-strategy-comparison
my-dev-kit-lab experiment run --experiment retrieval-query-strategy-comparison [--out <dir>] [--case <ids>] [--benchmark-project <ids>] [--kit-command <command>]
my-dev-kit-lab experiment run --experiment retrieval-query-strategy-comparison --target <local-git-repository> --local-subject-config <path> [--out <dir>] [--kit-command <command>]
```

`experiment list` and `experiment describe` report the plugin as `experimental`, schema version `1.0.0`, supported targets `self` and `external-local`, supported outputs `json`, `html`, `text`, and `artifact`, and exactly seven variants in this order: `keyword-search`, `symbol-lookup`, `graph-neighborhood`, `source-slice`, `data-model-graph`, `model-view-lineage`, and `combined-graph-guided`. The only required config field is `outDir`; the optional fields are `kitCommand`, `caseIds`, and `benchmarkProjects`.

The plugin compares seven deterministic my-dev-kit retrieval workflows without invoking any coding agent. `--strategies` is not supported for this plugin: all seven treatments always run for every selected case, and filters never narrow strategies. Its default my-dev-kit command is `npx @dailephd/my-dev-kit@latest`.

**Bundled mode** (neither `--target` nor `--local-subject-config`) runs the frozen bundled 12-case corpus (`benchmarks/contracts/warm-index-benchmark-cases.json`) against the Lab itself.

| Option | Allowed value or default |
|---|---|
| `--out <dir>` | Optional output directory; the normal experiment default applies when omitted |
| `--case <ids>` | Optional comma-separated filter over the bundled case IDs; corpus order is preserved |
| `--benchmark-project <ids>` | Optional comma-separated filter over the bundled benchmark project IDs; corpus order is preserved |
| `--kit-command <command>` | Optional my-dev-kit command; defaults to `npx @dailephd/my-dev-kit@latest` |

Any other flag is rejected rather than ignored, including `--strategies`, `--agents`, `--complexities`, `--cases`, `--project-profiles`, `--synthetic-config`, `--context-budgets`, `--campaign`, and `--timeout-ms`. The corpus and its project profiles are bundled and frozen.

**External-local mode** runs the same seven treatments over an explicitly selected local Git repository. `--target <local-git-repository>` and `--local-subject-config <path>` (a `LocalRepositorySubjectConfigV1` file, the schema described above for `context-window-scaling`) are required together: `--target` alone is rejected with "External retrieval-query-strategy-comparison targets require --local-subject-config.", and `--local-subject-config` alone is rejected with "--local-subject-config requires an external --target for retrieval-query-strategy-comparison." There is no precedence between the two modes, and an invalid combination fails before any experiment execution. `--case` and `--benchmark-project` are rejected in external mode because the local-subject config owns the case set; the accepted options are `--out`, `--target`, `--local-subject-config`, and `--kit-command`. The output directory must be outside the repository, and the repository is treated as read-only.

Each configured case needs the same complete ground truth as `retrieval-precision-recall`: nonempty `expectedFiles` and `expectedSymbols`, and an `answerKey` with unique `expectedFacts` and `expectedContextTargets` that map fact IDs to files and symbols (`factIds`). Cases with incomplete ground truth are rejected before execution. Each case's `sourceRoots` are indexed exactly as configured, with one private base index per configured case; all seven treatments for that case derive from that one base index, and the two semantic strategies use isolated copies of it.

**Outputs.** A successful bundled run writes `retrieval-query-strategy-comparison-execution.json` (execution evidence only), `retrieval-query-strategy-comparison-analysis.json` (the calculated scientific analysis), `report.json`, `report.txt`, and `report.html`. A successful external-local run writes the same five files plus `local-repository-subject-manifest.json`. No plots or screenshots are produced. Runtime indexes and command stdout and stderr are private scratch state and are removed rather than kept.

**Interpretation.** The report presents four task-type scopes in this order: `overall`, `localized`, `cross-module`, and `broad-change`. Each scope is labeled `unique-best` (exactly one nondominated strategy), `tradeoff` (several strategies remain nondominated and there is no single best), or `unavailable` (no matched complete cases). The Pareto-front list follows canonical strategy order and is not a ranking. See [METRICS.md](METRICS.md#retrieval-query-strategy-comparison-metrics-v081) for the definitions.

**Failure behavior.** A safety, privacy, or execution failure in an external-local run exits nonzero, prints a bounded safe description (codes, counts, and mutation kinds only), and writes no normal artifact, report, or manifest family. One failing case fails the whole run, although a single failed or partial strategy treatment is recorded as measurement evidence rather than failing the run. Durable external output withholds the repository path, file, symbol, and fact identities, semantic node IDs, warning text, and case titles while preserving the numeric results. The console summary of a successful run can still show the physical output directory, so treat console output as local.

See [WORKFLOWS.md](WORKFLOWS.md#retrieval-query-strategy-comparison-experiment-v081) and [ARCHITECTURE.md](ARCHITECTURE.md#retrieval-query-strategy-comparison-architecture-v081).

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
| `--experiment <dir>` | Required; a legacy controlled-experiment output directory, a `warm-index-reuse` plugin output directory, or a `context-window-scaling` run directory |
| `--out <dir>` | Required |

Input detection: the command recognizes a `context-window-scaling-execution.json` artifact and builds exactly three context-window charts; a malformed artifact fails. A `warm-index-reuse` `report.json` selects the four warm-index charts; a malformed warm-index report fails instead of falling back. Other directories use the legacy controlled-experiment plot path. These are the currently supported evidence families; the command does not claim support for every experiment plugin. A directory containing both context-window-scaling and warm-index evidence is ambiguous and fails rather than selecting a precedence.

Warm-index charts, written to `<out>/charts/` with `plot-data.json` and `plots-summary.json`:

- `warm-index-amortized-index-cost.svg` — amortized index build duration by task ordinal
- `warm-index-context-size.svg` — raw versus retrieved estimated context tokens
- `warm-index-correctness.svg` — fake-agent correctness by variant
- `warm-index-cumulative-token-usage.svg` — cumulative fake-agent total tokens (never estimated context tokens)

Unavailable metrics become skipped points with their reason; a chart with no available points renders "No comparable data available".

Context-window-scaling charts, written to `<out>/charts/` with `plot-data.json` and `plots-summary.json`:

- `context-window-scaling-context-size.svg`
- `context-window-scaling-success-rate-by-budget.svg`
- `context-window-scaling-correctness-by-budget.svg`

The context-size plot compares measured context estimates per case and treatment. The other plots use the selected numeric context budgets as the x-axis; unavailable aggregate values are skipped with their reason.

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

## Cross-tool compatibility handoffs

The canonical command-by-command composition map is [my-dev-kit ecosystem workflow section 9.15](https://github.com/dailephd/my-dev-kit/blob/main/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md#915-command-surface-compatibility-map).

Useful current combinations:

- `audit` and `security validate` findings can seed my-dev-kit search/lookup/slice/source investigation against the same target. They are candidate findings, not source-owner or deletion decisions.
- The `context-strategy-comparison` plugin owns raw-full-file versus my-dev-kit-guided experiments. The released stage-context strategies can consume my-dev-kit capsule/audit evidence and Orchestrator `WorkflowInstructionPacket` evidence through programmatic `v043StrategyInputs` / `v043RunAssurance` configuration. There are no installed CLI flags for arbitrary live stage-context artifact paths.
- `demo final --kit-command <command>` and `experiment run --experiment <id> --kit-command <command>` are the installed surfaces that explicitly accept a my-dev-kit-compatible command. `experiment run` accepts `--kit-command` for `warm-index-reuse` and `incremental-change-staleness`; it is rejected for `context-strategy-comparison`.
- Tutorial PNG screenshots are ordinary image files and may be deliberately selected as Observer external-reference inputs. The tutorial manifest, assertions, authentication state, and behavior do not transfer with the image.
- `report render --visualizations` and `gallery build --visualizations` expect Lab visualization-demo artifacts. Arbitrary my-dev-kit graph-view directories or Observer evidence roots are not documented drop-in replacements.
- Lab does not generically ingest Observer observations/comparisons/evaluations or Orchestrator export handoffs. Use a registered experiment/adapter or cite those results separately.

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
- `npm run verify:benchmarks` (distinct, non-test benchmark-fixture validation — this one runs as part of `npm run verify`; it also validates the dedicated `benchmarks/contracts/warm-index-benchmark-cases.json` corpus, its minimum suite coverage, and the project-profile task statistics derived from it)

## Experiment commands

Current implemented commands:

- `npm run experiment:list`
- `npm run experiment:describe -- --experiment context-strategy-comparison`
- `npm run experiment:run -- --experiment context-strategy-comparison`
- `npm run experiment:run -- --experiment warm-index-reuse`
- `npm run experiment:run -- --experiment incremental-change-staleness` (introduced in v0.6.2; four-treatment behavior in v0.6.3)
- `npm run experiment:run -- --experiment retrieval-precision-recall` (v0.8.0)
- `npm run experiment:run -- --experiment retrieval-query-strategy-comparison` (v0.8.1)
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

```bash
npm run experiment:describe -- --experiment warm-index-reuse
npm run experiment:run -- --experiment warm-index-reuse --cases benchmarks/contracts/warm-index-benchmark-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/warm-index-reuse
```

Deterministic one-case `retrieval-precision-recall` run from a source checkout, using the repository's fake my-dev-kit fixture (the case ID is one of the bundled warm-index cases):

```bash
npm run experiment:run -- --experiment retrieval-precision-recall --case warm-medium-import-dedupe --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/retrieval-precision-recall
```

`experiment:run` options for `warm-index-reuse` are the common options plus `--kit-command`; see [`warm-index-reuse`](#warm-index-reuse) above. `experiment:run` options for `incremental-change-staleness` are `--out`, `--case`, and `--kit-command` only; see [`incremental-change-staleness`](#incremental-change-staleness-v062) above.

`experiment:run` options for `context-strategy-comparison`:

| Option | Allowed value or default |
|---|---|
| `--experiment <id>` | Required; `context-strategy-comparison` for this table (`warm-index-reuse` options are documented above) |
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

- `context-strategy-comparison`, `warm-index-reuse`, `incremental-change-staleness`, `context-window-scaling`, `retrieval-precision-recall`, and `retrieval-query-strategy-comparison` are the registered plugins
- `context-strategy-comparison` and ordinary `warm-index-reuse` runs support optional `--target`; omitting it uses self mode
- `incremental-change-staleness` does not accept `--target` and always uses the bundled benchmark projects
- when a plugin supports an explicit target, experiment execution does not modify that target project

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
| `npm run generate-experiment-plots` | Produce plot data and deterministic SVG charts from a legacy controlled-experiment or `warm-index-reuse` output directory |
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

`npm run security:codeql` is a local CLI availability/integration preflight. An unavailable local CLI is reported as `skipped`; a skip or local CLI version success is not full-analysis evidence. Full CodeQL analysis is performed by [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml), and release readiness requires successful analysis and alert review for the exact candidate SHA.

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
