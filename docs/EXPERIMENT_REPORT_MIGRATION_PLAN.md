# Experiment Report Migration Plan

## Purpose

This document audits the current `my-dev-kit-lab` Milestone 1 MVP and defines the migration path for upgrading it into a controlled coding-agent experiment framework.

Update after Follow-up Prompt 2:

- benchmark project profiles were added in `benchmarks/contracts/benchmark-project-profiles.json`
- benchmark cases now include answer keys and expected facts
- deterministic file-tree metadata and complexity metrics are validated by the existing benchmark verification path
- prompt variants, agent adapters, controlled experiment execution, correctness scoring, report redesign, plots, visualization demos, screenshot changes, and gallery upgrades remain future work

Update after Follow-up Prompt 3:

- prompt variants were added under `src/prompts`
- raw-full-file and my-dev-kit-guided prompt generation are implemented
- prompt complexity metrics are computed with the existing token-count utility
- `generate-prompt-variants` writes deterministic preview artifacts
- agent adapters, controlled experiment execution, correctness scoring, report redesign, plots, visualization demos, screenshot changes, and gallery upgrades remain future work

Update after Follow-up Prompt 4:

- `src/agents` now contains the canonical agent adapter layer
- `fake-agent`, Codex, and Claude adapters produce normalized `AgentRunResult` artifacts
- real CLI adapters reuse `src/core/runMeasuredCommand.ts`
- `run-agent-prompt` runs one generated prompt through one adapter for smoke validation
- controlled experiment execution, correctness scoring, report redesign, plots, visualization demos, screenshot changes, and gallery upgrades remain future work

Update after Follow-up Prompt 4.5:

- Windows npm CLI shim resolution was added to the shared core command runtime
- Codex and Claude adapters continue to reuse `src/core/runMeasuredCommand.ts`
- `.cmd` wrappers are preferred over `.ps1` wrappers when both exist
- `.ps1` wrappers are invoked only through controlled PowerShell arguments
- no controlled experiment runner, correctness scoring, report redesign, screenshots, plots, or gallery upgrades were added

Update after Follow-up Prompt 5:

- controlled experiment execution was added under `src/evaluation`
- `run-controlled-experiment` runs selected cases, agents, strategies, and prompt complexity levels
- correctness scoring is deterministic and uses benchmark answer keys
- raw-full-file and my-dev-kit-guided runs are paired for correctness, token, and duration comparisons
- real-agent unavailability, usage or session limits, timeouts, failures, and invalid output are structured run outcomes
- final report redesign, screenshots, plots, visualization demos, and gallery upgrades remain future work

This is a migration of the existing MVP.

It is not a greenfield redesign.

It must not create a parallel evaluator, report system, screenshot system, gallery system, benchmark system, or command runtime.

## 1. Current architecture inventory

### Benchmark layer

Files inspected:

- `benchmarks/contracts/todo-behavior.md`
- `benchmarks/contracts/todo-benchmark-case.json`
- `benchmarks/projects/README.md`
- `benchmarks/projects/todo-ts/*`
- `benchmarks/projects/todo-python/*`
- `benchmarks/projects/todo-js/*`
- `benchmarks/projects/todo-mixed-ts-py/*`
- `scripts/verify-benchmarks.ts`
- `tests/benchmarks/benchmarkProjects.spec.ts`
- `tests/benchmarks/benchmarkContracts.spec.ts`
- `tests/benchmarks/benchmarkBehaviorParity.spec.ts`
- `tests/scripts/verifyBenchmarks.spec.ts`

Current responsibility:

- define deterministic benchmark behavior
- store small benchmark projects
- validate project structure and contract coverage
- enforce parity across language variants

Current output artifacts:

- benchmark validation console output
- benchmark case JSON contract

Tests that cover it:

- contract parsing and uniqueness
- project structure checks
- parity checks
- script-level verification tests

Recommendation:

- extend

Reason:

- this is already the canonical benchmark layer
- later benchmark metadata, project complexity, file trees, and answer keys should be added here rather than moved elsewhere

### Report layer

Files inspected:

- `src/report/types.ts`
- `src/report/renderHtmlReport.ts`
- `src/report/writeReportArtifacts.ts`
- `src/report/index.ts`
- `tests/report/renderHtmlReport.spec.ts`
- `tests/report/writeReportArtifacts.spec.ts`

Current responsibility:

- define report input types
- normalize report payloads
- render generic HTML reports
- write JSON and HTML report artifacts

Current output artifacts:

- `*.json`
- `*.html`

Tests that cover it:

- deterministic HTML rendering
- escaping and safety
- artifact writing
- warning propagation

Recommendation:

- extend

Reason:

- this is already the canonical report renderer and artifact writer
- experiment reporting should feed richer structured input into this layer instead of replacing it

### Screenshot layer

Files inspected:

- `src/screenshot/types.ts`
- `src/screenshot/captureReportScreenshot.ts`
- `src/screenshot/index.ts`
- `tests/screenshot/captureReportScreenshot.spec.ts`

Current responsibility:

