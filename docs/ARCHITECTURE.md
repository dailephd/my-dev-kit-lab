# Architecture

Repository layers:

- `benchmarks/`: deterministic benchmark projects and benchmark contracts
- `docs/`: project, workflow, and roadmap documentation
- `src/report/`: report types, HTML rendering, and artifact writing
- `src/screenshot/`: optional PNG capture from generated local HTML reports
- `src/core/`: shared utilities for token counting, safe paths, file glob collection, and measured subprocess execution
- `src/evaluation/`: raw baseline, my-dev-kit retrieval, token comparison, and artifact generation
- `src/prompts/`: raw-full-file and my-dev-kit-guided prompt generation plus prompt complexity metrics
- `src/agents/`: one-prompt coding-agent adapter layer for fake-agent, Codex, and Claude
- `src/gallery/`: gallery manifest types and writer
- `src/plots/`: plot-ready data generation and deterministic SVG chart rendering
- `src/visualizationDemos/`: bounded my-dev-kit visualization command demos
- `src/commands/`: reusable command implementations
- `src/`: reusable lab runtime code and exports
- `scripts/`: command entrypoints and verification helpers
- `tests/`: root validation and parity tests

Benchmark layer:

The benchmark layer is the current center of the repository. It contains small, intentionally cheap sample projects that all implement the same Todo Core behavior across different language layouts.

Benchmark metadata now lives with the benchmark contracts:

- `benchmarks/contracts/todo-benchmark-case.json` stores benchmark tasks, expected operations, per-project expected files, and answer keys
- `benchmarks/contracts/benchmark-project-profiles.json` stores project descriptions, language mix, source/test roots, deterministic file-tree entries, complexity metrics, complexity scores, and the formula used for scoring
- `scripts/verify-benchmarks.ts` validates the enriched contract data before lab-demo runs

The metadata helpers are part of the existing evaluation layer:

- `src/evaluation/projectFileTree.ts` builds deterministic compact file trees
- `src/evaluation/projectComplexity.ts` owns the simple benchmark complexity formula
- `src/evaluation/benchmarkMetadata.ts` validates profiles and answer keys

This is not a second benchmark architecture. It extends the existing benchmark contract path so later prompt variants, agent adapters, correctness scoring, and final reports can reuse the same data.

Report layer:

The report layer normalizes lab report input, renders deterministic local HTML, and writes JSON and HTML artifacts. It is the reusable artifact foundation for benchmark validation today and token/context evaluation in Prompt 3.

Controlled experiment reporting also lives in `src/report`. It consumes the JSON artifacts written by `src/evaluation`, builds an experiment report input model, renders `experiment-report.html`, and writes `experiment-report.json` plus an artifact index. This extends the existing report layer; there is no `report-v2` or separate HTML renderer.

The experiment report flow is:

`controlled experiment artifacts -> ExperimentReportInput -> experiment-report.json -> experiment-report.html -> optional screenshot PNG`

Screenshot layer:

The screenshot layer consumes generated local HTML reports and produces optional PNG captures. The flow is `lab artifact JSON -> HTML report -> PNG screenshot`.

Screenshot output is presentation evidence, not the source of evaluation truth. JSON remains the structured artifact of record. HTML is the readable report view. PNG is a shareable snapshot of that report.

Experiment report screenshots reuse `src/screenshot/captureReportScreenshot.ts`. The report command defaults to no screenshot and only captures PNG output when requested.

Plot layer:

The plot layer reads controlled experiment runs and comparisons and writes plot-ready JSON plus static SVG charts. It does not use external charting libraries, network assets, or browser rendering. Missing token or timing data is preserved as skipped plot points and warnings.

Visualization demo layer:

The visualization demo layer builds a bounded sequence of my-dev-kit commands for a benchmark project and runs them through `src/core/runMeasuredCommand.ts`. It records stdout, stderr, telemetry, expected artifacts, produced artifacts, warnings, and failures. Fake my-dev-kit is used in tests; real my-dev-kit is optional.

Evaluation layer:

The evaluation layer measures two paths for each benchmark case:

- `RawFullFileBaselineRunner`: reads deterministic full-file context using safe, sorted file expansion under the benchmark target root
- `MyDevKitRetrievalRunner`: calls my-dev-kit externally as a subprocess using the sequence `index -> search -> lookup -> slice -> source`
- `TokenSavingsComparator`: compares estimated chars and estimated tokens between the two paths and aggregates the results

This layer writes structured JSON artifacts and feeds the token-savings results into the existing report layer. It does not create a second reporting or screenshot architecture.

Controlled experiment runtime also lives in `src/evaluation`. It reuses:

- `src/prompts` to generate `raw-full-file` and `my-dev-kit-guided` prompt variants
- `src/agents` to run `fake-agent`, Codex, or Claude adapters
- benchmark answer keys from evaluation cases for deterministic correctness scoring
- existing token usage fields from `AgentRunResult`
- existing command telemetry produced by real CLI adapters through `runMeasuredCommand`

The controlled experiment flow is:

`EvaluationCase + BenchmarkProjectProfile + AnswerKey -> ExperimentMatrix -> PromptVariant -> AgentRunResult -> ParsedAgentAnswer -> CorrectnessScore -> ExperimentComparison -> JSON artifacts`

External Codex and Claude failures are represented as run statuses such as `agent-unavailable`, `agent-limit-reached`, `timeout`, `failed`, or `invalid-output`. These statuses are data in the experiment artifacts, not crashes in the evaluation architecture.

