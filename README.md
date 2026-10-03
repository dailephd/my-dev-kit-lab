# my-dev-kit-lab

my-dev-kit-lab is the experiment, audit, and evidence companion for [my-dev-kit](https://www.npmjs.com/package/@dailephd/my-dev-kit). It helps users compare repository-context strategies, audit project health, validate CLI/package and Android security boundaries, and turn each run into reviewable reports and visual artifacts.

my-dev-kit provides local repository indexing and graph-guided retrieval. my-dev-kit-lab supplies the controlled benchmarks, agent adapters, metrics, security checks, and reports needed to evaluate when that retrieval is useful. Results are evidence for a specific target and configuration; they do not guarantee token savings or security.

Whole-ecosystem workflows are centralized in [my-dev-kit/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md](https://github.com/dailephd/my-dev-kit/blob/main/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md). Its [command-surface compatibility map](https://github.com/dailephd/my-dev-kit/blob/main/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md#915-command-surface-compatibility-map) documents which Lab outputs can safely seed my-dev-kit investigation, Observer reference work, or Orchestrator evidence, and which look-alike artifacts are not direct inputs.

The latest release is v0.7.1 (synthetic large-repository generator), and the published package and installed CLI are version 0.7.1. The previous release is v0.7.0 (context-window scaling), and v0.7.2 (local-repository experiments) is implemented in the current source but is unreleased, so it is not part of the published 0.7.1 package. The v0.4.5 context-integrity evaluation remains intentionally frozen against the published `@dailephd/my-dev-kit@1.10.4` and `@dailephd/my-dev-kit-orchestrator@1.2.3` contracts; those versions are historical validation baselines, not a statement that they are the ecosystem's current releases. See [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) for current state.

v0.4.6 adds a supported `my-dev-kit-lab` installed CLI router (`--help`, `--version`, `security validate`, `audit`, the `experiment` family, `report render`, `plots generate`, `gallery build`, `demo final`, and the historical direct final-demo invocation form), a writable lab workspace model kept separate from the installed package and the inspected target, and a permanent packed-tarball installation/execution acceptance gate (`npm run verify:packed-package`). See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) for status detail and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the runtime path model. The "Installed CLI" section below documents the shipped command surface; the source-checkout `npm run` workflow in Quickstart remains available for contributors.

## Current capabilities

- **Run context-strategy experiments:** compare `raw-full-file` with `my-dev-kit-guided` using deterministic fixtures or locally configured Codex and Claude CLIs.
- **Measure warm-index reuse (v0.5.0–v0.5.1, released):** the `warm-index-reuse` experiment plugin builds one my-dev-kit index per benchmark project, reuses it across that project's tasks, and compares every task with a matched `raw-full-file` baseline. Reports separate one-time index-build cost from per-task retrieval cost, show amortized index cost and cumulative measurements, and include deterministic fake-agent correctness and token evidence; `plots generate` renders four warm-index SVG charts. The v0.5.1 release adds a dedicated 12-task benchmark corpus (`benchmarks/contracts/warm-index-benchmark-cases.json`: six medium and six large/mixed tasks tagged `localized`, `cross-module`, or `broad-change`) for comparing warm-index behavior as task count grows. Estimated context tokens (a character-based context-size estimate) and fake-agent total tokens (simulated harness telemetry) are reported separately, and neither is provider billing telemetry.
- **Run selectable real-agent warm-index campaigns (v0.5.2, released):** `--campaign codex-full`, `claude-full`, or `codex-timeout-isolation` (with `--include-real-agents`) runs exactly one provider — Codex or Claude — against the exact raw and warm contexts the experiment already measured, over the frozen production corpus each preset owns. Provider outcomes (`completed`, `failed`, `timeout`, `invalid-output`, `agent-unavailable`, `agent-limit-reached`, `skipped`) are classified and reported separately from warm-index infrastructure status, so a campaign can complete its indexing/retrieval work even when provider evidence is partial or unavailable. A campaign run automatically produces the report, the same four warm-index SVG charts, and a three-item gallery (report, plots, bounded execution evidence). Its report screenshot is best-effort presentation evidence: unavailable browser runtime or failed capture is reported explicitly, no PNG is fabricated, and neither outcome fails an otherwise successful campaign. Legacy runs without `--campaign` keep the existing deterministic fake-agent, report-only behavior unchanged. See [docs/WORKFLOWS.md](docs/WORKFLOWS.md#warm-index-reuse-experiment) and [docs/METRICS.md](docs/METRICS.md#warm-index-reuse-metrics).
- **Record index freshness evidence (v0.6.0):** a warm-index run captures an index snapshot after its one index build — the exact indexed file set from the my-dev-kit index contract, each with SHA-256 content identity, size, and modified-time metadata, plus the my-dev-kit version and index-command evidence — and assesses freshness immediately before each task's warm retrieval as `fresh`, `stale`, `partially-stale`, or `unknown`. The evidence appears in `warm-index-execution.json` and in the existing `report.json`/`report.txt`/`report.html` warm-index reports. It is observational only: it covers only files the snapshot lists (not the whole repository), never changes retrieval, execution or provider status, and adds no CLI flag, metric, plot, gallery item, or reindex recommendation in v0.6.0. See [docs/METRICS.md](docs/METRICS.md#index-freshness-evidence-v060) and [docs/WORKFLOWS.md](docs/WORKFLOWS.md#warm-index-reuse-experiment).
- **Compare no-refresh, partial-refresh, and full-refresh retrieval after a controlled change (v0.6.3, released; retained in the current package):** the `incremental-change-staleness` experiment plugin runs six frozen controlled-change scenario families (unrelated-file, local-implementation, exported-symbol, public-API, import-graph, and test-only changes) against four disposable target copies — `stale-index` (no refresh), `changed-files-refresh` and `affected-neighborhood-refresh` (real partial refreshes performed by my-dev-kit 1.12.5 through `index --incremental --refresh-scope`, selected internally with no Lab-level flag), and `full-refresh` (a complete new post-change index, used as a comparison reference rather than a preferred treatment). Each partial treatment truthfully records whether upstream applied the requested partial scope or fell back to a full rebuild (`APPLIED_PARTIAL` or `FALLBACK_FULL`); a fallback is not counted as partial-refresh evidence. Three comparisons against `full-refresh` are persisted with retrieval, deterministic fake-agent correctness, and required-file evidence in `incremental-change-staleness-execution.json` (schema `my-dev-kit-lab-incremental-change-staleness-execution-v2`) and the existing `report.json`/`report.txt`/`report.html`; historical v0.6.2 (V1) artifacts stay readable. There is no winner, ranking, or safety claim, and the plugin is self-only (`--target` is not accepted). `--kit-command` also accepts `incremental-change-staleness` and now defaults to my-dev-kit 1.12.5. See [docs/WORKFLOWS.md](docs/WORKFLOWS.md) and [docs/METRICS.md](docs/METRICS.md).
- **Measure context-window scaling (v0.7.0, released):** the self-only `context-window-scaling` plugin compares `raw-full-file` and `my-dev-kit-guided` over 8k, 16k, 32k, 64k, or custom positive-integer estimated-token budgets. It records fit, utilization, deterministic fake-agent correctness/success, and omitted expected relevant files, with JSON/text/HTML reports and three SVG plots. `plots generate` reads `context-window-scaling-execution.json`. Token counts are a character-based estimate, not provider-tokenizer or billing data; fake-agent correctness is context-independent in the current harness. See [docs/WORKFLOWS.md](docs/WORKFLOWS.md), [docs/METRICS.md](docs/METRICS.md), and [docs/COMMANDS.md](docs/COMMANDS.md).
- **Run context-window scaling over synthetic repositories (v0.7.1, current release):** `context-window-scaling` uses the bundled fixed corpus by default, or `--synthetic-config <path>` (a `SyntheticRepositoryConfigV1` JSON file) to generate disposable deterministic TypeScript/Python repositories beneath the run output. The option is a command input selector, not plugin scientific config; it is mutually exclusive with `--case`, and the scientific semantics, execution artifact, reports, and plots are unchanged. See [docs/COMMANDS.md](docs/COMMANDS.md) and [docs/WORKFLOWS.md](docs/WORKFLOWS.md).
- **Run context-window scaling over a local Git repository (v0.7.2, implemented; unreleased):** `context-window-scaling` can also run against an explicitly selected local Git repository with `--target <repository> --local-subject-config <path>` (a `LocalRepositorySubjectConfigV1` JSON file). The Lab treats the repository as read-only and compares its state before and after the run, builds contexts only from files Git does not ignore (ignored, oversized (over 1 MiB), symbolic-link, and other unsafe entries are excluded), requires the output directory to be outside the repository, and keeps the repository path, source text, and file names out of durable artifacts (file identities appear as numbered `<redacted file N>` placeholders). A `local-repository-subject-manifest.json` records the logical subject ID, the full Git commit, the branch, and aggregate size metadata. This measures operational context fit only, not retrieval precision, recall, or ranking quality. It is available in the current source and not in the published 0.7.1 package. See [docs/COMMANDS.md](docs/COMMANDS.md) and [docs/WORKFLOWS.md](docs/WORKFLOWS.md).
- **Assess affected-neighborhood evidence (v0.6.1, released; retained in the current package):** using the baseline my-dev-kit graph of the same prepared warm index (loaded once per session), each task's confirmed modified or missing indexed files, and the baseline symbols those files contain, are mapped to graph nodes. The affected neighborhood is those seed nodes plus their direct one-hop neighbors (edges of any kind, either direction). The task's `expectedFiles` and file-scoped `expectedSymbols` are mapped to graph nodes and compared with that neighborhood, which yields six numeric warm-side metrics (`changedFileCount`, `changedSymbolCount`, `affectedNodeCount`, `affectedEdgeCount`, `taskOverlapCount`, `taskOverlapPercent`) plus categorical evidence: a `related`, `unrelated`, or `unknown` relationship and a `recommended`, `not-indicated`, or `unknown` `reindexRecommendation`. Incomplete evidence is reported as `unknown`, never as unrelated. The assessment is recorded additively in `warm-index-execution.json` and shown in the existing `report.json`/`report.txt`/`report.html` warm-index reports. It is observational only: retrieval, execution status, and provider status are unchanged, nothing is reindexed automatically, and no CLI flag, experiment plugin, plot, or gallery item was added. See [docs/METRICS.md](docs/METRICS.md#affected-neighborhood-metrics-v061) and [docs/WORKFLOWS.md](docs/WORKFLOWS.md#warm-index-reuse-experiment).
- **Audit repository health:** run conservative code-rot detectors for TypeScript/JavaScript, Python, Java, and Kotlin, or adapt security findings into the common audit report.
- **Validate CLI/package security:** inspect dependencies, package contents, path and subprocess boundaries, malformed inputs, optional static scanners, and bounded fuzz targets.
- **Validate Android projects:** run nineteen static checks by default, with Gradle operations, external tools, and network access available only through explicit opt-in flags.
- **Review evidence:** generate JSON and HTML reports, SVG plots, optional screenshots, visualization demos, and a static gallery.
- **Generate declarative browser tutorials:** validate and execute bounded local browser scenarios with WebM recording, step screenshots, SRT/VTT subtitles, Markdown, and a tutorial manifest. Locator-anchored pointer gestures (`pointer-click` and `pointer-drag`) operate using normalized fraction coordinates inside a single located surface, while existing `drag` remains element-to-element and `press` remains real keyboard input. `select-option` performs semantic native HTML `<select>` option selection by stable HTML value, executed through Playwright `Locator.selectOption({ value })` rather than keyboard navigation. Tutorial execution requires a compatible locally installed Chromium; see [docs/COMMANDS.md](docs/COMMANDS.md) and [docs/TUTORIAL.md](docs/TUTORIAL.md) for details.
- **Evaluate stage-context strategies:** compare the two legacy strategies against six additional bounded stage-context strategies — `architecture-context-only`, `architecture-plus-implementation-refresh`, `architecture-plus-implementation-and-test-refresh`, `full-workflow-library`, `bounded-workflow-instruction-packet`, and `combined-bounded-stage-context` — selected through programmatic configuration, not CLI flags. Each strategy's evidence is reported through bounded `report.json`, `report.html`, and `report.txt` output with an explicit `available`/`unavailable`/`not-applicable` metric-availability model and no composite score, grade, ranking, or winning strategy.
- **Evaluate the producer-readiness bridge (v0.4.4):** optionally extend `combined-bounded-stage-context` with the frozen my-dev-kit-orchestrator supplemental implementation/test-context packet and retrieval-report documents plus an observed readiness result, all supplied programmatically (there is no CLI flag), to measure owner, allocation, truncation-cause, supplemental/raw agreement, readiness-agreement, and criticality-overlay evidence without reimplementing upstream owner-selection, allocation, producer-parity, or readiness policy.
- **Evaluate context integrity (v0.4.5):** compare condition-aware producer evidence from my-dev-kit v1.10.4 (role condition coverage, allocation/spillover, required-evidence-loss) against my-dev-kit-orchestrator v1.2.3 run-integrity evidence (run-integrity gate, judge integrity, final-report eligibility, artifact lifecycle state), reporting agreement or contradiction between them rather than re-deriving a verdict. Evaluation runs against a frozen, hash-verified regression fixture pair — a byte-exact real historical failed run and a hand-distilled corrected-replay counterpart representing the same validated contracts — and is programmatic/test-driven only. `npm run report:context-integrity-smoke` renders both fixtures' reports for manual inspection; it takes no arguments and is a developer convenience, not a configurable evaluation CLI.

## Installed CLI

Installing or invoking the package (for example via `npm install -g @dailephd/my-dev-kit-lab` or `npx @dailephd/my-dev-kit-lab@<version>`) exposes one `my-dev-kit-lab` binary. Users do not need to clone this repository to use these commands. The installed CLI requires Node `>=24`.

```
my-dev-kit-lab --help
my-dev-kit-lab --version

my-dev-kit-lab security validate [options]
my-dev-kit-lab audit [options]

my-dev-kit-lab experiment list
my-dev-kit-lab experiment describe --experiment <id>
my-dev-kit-lab experiment run --experiment <id> [options]
my-dev-kit-lab experiment controlled [options]

my-dev-kit-lab report render [options]
my-dev-kit-lab plots generate [options]
my-dev-kit-lab gallery build [options]
my-dev-kit-lab demo final [options]
my-dev-kit-lab tutorial validate --scenario <path> [--target-contract <path>] [--json]
my-dev-kit-lab tutorial run --scenario <path> --target-contract <path> [--out <dir>] [--json]
```

A global `--workspace <path>` option, placed before the command, selects the writable lab workspace. The default workspace, used when `--workspace` is omitted, is `<home>/.my-dev-kit-lab`. Generated reports and experiment output are written under the workspace by default, never under the installed package directory or an inspected `--target` project. Explicit output paths (`--out`, and similar flags) keep their existing resolution behavior and are never redirected under the workspace.

The historical direct final-demo invocation form — the same flags `demo final` accepts, without the `demo final` prefix — continues to work for backward compatibility.

Low-level developer helpers (`security:deps`, `security:package`, `security:codeql`, `security:semgrep`, fuzz smoke, visualization demos, build/test/verify) are not part of the installed CLI. They remain source-checkout contributor workflows; see below.

See [docs/COMMANDS.md](docs/COMMANDS.md) for full command syntax and flags.

Tutorial runs keep the scenario source, disposable target, logs, browser recording, and generated artifacts separate. The canonical generic example is packaged at `examples/tutorial-browser/`; product-specific demo sites and scenarios remain owned by their product repositories.

## Quickstart (contributor / source-checkout workflow)

The commands in this section run from a cloned repository checkout and are the contributor/development workflow. They are not required to use the installed CLI documented above.

### Install

```bash
npm install
```

The same command works in PowerShell and `cmd.exe`.

### Build

```bash
npm run build
```

### Verify the installation

```bash
npm run test
npm run verify
```

`npm test` runs the complete test suite; `npm run verify` runs the remaining non-test verification gates. Running both is complete validation and does not execute the suite twice.

### Run the fake-agent final demo (deterministic, no external CLIs required)

```bash
npm run run-final-demo -- \
  --cases examples/token-savings-cases.json \
  --out lab-output/final-demo \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --agents fake-agent \
  --complexities short \
  --no-screenshot
```

```powershell
npm run run-final-demo -- `
  --cases examples/token-savings-cases.json `
  --out lab-output/final-demo `
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" `
  --agents fake-agent `
  --complexities short `
  --no-screenshot
```

```bat
npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot
```

The lab resolves Windows `.cmd` and `.ps1` CLI shims, supports command paths with spaces, and keeps generated artifacts inside the requested output directory.

This runs a full pipeline: controlled experiment → report → plots → visualization demos → gallery.

### Run a real-agent campaign (requires Codex or Claude CLI)

```bash
npm run run-controlled-experiment -- \
  --cases examples/real-agent-campaign-cases.json \
  --agents codex,claude \
  --strategies raw-full-file,my-dev-kit-guided \
  --complexities medium,multi-step \
  --out lab-output/real-agent-campaign \
  --include-real-agents \
  --continue-on-failure \
  --timeout-ms 240000
```

Real-agent runs require local Codex or Claude CLI setup and available usage capacity. Runs that time out, produce invalid output, or hit session limits are recorded as structured outcomes rather than failures.

### List, describe, and run experiment plugins

```bash
npm run experiment:list
npm run experiment:describe -- --experiment context-strategy-comparison
npm run experiment:run -- \
  --experiment context-strategy-comparison \
  --target /path/to/local/project \
  --agents fake-agent \
  --complexities short \
  --no-screenshot
```

```powershell
npm run experiment:list
npm run experiment:describe -- --experiment context-strategy-comparison
npm run experiment:run -- `
  --experiment context-strategy-comparison `
  --target "Z:\Users\newuser\Projects\my-dev-kit-v1" `
  --agents fake-agent `
  --complexities short `
  --no-screenshot
```

Run the warm-index reuse plugin over the dedicated expanded benchmark corpus released in v0.5.1, deterministically with the fake my-dev-kit fixture (omit `--kit-command` to use the default `npx @dailephd/my-dev-kit@latest`):

```bash
npm run experiment:run -- \
  --experiment warm-index-reuse \
  --cases benchmarks/contracts/warm-index-benchmark-cases.json \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --out lab-output/warm-index-reuse
npm run generate-experiment-plots -- --experiment lab-output/warm-index-reuse --out lab-output/warm-index-plots
```

The default cases file, `examples/token-savings-cases.json`, is a small compatibility corpus with one task per benchmark project and remains the default when `--cases` is omitted. For multi-task reuse, select the dedicated corpus explicitly as above: it runs six tasks for each of the two benchmark projects against one index per project. Add `--benchmark-project task-workflow-medium-ts` or `--case <id>` to narrow the selection.

Run a selectable real-agent warm-index campaign (v0.5.2; requires a locally available `codex` or `claude` CLI and `--include-real-agents`). A campaign preset owns its provider and corpus, so `--target`, explicit `--cases`/`--project-profiles`, and the agent-matrix flags below are rejected in campaign mode:

```bash
npm run experiment:run -- \
  --experiment warm-index-reuse \
  --campaign codex-full \
  --include-real-agents \
  --case warm-medium-complete-idempotent \
  --out lab-output/warm-index-campaign
```

This automatically writes `report.json`/`.txt`/`.html`, the four warm-index charts under `plots/`, an optional best-effort `report.png`, and a three-item `gallery/` (report, plots, bounded execution evidence) beneath `--out`. Screenshot capture failure remains `failed`, is reported in the command output and gallery warning, and does not fail an otherwise successful campaign or fabricate a PNG. Required experiment, report, plot, and gallery failures remain fatal. `--timeout-ms` overrides the preset's default per-agent timeout (240000 ms). `codex-timeout-isolation` narrows the corpus to three larger cases for exercising provider timeout/partial-outcome handling without running the full 12-case corpus.

For experiment plugins that support explicit targets — `context-strategy-comparison` and ordinary (non-campaign) `warm-index-reuse` runs — omitting `--target` uses self mode against my-dev-kit-lab. When those plugins receive `--target <path>`, the lab remains the tool root and the target project is inspected separately. `incremental-change-staleness` does not accept `--target`; it always runs against the lab's bundled benchmark projects. Generated experiment outputs stay under lab-controlled output directories by default, not inside an inspected target project.

---

## Where to find outputs

| Artifact | Location |
|---|---|
| Experiment summary | `lab-output/<experiment>/experiment-summary.json` |
| All runs | `lab-output/<experiment>/experiment-runs.json` |
| Strategy comparisons | `lab-output/<experiment>/experiment-comparisons.json` |
| HTML report | `lab-output/<report>/experiment-report.html` |
| Report JSON | `lab-output/<report>/experiment-report.json` |
| Report screenshot | `lab-output/<report>/experiment-report.png` |
| Plugin experiment report JSON | `lab-output/experiments/<plugin>/<target>/<run>/report.json` |
| Plugin experiment report HTML | `lab-output/experiments/<plugin>/<target>/<run>/report.html` |
| Plugin experiment report text | `lab-output/experiments/<plugin>/<target>/<run>/report.txt` |
| Warm-index execution evidence | `<experiment out>/warm-index-execution.json` (plus `indexes/`, `commands/`, and `agents/` beneath the same output root); the v0.6.0 artifact carries project-level `indexSnapshot` and per-task `indexFreshness` evidence; the v0.6.1 package adds per-task `affectedNeighborhood` evidence |
| Warm-index campaign presentation (v0.5.2) | `<experiment out>/plots/` (four charts), `<experiment out>/report.png` (best-effort), `<experiment out>/gallery/gallery-manifest.json` and `gallery-index.html` — automatic for `--campaign` runs only |
| Plot data | `lab-output/<plots>/plot-data.json` |
| SVG charts | `lab-output/<plots>/charts/*.svg` |
| Gallery manifest | `lab-output/<gallery>/gallery-manifest.json` |
| Gallery index | `lab-output/<gallery>/gallery-index.html` |
| Audit reports | `reports/audits/<type>/code-rot-audit.txt` and `.json` |
| Security reports | `reports/security/<prefix>-security-validation.txt` and `.json` |

---

## How to read the main report

Open `experiment-report.html` in a browser. The report shows:

- **Project profile** — benchmark project name, language mix, complexity score, and file tree
- **Benchmark tasks** — task descriptions and answer keys
- **Strategy comparisons** — paired `raw-full-file` vs `my-dev-kit-guided` runs per case
- **Correctness scores** — deterministic answer-key scoring (not semantic LLM judging)
- **Token usage** — estimated or reported token totals per run
- **Token savings** — positive means my-dev-kit used fewer tokens; negative means it used more
- **Duration** — wall-clock time per run
- **Status** — completed, timeout, invalid-output, or limit-reached
- **Warnings and limitations** — notes on missing token totals or partial results

See [docs/METRICS.md](docs/METRICS.md) for full metric definitions.

---

## Current limitations

- Token savings shown in fake-agent runs are based on estimated character counts, not provider billing telemetry
- Claude and Codex token totals are used only when the CLI/run exposes them; missing provider token evidence stays explicitly unavailable (never zero, and never substituted with an estimated context-token count)
- Codex and Claude campaign runs can produce timeouts, invalid-output, agent-unavailable, or agent-limit-reached outcomes; these are structured provider states, not warm-index infrastructure failures
- Small projects may make raw-full-file cheaper than my-dev-kit-guided; larger localized tasks are where my-dev-kit is expected to become more useful
- The generic experiment-plugin framework has four registered plugins: `context-strategy-comparison`, `warm-index-reuse`, `incremental-change-staleness`, and `context-window-scaling`. The v0.7.0 context-window-scaling plugin is released; v0.7.1 lets it also run over caller-supplied synthetic repositories; v0.7.2 (unreleased) lets it run over an explicitly selected local Git repository; retrieval precision/recall and agent-success plugins remain planned.
- `warm-index-reuse` without `--campaign` still uses the deterministic fake agent only. With `--campaign`, exactly one real provider (Codex or Claude) runs per campaign preset — there is no multi-agent matrix, retry, provider switching, or scheduler. The v0.5.1 expanded corpus is deterministic fake-agent benchmark evidence when run without `--campaign`. No warm-index mode calculates a token-savings percentage, break-even task, winner, or ranking, and component-duration sums are not wall-clock latency
- The current release does not guarantee token savings; it produces auditable evidence for specific cases, targets, agents, and strategies
- Context-window scaling uses estimated tokens (`ceil(characters / 4)`) and experiment budgets, not actual provider tokenizer or model-window limits. Its deterministic fake-agent correctness check does not measure semantic sensitivity to the supplied context.
- Released v0.6.1 affected-neighborhood evidence is bounded to the baseline graph of the prepared index and to the snapshot-represented files: a changed symbol means the symbol was present in a confirmed changed indexed file, not that its own text was proven to change; `not-indicated` means only that this bounded analysis found no supporting evidence for reindexing, not that skipping a reindex is safe; unresolved or ambiguous expected symbols keep a task at `unknown` rather than unrelated
- v0.6.3 partial-refresh evidence is scoped to the executed deterministic scenarios and the configured my-dev-kit 1.12.5-or-later tool. A partial treatment can fall back to a full rebuild and is then reported as not comparable as partial refresh, so an applied partial refresh in one run does not guarantee the next; `no-observed-regression-relative-to-full` is not a safety claim, and full refresh is a reference rather than a winner. Correctness remains deterministic fake-agent evidence, and `incremental-change-staleness` accepts no external `--target`.
- Provider telemetry dashboards, semantic LLM judging, and cloud API billing integration are not yet implemented
- The six new stage-context strategies have no CLI flags yet, are configured programmatically, and do not yet include plots, screenshots, or gallery integration
- The published upstream artifacts the stage-context strategies read do not expose considered-but-unselected reads or unnecessary-read evidence; those metrics report `unavailable` rather than zero
- The v0.4.4 producer-readiness bridge is released. All bridge inputs are programmatic — there is no CLI flag. The coordinated upstream releases my-dev-kit@1.10.3 and orchestrator@1.2.2 were verified published before lab publication.
- The v0.4.5 context-integrity evaluation is released. It has no CLI flags, no plots/screenshot/gallery integration, and produces no composite score, grade, ranking, or winner. Its corrected-replay fixture is a hand-distilled representation of the validated my-dev-kit v1.10.4 and my-dev-kit-orchestrator v1.2.3 contracts, not a live capture of a complete ten-stage workflow. The orchestrator agreement evidence does not read a literal upstream `promptMode` field; `stageMayRenderNormalPrompt`, derived from structured blocked-stage evidence, is the bounded substitute used instead.
- v0.4.7 added declarative browser tutorial validation and execution with bounded actions/assertions, persistent Chromium sessions, WebM, screenshots, SRT/VTT, Markdown, and `tutorial-manifest.json`. Chromium is a separate local runtime prerequisite; the package does not download browser binaries automatically. Gallery consumption remains future scope.
- v0.4.8 added `pointer-click` and `pointer-drag` for normalized fraction positions inside a single located element. Existing `drag` remains element-to-element between source and target locators.
- v0.4.9 `select-option` identifies an option by HTML value only: label selection, index selection, multi-select arrays, and automatic selector fallback are not supported, and there is no keyboard (`ArrowDown`/`Enter`) fallback. Native popup/menu traversal is not animated. Chromium remains a separately installed local runtime prerequisite; neither package installation nor tutorial execution downloads it automatically.
- v0.5.2 (released) selectable real-agent warm-index campaigns run exactly one provider per preset (`codex-full`, `claude-full`, `codex-timeout-isolation`); there is no retry, provider switching, or scheduler. Correctness remains deterministic answer-key scoring, not semantic LLM judging. No composite score, winner, ranking, or break-even task is calculated for campaign or legacy warm-index runs.

---

## Security validation

`npm run security:validate` (contributor/source-checkout) and `my-dev-kit-lab security validate` (installed CLI) both call the same standalone security-validation command owner. It checks local CLI/package boundaries and can inspect another local project with `--target <path>`. The generic audit command can reuse those results through `--types security`, but it does not replace the standalone validator or its reports.

Android validation uses `--profile android`. Its default path is static and non-destructive: it starts zero Gradle processes, zero external tools, and zero network operations. Only confirmed `SecurityFinding` records can become audit issues; Android `CandidateEvidence` remains review-only evidence.

Optional local scanners are reported as `skipped` when unavailable, never as passed. This local availability rule does not make CodeQL coverage optional for release readiness: the exact candidate must pass the repository-controlled GitHub CodeQL workflow and have its Code Scanning alerts reviewed. The framework does not provide runtime isolation proof, device or APK/AAB analysis, signing verification, Play Console validation, automatic fixes, or manual pentesting. Manual pentest remains deferred until post-v1/version TBD.

See [COMMANDS.md](docs/COMMANDS.md) for exact syntax and [Security Validation Framework](docs/security-validation-framework.md) for checks, evidence semantics, verdicts, and limitations.

---

## License

MIT License. See [LICENSE](LICENSE) for the full text.

---

## Support

my-dev-kit-lab is an independent project by dailephd LLC, developed and maintained by Dai Le.

If this project helps your workflow, you can support continued development through GitHub Sponsors or PayPal:

- [Sponsor on GitHub](https://github.com/sponsors/dailephd)
- [Support via PayPal](https://paypal.me/daile88)

Support is optional and does not affect access to the project.

---

## Documentation

- [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) — product purpose and target users
- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) — implemented, planned, validated, blocked, and next state
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current components, ownership, flows, and invariants
- [docs/WORKFLOWS.md](docs/WORKFLOWS.md) — step-by-step workflows with diagrams
- [docs/COMMANDS.md](docs/COMMANDS.md) — all commands with options and examples
- [docs/TUTORIAL.md](docs/TUTORIAL.md) — first-run walkthrough
- [docs/METRICS.md](docs/METRICS.md) — metric definitions and interpretation
- [docs/ROADMAP.md](docs/ROADMAP.md) — versioned plans, dependencies, exclusions, and acceptance criteria
- [docs/GALLERY.md](docs/GALLERY.md) — gallery output explained
- [docs/security-validation-framework.md](docs/security-validation-framework.md) — security evidence, verdicts, and safety boundaries