- optionally capture PNG screenshots from generated local HTML reports

Current output artifacts:

- `*.png`
- warning or failure state metadata

Tests that cover it:

- skipped behavior when Playwright is unavailable
- captured behavior with mocked runtime
- failure behavior for missing HTML or runtime issues

Recommendation:

- keep unchanged for runtime behavior

Reason:

- the screenshot system is already generic and report-driven
- experiment reporting should reuse it exactly as-is

### Evaluation layer

Files inspected:

- `src/evaluation/types.ts`
- `src/evaluation/readEvaluationCases.ts`
- `src/evaluation/runRawFullFileBaseline.ts`
- `src/evaluation/runMyDevKitRetrieval.ts`
- `src/evaluation/compareTokenSavings.ts`
- `src/evaluation/writeTokenSavingsArtifacts.ts`
- `src/evaluation/renderTokenSavingsReportInput.ts`
- `src/evaluation/index.ts`
- `tests/evaluation/*`
- `tests/integration/tokenSavingsEvaluation.spec.ts`

Current responsibility:

- parse evaluation cases
- run raw full-file baseline
- run external my-dev-kit retrieval
- compare token/context savings
- map evaluation results into report input
- write summary, runs, and report artifacts

Current output artifacts:

- `token-savings-summary.json`
- `token-savings-runs.json`
- `token-savings-report.html`
- `token-savings-report.png`
- measured command stdout/stderr/telemetry files

Tests that cover it:

- case parsing
- raw baseline behavior
- my-dev-kit retrieval behavior
- token-savings comparison
- token-savings artifact writing
- integration CLI flow

Recommendation:

- extend and partially refactor in place

Reason:

- this is already the canonical evaluator runtime
- future controlled experiments belong here
- some file names are token-savings-specific and may later need generalization, but the runtime path should remain singular

### Command layer

Files inspected:

- `src/commands/captureDemoReport.ts`
- `src/commands/evaluateTokenSavings.ts`
- `src/commands/runLabDemo.ts`
- `scripts/capture-demo-report.ts`
- `scripts/evaluate-token-savings.ts`
- `scripts/run-lab-demo.ts`
- `tests/commands/*`
- `tests/integration/runLabDemoCommand.spec.ts`
- `tests/e2e/*`

Current responsibility:

- provide CLI entrypoints over report, evaluation, screenshot, and gallery layers

Current output artifacts:

- command console summaries
- report/evaluation/gallery artifacts

Tests that cover it:

- report command
- token-savings command
- lab-demo command
- integration and E2E command flows

Recommendation:

- extend

Reason:

- the current commands already orchestrate the runtime layers
- future experiment workflows should evolve from these commands instead of adding a second runtime path

### Gallery layer

Files inspected:

- `src/gallery/types.ts`
- `src/gallery/writeGalleryManifest.ts`
- `src/gallery/index.ts`
- `tests/gallery/writeGalleryManifest.spec.ts`
- `docs/GALLERY.md`

Current responsibility:

- package generated report/evaluation artifacts into a deterministic gallery manifest

Current output artifacts:

- `gallery-manifest.json`

Tests that cover it:

- relative artifact path handling
- screenshot presence/absence handling
- required artifact validation

Recommendation:

- extend

Reason:

- gallery manifest is already the canonical published artifact index
- experiment reports, plot data, and visualization demos should be added to it rather than published through a second manifest system

### Examples layer

Files inspected:

- `examples/demo-report-input.json`
- `examples/token-savings-cases.json`
- `examples/lab-demo-cases.json`

Current responsibility:

- provide deterministic example inputs for current commands

Current output artifacts:

- JSON fixtures only

Tests that cover it:

- command and integration flows consume them directly

Recommendation:

- extend

Reason:

- future experiment-case fixtures and report examples should live here

### Tests layer

Files inspected:

- `tests/benchmarks/*`
- `tests/core/*`
- `tests/report/*`
- `tests/screenshot/*`
- `tests/evaluation/*`
- `tests/commands/*`
- `tests/gallery/*`
- `tests/integration/*`
- `tests/e2e/*`

Current responsibility:

- protect deterministic behavior across benchmark, runtime, rendering, command, and gallery layers

Current output artifacts:

- test pass/fail output

Tests that cover it:

- all current Milestone 1 flows

Recommendation:

- keep and extend

Reason:

- the current suite already protects the MVP architecture and must remain the regression base

### Docs layer

Files inspected:

- `README.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/ARCHITECTURE.md`
- `docs/WORKFLOWS.md`
- `docs/ROADMAP.md`
- `docs/CURRENT_STATE.md`
- `docs/COMMANDS.md`
- `docs/TUTORIAL.md`
- `docs/GALLERY.md`
- `docs/coding_generation_guideline.md`

Current responsibility:

- describe Milestone 1 scope, architecture, workflows, commands, tutorial, and current state

Current output artifacts:

- documentation only

Tests that cover it:

- indirect coverage via commands and output expectations

Recommendation:

- extend minimally now, then extend per follow-up prompt

Reason:

- docs already represent the single source of operator intent and should keep pace with the staged migration

## 2. Current data flow

Actual current Milestone 1 flow:

1. benchmark contracts and sample projects define the fixture space
2. `scripts/verify-benchmarks.ts` validates benchmark integrity
3. `src/evaluation/readEvaluationCases.ts` reads case definitions from `examples/*.json`
4. `src/evaluation/runRawFullFileBaseline.ts` expands `rawIncludeGlobs` and concatenates full-file context
5. `src/evaluation/runMyDevKitRetrieval.ts` runs external `my-dev-kit` commands in sequence:
   - `index`
   - `search`
   - `lookup`
   - `slice`
   - `source`
6. `src/core/runMeasuredCommand.ts` captures stdout, stderr, duration, exit code, and telemetry files for each command
7. `src/evaluation/compareTokenSavings.ts` computes per-case and aggregate token-savings metrics
8. `src/evaluation/renderTokenSavingsReportInput.ts` converts evaluation output into a generic `LabReportInput`
9. `src/evaluation/writeTokenSavingsArtifacts.ts` writes:
   - summary JSON
   - runs JSON
   - HTML report
10. `src/screenshot/captureReportScreenshot.ts` optionally captures a PNG from the generated report HTML
11. `src/gallery/writeGalleryManifest.ts` packages the resulting artifacts into `gallery-manifest.json`
12. `src/commands/runLabDemo.ts` orchestrates benchmark validation, token evaluation, report writing, screenshot capture, and gallery manifest generation

Current command path summary:

- `capture-demo-report` drives generic report + screenshot
- `evaluate-token-savings` drives evaluation + report + screenshot
- `lab-demo` drives benchmark validation + evaluation + report + screenshot + gallery

## 3. Target data flow

Target controlled experiment flow:

1. benchmark project metadata
2. project file tree
3. project complexity metrics
4. benchmark task answer key
5. prompt variant generation
6. agent adapter execution
7. raw-full-file strategy run
8. my-dev-kit-guided strategy run
9. correctness scoring
10. token and timing comparison
11. report data model assembly
12. HTML report rendering
13. optional screenshot capture
14. plot-ready data generation
15. visualization command artifact capture
16. gallery manifest publication

Required migration constraint:

- steps 11 through 16 must continue to reuse the existing report, screenshot, and gallery layers

Target architecture reading:

- current token-savings flow becomes the first experiment strategy comparison
- future agent and correctness layers extend the same evaluator spine
- gallery remains the final published artifact index

## 4. Type migration map

- File: `src/report/types.ts`
  - Type: `LabReportInput`
  - Current purpose: generic structured report payload for HTML and JSON output
  - Proposed future role: remain the canonical generic report input
  - Action: extend
  - Reason: experiment reports need richer sections, but they should still feed the same renderer

- File: `src/report/types.ts`
  - Type: `LabReportStep`
  - Current purpose: workflow step summaries with status and optional timing
  - Proposed future role: keep as the canonical step summary type
  - Action: keep
  - Reason: experiment workflow stages still need step summaries

- File: `src/report/types.ts`
  - Type: `LabReportMetric`
  - Current purpose: generic report metric cards
  - Proposed future role: keep and extend with optional formula metadata reference or richer interpretation text
  - Action: extend
  - Reason: experiment reports need correctness, tokens, time, and complexity metrics

- File: `src/report/types.ts`
  - Type: `LabReportArtifact`
  - Current purpose: file artifact listing
  - Proposed future role: remain canonical artifact listing type
  - Action: extend
  - Reason: experiment reports will reference prompt artifacts, plots, run outputs, and visualization outputs

- File: `src/evaluation/types.ts`
  - Type: `EvaluationCaseInput`
  - Current purpose: token-savings evaluation case definition
  - Proposed future role: become the base benchmark task definition for experiments
  - Action: extend
  - Reason: new benchmark metadata, answer keys, and project-profile references belong here first

- File: `src/evaluation/types.ts`
  - Type: `EvaluationCase`
  - Current purpose: resolved-case runtime shape
  - Proposed future role: remain the resolved runtime case
  - Action: extend
  - Reason: experiment execution still needs a resolved case object

- File: `src/evaluation/types.ts`
  - Type: `RawFullFileBaselineResult`
  - Current purpose: raw full-file context collection result
  - Proposed future role: become one `ContextStrategy` run output variant
  - Action: extend or fold into a broader run result shape
  - Reason: future experiments compare strategies and agents, not just raw text size

- File: `src/evaluation/types.ts`
  - Type: `MyDevKitRetrievalResult`
  - Current purpose: my-dev-kit retrieval context and command trace result
  - Proposed future role: become the my-dev-kit-guided `ContextStrategy` run output variant
  - Action: extend or fold into a broader run result shape
  - Reason: the command trace and selected node metadata should remain reusable

- File: `src/evaluation/types.ts`
  - Type: `TokenSavingsCaseResult`
  - Current purpose: per-case token comparison
  - Proposed future role: become a narrower view derived from a broader experiment comparison
  - Action: split
  - Reason: future comparisons also need correctness, prompt complexity, timing, and agent metadata