The evaluation case reader remains backward compatible with the existing token-savings evaluator. It accepts optional answer keys and project profile references but does not require them unless profile resolution is explicitly requested by future workflows.

my-dev-kit is called externally, not imported. This keeps my-dev-kit-lab decoupled from my-dev-kit internals and allows configurable commands such as `my-dev-kit`, `npx @dailephd/my-dev-kit`, or `node ../my-dev-kit-v1/dist/cli.js`.

Prompt generation layer:

The prompt layer consumes existing `EvaluationCase` objects, benchmark project profiles, answer keys, and file-tree metadata. It generates deterministic prompt variants for two context strategies:

- `raw-full-file`
- `my-dev-kit-guided`

It supports `short`, `medium`, `long`, and `multi-step` prompt complexity levels and computes prompt complexity metrics using `src/core/countTokens.ts`.

This layer does not execute agents. It does not replace the raw full-file baseline runner, my-dev-kit retrieval runner, token-savings evaluator, report renderer, screenshot capture, or gallery manifest writer.

Agent adapter layer:

The agent layer consumes `PromptVariant` objects from `src/prompts` and produces normalized `AgentRunResult` artifacts. It currently supports:

- `fake-agent` for deterministic tests and smoke checks
- `codex` as a configurable CLI adapter
- `claude` as a configurable CLI adapter

Real CLI adapters reuse `src/core/runMeasuredCommand.ts` for stdout, stderr, exit code, duration, and telemetry capture. Token usage parsing is best-effort and records source and reliability labels; missing provider usage is represented as unavailable rather than estimated.

Command resolution for real CLI adapters lives in `src/core/resolveCommand.ts` and is used by `src/core/runMeasuredCommand.ts`. On Windows, it resolves npm-style CLI wrappers without enabling `shell: true` globally: `.cmd` and `.bat` wrappers use a controlled `cmd.exe` invocation, `.ps1` wrappers use a controlled PowerShell invocation, and `.cmd` is preferred over `.ps1`.

This layer does not itself compare strategies, run experiment matrices, score correctness, render final experiment reports, capture screenshots, or update the gallery. The experiment runner consumes its normalized `AgentRunResult` records.

Gallery layer:

The gallery layer packages evaluation outputs into a portable manifest that can drive README examples, GitHub evidence, tutorial references, later portfolio templates, and future gallery surfaces without changing the underlying evaluator.

Controlled experiment artifacts now feed the experiment report renderer, plot artifacts, visualization demos, and the extended gallery manifest. The gallery layer was extended in place; no `gallery-v2` format was added.

Lab-demo orchestration layer:

The lab-demo command is an orchestrator over the existing Milestone 1 pieces. It validates benchmarks, runs token-savings evaluation, reuses the existing report and screenshot layers, and writes a gallery manifest.

Final Milestone 1 data flow:

`benchmark validation -> token-savings evaluation -> report JSON -> report HTML -> optional screenshot PNG -> gallery manifest -> tutorial documentation`

Gallery output is generated from evaluation artifacts. Screenshots remain presentation artifacts derived from the generated HTML report, not the evaluation source of truth.

Future provider telemetry layer:

Provider telemetry and adapter-specific metadata belong in a later layer that records run details without changing benchmark semantics. This is not part of Milestone 1.

Boundary between my-dev-kit and my-dev-kit-lab:

my-dev-kit remains the indexing and retrieval engine. my-dev-kit-lab owns benchmark inputs, validation, reports, and future evaluation workflows. In later prompts, my-dev-kit-lab will call my-dev-kit externally rather than importing internal my-dev-kit implementation details directly.

Migration planning note:

The post-Milestone-1 experiment upgrade path is documented in `docs/EXPERIMENT_REPORT_MIGRATION_PLAN.md`. Future prompts should extend the existing evaluation, report, screenshot, gallery, and command layers rather than introducing parallel architectures.

Follow-up Prompt 2 note:

Benchmark metadata, file-tree data, complexity metrics, and answer keys have been added. The report and screenshot layers are unchanged by this prompt.

Follow-up Prompt 3 note:

Prompt variants and prompt complexity metrics have been added under `src/prompts`. Agent adapters, controlled experiment execution, correctness scoring, and final experiment reporting remain future work.

Follow-up Prompt 4 note:

Agent adapters have been added under `src/agents`, and `run-agent-prompt` can run one generated prompt through one adapter. Controlled experiment execution, correctness scoring, final experiment reporting, plots, visualization demos, screenshot changes, and gallery upgrades remain future work.

Follow-up Prompt 4.5 note:

Windows CLI shim resolution has been added under `src/core` and reused by the existing measured command runtime. This improves real Codex and Claude CLI smoke runs without adding a second command runner or changing experiment architecture.

Follow-up Prompt 5 note:

Controlled experiment execution, answer parsing, correctness scoring, comparison metrics, and experiment artifact writing have been added under `src/evaluation`. The report, screenshot, and gallery layers remain unchanged.

Follow-up Prompt 6 note:

Experiment report input building, HTML rendering, artifact writing, and the `render-experiment-report` command have been added under the existing `src/report`, `src/commands`, and `scripts` layers. Optional screenshots reuse `src/screenshot`. Plot generation, visualization command demos, and gallery integration remain Prompt 7 work.

Follow-up Prompt 7 note:

Plot data generation, static SVG chart rendering, visualization demos, experiment gallery integration, and `run-final-demo` have been added. Report, screenshot, gallery, command, experiment, prompt, and agent systems were extended in place.