- File: `src/evaluation/types.ts`
  - Type: `TokenSavingsSummary`
  - Current purpose: aggregate token summary
  - Proposed future role: become one part of an experiment summary
  - Action: split
  - Reason: aggregate experiment summary must answer multiple questions, not token savings only

- File: `src/evaluation/types.ts`
  - Type: `TokenSavingsRunRecord`
  - Current purpose: persisted record of one evaluation case
  - Proposed future role: evolve into the canonical persisted experiment run record
  - Action: extend then possibly rename later with compatibility
  - Reason: it already stores case, raw baseline, my-dev-kit data, telemetry references, and comparison

- File: `src/evaluation/types.ts`
  - Type: `TokenSavingsArtifacts`
  - Current purpose: artifact bundle returned by the token-savings workflow
  - Proposed future role: become a broader experiment-artifact bundle
  - Action: extend then possibly rename later with compatibility
  - Reason: report, screenshot, and artifact path bundling should remain singular

- File: `src/gallery/types.ts`
  - Type: `GalleryManifest`
  - Current purpose: published artifact index
  - Proposed future role: remain canonical gallery index
  - Action: extend
  - Reason: plots, experiment reports, and visualization demos should be additional items or fields in the same manifest

- File: `src/screenshot/types.ts`
  - Type: `ScreenshotCaptureResult`
  - Current purpose: result of optional PNG generation
  - Proposed future role: remain canonical screenshot result
  - Action: keep
  - Reason: experiment report screenshots are still just screenshots of generated HTML

- File: `src/core/runMeasuredCommand.ts`
  - Type: `MeasuredCommandResult`
  - Current purpose: shared command telemetry type
  - Proposed future role: remain the canonical command telemetry record
  - Action: keep and extend if needed
  - Reason: agent runtime timing and visualization command timing should reuse this shared structure

Proposed future types to document now and implement later:

- `BenchmarkProjectProfile`
  - Suggested location: `src/evaluation/types.ts` initially, or `benchmarks/contracts` JSON plus runtime type
  - Purpose: project description, root, language mix, canonical benchmark metadata

- `ProjectComplexityMetrics`
  - Suggested location: `src/evaluation/types.ts` initially
  - Purpose: file counts, line counts, language counts, prompt-size-impact metrics

- `BenchmarkTaskAnswerKey`
  - Suggested location: `src/evaluation/types.ts` or benchmark contract schema types
  - Purpose: deterministic correctness targets

- `PromptVariant`
  - Suggested location: `src/prompts/types.ts`
  - Purpose: raw-full-file and my-dev-kit-guided prompt definitions

- `PromptComplexityMetrics`
  - Suggested location: `src/prompts/types.ts`
  - Purpose: prompt length and structural complexity measurements

- `ContextStrategy`
  - Suggested location: `src/evaluation/types.ts`
  - Purpose: explicit strategy enum such as `raw_full_file` and `my_dev_kit_guided`

- `AgentAdapter`
  - Suggested location: `src/agents/types.ts`
  - Purpose: expandable adapter contract for Codex, Claude, and fake agents

- `AgentRunResult`
  - Suggested location: `src/agents/types.ts`
  - Purpose: output of a single agent run, including text output, timing, telemetry, and artifact refs

- `AgentTokenUsage`
  - Suggested location: `src/agents/types.ts`
  - Purpose: reported or estimated prompt/completion token counts with source labeling

- `ExperimentRun`
  - Suggested location: `src/evaluation/types.ts`
  - Purpose: one strategy + one agent + one task execution record

- `ExperimentComparison`
  - Suggested location: `src/evaluation/types.ts`
  - Purpose: aggregated comparison across runs

- `CorrectnessScore`
  - Suggested location: `src/evaluation/types.ts` or `src/metrics/types.ts`
  - Purpose: answer-key-based correctness result

- `MetricFormula`
  - Suggested location: `src/metrics/types.ts` only if metric logic becomes crowded
  - Purpose: formula descriptions for token, timing, correctness, and complexity metrics

- `PlotSeries`
  - Suggested location: `src/evaluation/types.ts` or `src/metrics/types.ts`
  - Purpose: plot-ready data

- `VisualizationDemoResult`
  - Suggested location: `src/evaluation/types.ts`
  - Purpose: artifact references and summaries for my-dev-kit visualization command demos

## 5. Module migration map

### Project description and complexity metrics

- Existing file to extend:
  - `src/evaluation/types.ts`
  - `src/evaluation/readEvaluationCases.ts`
  - benchmark contract JSON files under `benchmarks/contracts/`
- New file to create, if justified:
  - `src/evaluation/readBenchmarkProjectProfile.ts`
- Files that must not be duplicated:
  - do not create a separate benchmark metadata loader outside the evaluation/benchmark path
- Tests to add later:
  - benchmark metadata parsing
  - complexity metric calculation
- Follow-up prompt:
  - Prompt 2

### File tree extraction

- Existing file to extend:
  - `src/core/fileGlobs.ts`
  - `src/evaluation/readEvaluationCases.ts`
- New file to create, if justified:
  - `src/evaluation/buildProjectFileTree.ts`
- Files that must not be duplicated:
  - do not create a second filesystem walker unrelated to `fileGlobs`
- Tests to add later:
  - file tree determinism
  - excluded path handling
- Follow-up prompt:
  - Prompt 2

### Answer key validation

- Existing file to extend:
  - benchmark contract files
  - `src/evaluation/readEvaluationCases.ts`
- New file to create, if justified:
  - `src/evaluation/validateAnswerKey.ts`
- Files that must not be duplicated:
  - do not create a separate correctness-contract system outside the benchmark/evaluation path
- Tests to add later:
  - answer-key schema validation
  - missing answer-key failures
- Follow-up prompt:
  - Prompt 2

### Raw-full-file prompt generation

- Existing file to extend:
  - `src/evaluation/runRawFullFileBaseline.ts`
- New file to create, if justified:
  - `src/prompts/buildRawFullFilePrompt.ts`
- Files that must not be duplicated:
  - do not create a second raw baseline collector
- Tests to add later:
  - prompt assembly determinism
- Follow-up prompt:
  - Prompt 3

### My-dev-kit-guided prompt generation

- Existing file to extend:
  - `src/evaluation/runMyDevKitRetrieval.ts`
- New file to create, if justified:
  - `src/prompts/buildMyDevKitGuidedPrompt.ts`
- Files that must not be duplicated:
  - do not create a second my-dev-kit retrieval runtime
- Tests to add later:
  - prompt assembly using retrieved context
- Follow-up prompt:
  - Prompt 3

### Prompt complexity scoring

- Existing file to extend:
  - `src/core/countTokens.ts`
  - `src/evaluation/types.ts`
- New file to create, if justified:
  - `src/prompts/promptComplexity.ts`
- Files that must not be duplicated:
  - do not create a second token/size estimator
- Tests to add later:
  - prompt complexity calculations
- Follow-up prompt:
  - Prompt 3

### Codex adapter

- Existing file to extend:
  - no existing agent layer exists
- New file to create, justified:
  - `src/agents/types.ts`
  - `src/agents/runCodexAdapter.ts`
- Files that must not be duplicated:
  - do not create a second command telemetry runtime outside `runMeasuredCommand`
- Tests to add later:
  - fake adapter-contract tests first
  - Codex adapter parsing tests
- Follow-up prompt:
  - Prompt 4

### Claude adapter

- Existing file to extend:
  - no existing agent layer exists
- New file to create, justified:
  - `src/agents/runClaudeAdapter.ts`
- Files that must not be duplicated:
  - do not create a second command telemetry runtime outside `runMeasuredCommand`
- Tests to add later:
  - adapter parsing tests
- Follow-up prompt:
  - Prompt 4

### Fake agent adapter

- Existing file to extend:
  - no existing agent layer exists
- New file to create, justified:
  - `src/agents/runFakeAgentAdapter.ts`
- Files that must not be duplicated:
  - do not create fake execution logic inside unrelated command files
- Tests to add later:
  - deterministic fake-agent tests
- Follow-up prompt:
  - Prompt 4

### Agent execution timing

- Existing file to extend:
  - `src/core/runMeasuredCommand.ts`
- New file to create, if justified:
  - none required initially
- Files that must not be duplicated:
  - do not duplicate `runMeasuredCommand`
- Tests to add later:
  - adapter timing passthrough tests
- Follow-up prompt:
  - Prompt 4 and Prompt 5

### Agent-reported token parsing

- Existing file to extend:
  - `src/core/countTokens.ts`
  - `src/core/runMeasuredCommand.ts`
- New file to create, if justified:
  - `src/agents/parseAgentTokenUsage.ts`
- Files that must not be duplicated:
  - do not create a second token counting utility
- Tests to add later:
  - stdout/stderr token parsing fixtures
- Follow-up prompt:
  - Prompt 4 or Prompt 5

### Correctness scoring

- Existing file to extend:
  - `src/evaluation/types.ts`
- New file to create, justified:
  - `src/evaluation/scoreCorrectness.ts`
- Files that must not be duplicated:
  - do not create a second evaluation summary pipeline just for correctness
- Tests to add later:
  - answer-key scoring tests
  - partial-credit tests if introduced
- Follow-up prompt:
  - Prompt 5

### Experiment comparison

- Existing file to extend:
  - `src/evaluation/compareTokenSavings.ts`
- New file to create, justified:
  - `src/evaluation/compareExperimentRuns.ts`
- Files that must not be duplicated:
  - do not create a second aggregate result writer outside `src/evaluation`
- Tests to add later:
  - comparison aggregation tests
- Follow-up prompt:
  - Prompt 5

### Final report rendering

- Existing file to extend:
  - `src/evaluation/renderTokenSavingsReportInput.ts`
  - `src/report/types.ts`
  - `src/report/renderHtmlReport.ts`
- New file to create, if justified:
  - `src/evaluation/renderExperimentReportInput.ts`
- Files that must not be duplicated:
  - do not create a second HTML renderer outside `src/report/renderHtmlReport.ts`
- Tests to add later:
  - experiment report input mapping tests
  - HTML section rendering tests
- Follow-up prompt:
  - Prompt 6

### Plot data generation

- Existing file to extend:
  - `src/evaluation/types.ts`
- New file to create, justified:
  - `src/evaluation/buildPlotSeries.ts`
  - optional `src/metrics/formulas.ts` if metric logic becomes crowded
- Files that must not be duplicated:
  - do not create a second report summary file outside current evaluation artifacts
- Tests to add later:
  - plot-series determinism tests
- Follow-up prompt:
  - Prompt 7

### Visualization command demos

- Existing file to extend:
  - `src/core/runMeasuredCommand.ts`
  - `src/evaluation/types.ts`
- New file to create, justified:
  - `src/evaluation/runVisualizationDemos.ts`
- Files that must not be duplicated:
  - do not create a second measured-command runner
- Tests to add later:
  - fake visualization command tests
- Follow-up prompt:
  - Prompt 7

### Gallery manifest upgrade

- Existing file to extend:
  - `src/gallery/types.ts`
  - `src/gallery/writeGalleryManifest.ts`
- New file to create, if justified:
  - none required initially
- Files that must not be duplicated:
  - do not create a second gallery manifest module
- Tests to add later:
  - experiment gallery item tests
  - plot and demo artifact tests
- Follow-up prompt:
  - Prompt 7

## 6. Command migration map

### `capture-demo-report`

Current behavior:

- reads generic report JSON input
- writes report JSON/HTML
- optionally captures screenshot

Future behavior:

- remain a generic report debugging and fixture tool

Decision:

- keep

New command name justified:

- no

Reason:

- it is already generic and useful for fixture-driven report snapshots

### `evaluate-token-savings`

Current behavior:

- runs raw baseline and my-dev-kit retrieval
- compares estimated token usage
- writes evaluation artifacts and report

Future behavior:

- become the seed runtime for controlled experiments
- broaden from token-savings-only evaluation into experiment evaluation while preserving backward compatibility

Decision:

- extend

New command name justified:

- not initially

Recommendation:

- keep `evaluate-token-savings` working as a backward-compatible command
- evolve the underlying runtime into a generic experiment evaluator
- if a clearer CLI alias such as `evaluate-experiment` is added later, it must delegate to the same runtime and not fork behavior

### `lab-demo`

Current behavior:

- validates benchmarks
- runs token-savings evaluation
- writes gallery manifest

Future behavior:

- orchestrate the richer experiment runner and gallery publishing

Decision:

- extend

New command name justified:

- no

Reason:

- it already represents the top-level demonstration workflow

### `verify-benchmarks`

Current behavior:

- validates contracts and project structure

Future behavior:

- also validate richer benchmark metadata and answer-key completeness

Decision:

- extend

New command name justified:

- no

Reason:

- benchmark validation remains one concern

Explicit recommendation on future controlled agent experiments:

- do not create a separate command runtime
- evolve the underlying `runTokenSavingsEvaluation` path into a generic experiment-evaluation runtime
- keep `lab-demo` as the orchestration command that calls the new experiment runner
- only add a future `evaluate-experiment` CLI alias if needed for naming clarity, and only if it reuses the same implementation

## 7. Report migration map

Current report architecture:

- `src/report/renderHtmlReport.ts` is generic
- `src/evaluation/renderTokenSavingsReportInput.ts` is the experiment-specific mapper
- `src/report/writeReportArtifacts.ts` is the generic artifact writer

Recommended evolution:

- keep `src/report/renderHtmlReport.ts` as the generic renderer
- extend `LabReportInput` so it can describe richer experiment sections
- keep experiment-to-report mapping in the evaluation layer
- evolve `renderTokenSavingsReportInput.ts` toward a broader experiment mapper rather than hardcoding experiment logic into the renderer

Report must eventually include:

- experiment overview
- project profile
- file tree
- prompt comparison
- agent result comparison
- correctness results
- token metrics
- timing metrics
- formula descriptions
- plot sections
- visualization command demos

What stays in generic report rendering:

- section rendering primitives
- generic steps
- generic metrics
- generic artifacts
- generic warnings

What belongs in experiment-to-report mapping:

- agent-specific comparison content
- prompt variant summaries
- project complexity summaries
- correctness and token/time aggregates
- plot-ready and visualization demo summaries

What should not be hardcoded into `renderHtmlReport`:

- Codex-specific assumptions
- Claude-specific assumptions
- token-savings-only wording
- benchmark-case-specific formulas

How screenshot capture remains unchanged:

- report HTML stays the screenshot target
- `captureReportScreenshot` stays untouched
- richer report content only changes the HTML input, not the screenshot module

## 8. Test migration map

Existing tests that must continue passing:

- benchmark contract tests
- benchmark structure tests
- benchmark parity tests
- report renderer tests
- report artifact writer tests
- screenshot capture tests
- evaluation case parsing tests
- raw baseline tests
- my-dev-kit retrieval tests
- token-savings comparison tests
- token-savings artifact tests
- command tests
- gallery manifest tests
- integration tests
- E2E tests
- core measured-command and token-count tests

Prompt 2 test additions:

- unit tests for benchmark metadata parsing
- unit tests for project complexity metrics
- unit tests for file tree extraction
- integration test for richer benchmark case loading

Prompt 3 test additions:

- unit tests for raw-full-file prompt generation
- unit tests for my-dev-kit-guided prompt generation
- unit tests for prompt complexity scoring

Prompt 4 test additions:

- fake-agent adapter unit tests
- adapter interface contract tests
- token parsing fixture tests

Prompt 5 test additions:

- experiment runner unit tests
- correctness scoring unit tests
- integration tests for multi-strategy experiment comparison

Prompt 6 test additions:

- experiment report mapping tests
- richer report rendering tests
- command integration tests for experiment output artifacts

Prompt 7 test additions:

- plot-data unit tests
- visualization command demo unit tests
- gallery manifest expansion tests

Additional E2E direction:

- fake-agent end-to-end report generation
- richer lab-demo end-to-end artifact verification

## 9. Anti-duplication guardrails

Rules for future prompts:

- do not create `src/evaluation-v2`
- do not create `src/report-v2`
- do not create `src/new-report`
- do not create `src/experiment-report` as a second renderer
- do not create a second screenshot module
- do not create a second gallery module
- do not create a second command runner
- do not duplicate `runMeasuredCommand`
- do not duplicate token counting
- do not duplicate report artifact writing
- do not duplicate screenshot capture
- do not duplicate token-savings comparison if it can be extended
- do not create a second benchmark loader outside the current benchmark/evaluation path
- do not create a second my-dev-kit retrieval runtime
- do not create agent-specific report renderers

Allowed new modules only when they represent a genuinely new layer:

- `src/agents/*` for agent adapters
- `src/prompts/*` for prompt-variant generation
- `src/metrics/*` only if shared metric formulas would overcrowd `src/evaluation`

## 10. Recommended prompt sequence

### Prompt 2

- Branch name:
  - `feature/lab-benchmark-metadata-complexity`
- Goal:
  - add benchmark metadata, project complexity, file tree extraction, and answer keys
- Files to extend:
  - `benchmarks/contracts/*`
  - `src/evaluation/types.ts`
  - `src/evaluation/readEvaluationCases.ts`
  - `scripts/verify-benchmarks.ts`
- Files to create only if justified:
  - `src/evaluation/buildProjectFileTree.ts`
  - `src/evaluation/readBenchmarkProjectProfile.ts`
- Tests to add:
  - benchmark metadata parsing
  - complexity metric calculation
  - file tree determinism
  - answer-key validation
- Docs to update:
  - `docs/CURRENT_STATE.md`
  - `docs/ROADMAP.md`
  - `docs/WORKFLOWS.md`
- Acceptance criteria summary:
  - benchmark metadata is richer
  - project complexity and file tree data are available
  - answer keys exist and validate
  - no experiment runner yet

### Prompt 3

- Branch name:
  - `feature/lab-prompt-variants`
- Goal:
  - add raw-full-file and my-dev-kit-guided prompt variants plus prompt complexity metrics
- Files to extend:
  - `src/evaluation/runRawFullFileBaseline.ts`
  - `src/evaluation/runMyDevKitRetrieval.ts`
  - `src/evaluation/types.ts`
- Files to create only if justified:
  - `src/prompts/types.ts`
  - `src/prompts/buildRawFullFilePrompt.ts`
  - `src/prompts/buildMyDevKitGuidedPrompt.ts`
  - `src/prompts/promptComplexity.ts`
- Tests to add:
  - prompt assembly tests
  - prompt complexity tests
- Docs to update:
  - `docs/CURRENT_STATE.md`
  - `docs/WORKFLOWS.md`
- Acceptance criteria summary:
  - prompt variants exist as structured artifacts
  - prompt complexity is measurable
  - no agent execution yet

### Prompt 4

- Branch name:
  - `feature/lab-agent-adapters`
- Goal:
  - add agent adapter interface plus Codex, Claude, and fake-agent adapters
- Files to extend:
  - `src/core/runMeasuredCommand.ts`
  - `src/evaluation/types.ts`
- Files to create only if justified:
  - `src/agents/types.ts`
  - `src/agents/runCodexAdapter.ts`
  - `src/agents/runClaudeAdapter.ts`
  - `src/agents/runFakeAgentAdapter.ts`
  - `src/agents/index.ts`
- Tests to add:
  - adapter contract tests
  - fake-agent deterministic tests
  - token parsing tests
- Docs to update:
  - `docs/CURRENT_STATE.md`
  - `docs/ARCHITECTURE.md`
- Acceptance criteria summary:
  - adapters share one runtime pattern
  - fake agent enables deterministic testing
  - no correctness scoring yet

### Prompt 5

- Branch name:
  - `feature/lab-controlled-experiment-runner`
- Goal:
  - add controlled experiment runner and correctness scoring
- Files to extend:
  - `src/evaluation/types.ts`
  - `src/evaluation/compareTokenSavings.ts` or its generalized successor
  - `src/commands/evaluateTokenSavings.ts`
  - `src/commands/runLabDemo.ts`
- Files to create only if justified:
  - `src/evaluation/runExperiment.ts`
  - `src/evaluation/scoreCorrectness.ts`
  - `src/evaluation/compareExperimentRuns.ts`
- Tests to add:
  - correctness scoring
  - experiment aggregation
  - integration tests using fake-agent
- Docs to update:
  - `docs/CURRENT_STATE.md`
  - `docs/WORKFLOWS.md`
  - `docs/COMMANDS.md`
- Acceptance criteria summary:
  - strategy and agent runs are comparable
  - correctness is answer-key-based
  - no plot/report expansion beyond structured data yet

### Prompt 6

- Branch name:
  - `feature/lab-experiment-report`
- Goal:
  - upgrade final report and screenshot target into the full experiment report
- Files to extend:
  - `src/report/types.ts`
  - `src/report/renderHtmlReport.ts`
  - `src/evaluation/renderTokenSavingsReportInput.ts` or its generalized successor
  - `src/evaluation/writeTokenSavingsArtifacts.ts` or its generalized successor
- Files to create only if justified:
  - `src/evaluation/renderExperimentReportInput.ts`
- Tests to add:
  - report mapping tests
  - richer renderer section tests
  - screenshot compatibility tests
- Docs to update:
  - `docs/CURRENT_STATE.md`
  - `docs/TUTORIAL.md`
  - `docs/GALLERY.md`
- Acceptance criteria summary:
  - experiment report includes project profile, prompts, run comparisons, correctness, tokens, timing, formulas, and artifact links
  - screenshot capture still reuses the same module

### Prompt 7

- Branch name:
  - `feature/lab-plots-visualization-gallery`
- Goal:
  - add plots, visualization command demos, and gallery integration
- Files to extend:
  - `src/gallery/types.ts`
  - `src/gallery/writeGalleryManifest.ts`
  - `src/commands/runLabDemo.ts`
  - experiment artifact writers
- Files to create only if justified:
  - `src/evaluation/buildPlotSeries.ts`
  - `src/evaluation/runVisualizationDemos.ts`
  - optional `src/metrics/formulas.ts`
- Tests to add:
  - plot-series tests
  - visualization demo tests
  - gallery manifest expansion tests
- Docs to update:
  - `docs/CURRENT_STATE.md`
  - `docs/GALLERY.md`
  - `docs/TUTORIAL.md`
- Acceptance criteria summary:
  - plot-ready data exists
  - visualization command artifacts are captured
  - gallery manifest includes the expanded experiment outputs

## 11. Risks and decisions

### Risk: Codex and Claude may not expose reliable token usage in CLI output

Mitigation:

- store token source metadata with each run
- support `reported`, `estimated`, and `unknown` token sources
- preserve fallback estimation via existing token-count utility

### Risk: agent-reported token usage may be inaccurate

Mitigation:

- keep reported tokens and estimated tokens as separate fields
- make formulas explicit in the report

### Risk: provider-reported token usage may require API or telemetry integration later

Mitigation:

- design `AgentTokenUsage` to represent uncertain or absent telemetry cleanly
- do not block experiment reporting on provider telemetry

### Risk: raw full-file prompt may be too large for some agents

Mitigation:

- keep prompt-size metrics explicit
- allow runs to fail with structured overflow or size warnings

### Risk: my-dev-kit-guided strategy may use more wall-clock time even if it saves tokens

Mitigation:

- treat timing and token savings as separate metrics
- report tradeoffs, not just wins

### Risk: correctness scoring must be based on answer keys, not only text similarity

Mitigation:

- add deterministic answer keys in Prompt 2
- implement correctness scoring against those keys in Prompt 5

### Risk: visualization commands may not exist for every benchmark project or graph type

Mitigation:

- make visualization demos optional per benchmark profile
- report missing demos as skipped artifacts rather than failures by default

### Risk: project complexity formula must stay simple at first

Mitigation:

- start with a narrow, inspectable metric set
- document formulas explicitly
- avoid opaque weighted scoring in early phases

## 12. No-code implementation decision

What should be implemented in Prompt 2:

- benchmark metadata
- project complexity metrics
- project file tree extraction
- benchmark task answer keys
- validation for those new benchmark fields

What should not be implemented until later:

- prompt variants
- agent adapters
- experiment runner
- correctness scoring
- expanded report rendering
- plots
- visualization demos

Whether any current code should be deleted:

- no

Whether any current command should be renamed:

- no immediate rename is required
- a future alias can be added only if it reuses the same runtime

Whether current artifacts should remain backward compatible:

- yes

Compatibility expectation:

- current token-savings JSON, report HTML, screenshot flow, and gallery manifest should remain readable and usable while the experiment system is added incrementally
