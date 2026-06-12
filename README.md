# my-dev-kit-lab

my-dev-kit-lab is the evidence, benchmark, screenshot, evaluation, and tutorial/gallery companion for my-dev-kit. It exists to host deterministic benchmark projects, validation workflows, reproducible report artifacts, and the completed local feature-batch demo flow that measures how my-dev-kit retrieval compares with raw full-file context.

my-dev-kit is the indexing and retrieval engine. my-dev-kit-lab is the separate lab layer that feeds it benchmark inputs and records evaluation outputs.

Current status: the Prompt 1 through Prompt 7 batch is implemented. The repository currently contains benchmark contracts, four deterministic benchmark projects, quantified project profiles with file-tree metadata and answer keys, prompt variants, agent adapters, controlled experiment artifacts, experiment reports, optional report screenshots, static SVG plots, bounded visualization demos, and gallery integration.

Prompt variants are also available as deterministic previews. The prompt layer can generate raw-full-file and my-dev-kit-guided instruction prompts at `short`, `medium`, `long`, and `multi-step` complexity levels, with prompt complexity metrics based on the existing token estimator.

Agent adapters now support one-prompt smoke runs through `fake-agent`, Codex, or Claude. Automated tests use deterministic `fake-agent` behavior and do not require real Codex or Claude CLIs. The controlled experiment runner can compare `raw-full-file` and `my-dev-kit-guided` strategies, score correctness from benchmark answer keys, and write structured JSON artifacts. Codex and Claude experiment runs are optional and may produce structured unavailable or limit-reached outcomes when local CLIs or accounts are constrained. Controlled experiment artifacts can now be rendered into a final HTML experiment report with optional screenshot capture, static SVG plots, bounded my-dev-kit visualization demos, and gallery integration.

Completed feature batch:
- Prompt 1: architecture audit, migration plan, and anti-duplication guardrails
- Prompt 2: benchmark metadata, complexity metrics, file trees, and answer keys
- Prompt 3: raw-full-file and my-dev-kit-guided prompt variants plus complexity metrics
- Prompt 4 and 4.5: fake-agent, Codex, and Claude adapters plus Windows CLI shim resolution
- Prompt 5: controlled experiment runner and answer-key correctness scoring
- Prompt 6: controlled experiment report rendering and optional screenshot capture
- Prompt 7: plots, visualization demos, gallery integration, and final demo workflow

Quick commands:
- `npm install`
- `npm run build`
- `npm run test`
- `npm run test:benchmarks`
- `npm run capture-demo-report -- --input examples/demo-report-input.json --out lab-output/demo-report`
- `npm run evaluate-token-savings -- --cases examples/token-savings-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/token-savings`
- `npm run generate-prompt-variants -- --cases examples/token-savings-cases.json --out lab-output/prompt-variants`
- `npm run run-agent-prompt -- --agent fake-agent --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy raw-full-file --complexity short --out lab-output/agent-run-fake`
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents fake-agent --strategies raw-full-file,my-dev-kit-guided --complexities short --out lab-output/controlled-experiment-fake`
- `npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake --no-screenshot`
- `npm run generate-experiment-plots -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-plots`
- `npm run run-visualization-demos -- --project benchmarks/projects/todo-ts --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/visualization-demos`
- `npm run build-gallery -- --report lab-output/experiment-report-fake --plots lab-output/experiment-plots --visualizations lab-output/visualization-demos --out lab-output/gallery`
- `npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot`
- `npm run lab-demo -- --cases examples/lab-demo-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/demo-gallery`
- `npm run verify`

Benchmark projects:
- `benchmarks/projects/todo-ts`
- `benchmarks/projects/todo-js`
- `benchmarks/projects/todo-python`
- `benchmarks/projects/todo-mixed-ts-py`

They exist to provide the same small Todo Core behavior in different language layouts so later prompts can compare retrieval quality, screenshots, and context usage against a stable benchmark suite.

Benchmark metadata:
- `benchmarks/contracts/benchmark-project-profiles.json` stores project descriptions, language mix, file-tree entries, complexity metrics, complexity scores, and the formula used for scoring.
- `benchmarks/contracts/todo-benchmark-case.json` now includes task answer keys with expected files, expected symbols, and expected facts.
- Controlled agent experiments and answer-key correctness scoring now write structured JSON artifacts under `lab-output`.

Not implemented yet:
- provider telemetry dashboards
- OpenTelemetry collection
- semantic LLM judging
- cloud API integration
- real Codex or Claude benchmark campaigns
- larger benchmark suites
- richer gallery UI
- cloud API billing or cost dashboards

Install:
- `npm install`

Run tests:
- `npm run test`
- `npm run test:benchmarks`
- `npm run test:report`
- `npm run test:screenshot`
- `npm run test:evaluation`
- `npm run test:gallery`
- `npm run test:demo`
- `npm run test:integration`
- `npm run test:e2e`
- `python -m unittest discover benchmarks/projects/todo-python/tests`

Run benchmark verification:
- `npm run verify:benchmarks`
- `npm run verify`

## Capture a demo report screenshot

Run:
- `npm run capture-demo-report -- --input examples/demo-report-input.json --out lab-output/demo-report`

Expected outputs:
- `lab-output/demo-report/demo-report.json`
- `lab-output/demo-report/demo-report.html`
- `lab-output/demo-report/demo-report.png` when Playwright and a browser runtime are available

Screenshot capture is optional. The command still succeeds when JSON and HTML artifacts are written and PNG capture is skipped because Playwright or the browser runtime is unavailable.

Install and usage details are documented in [docs/COMMANDS.md](docs/COMMANDS.md).

## Evaluate token savings

Run:
- `npm run evaluate-token-savings -- --cases examples/token-savings-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/token-savings`

Local my-dev-kit example:
- `npm run evaluate-token-savings -- --cases examples/token-savings-cases.json --kit-command "node ../my-dev-kit-v1/dist/cli.js" --out lab-output/token-savings-real`

Expected outputs:
- `lab-output/token-savings/token-savings-summary.json`
- `lab-output/token-savings/token-savings-runs.json`
- `lab-output/token-savings/token-savings-report.html`
- `lab-output/token-savings/token-savings-report.png` when screenshot capture succeeds
- `lab-output/token-savings/commands/*.stdout.txt`
- `lab-output/token-savings/commands/*.stderr.txt`
- `lab-output/token-savings/commands/*.telemetry.json`

Token counts are estimated only. This workflow uses `estimated_chars_div_4`, which means `Math.ceil(characterCount / 4)`. It is a static context-size comparison, not provider billing telemetry. Provider telemetry remains future work.

## Quick demo

Run:
- `npm run lab-demo -- --cases examples/lab-demo-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/demo-gallery`

This is the earlier token-savings demo workflow:
- benchmark projects
- token comparison
- report
- screenshot
- gallery manifest

Expected outputs:
- `lab-output/demo-gallery/token-savings-summary.json`
- `lab-output/demo-gallery/token-savings-runs.json`
- `lab-output/demo-gallery/token-savings-report.html`
- `lab-output/demo-gallery/token-savings-report.png` when screenshot capture succeeds
- `lab-output/demo-gallery/gallery-manifest.json`
- `lab-output/demo-gallery/commands/*`

See:
- `docs/TUTORIAL.md`
- `docs/GALLERY.md`

Token-savings evaluation is implemented in the MVP. Provider telemetry is still future work.

## Run a single agent prompt

Run a deterministic fake-agent smoke check:
- `npm run run-agent-prompt -- --agent fake-agent --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy raw-full-file --complexity short --out lab-output/agent-run-fake`

Real adapters are optional and skipped when unavailable unless `--require-agent` is passed:
- `npm run run-agent-prompt -- --agent codex --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy my-dev-kit-guided --complexity short --out lab-output/agent-run-codex`
- `npm run run-agent-prompt -- --agent claude --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy my-dev-kit-guided --complexity short --out lab-output/agent-run-claude`

This command writes a prompt preview and `agent-run-result.json`. It does not compare strategies, score correctness, render final experiment reports, update screenshots, or update the gallery.

## Run a controlled experiment

Run a deterministic fake-agent experiment:
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents fake-agent --strategies raw-full-file,my-dev-kit-guided --complexities short --out lab-output/controlled-experiment-fake`

This writes `experiment-summary.json`, `experiment-runs.json`, `experiment-comparisons.json`, `experiment-config.json`, and per-run artifacts under `runs/<runId>/`. It compares strategy pairs, scores correctness from answer keys, and computes token and duration comparisons when both paired runs expose totals.

Real Codex and Claude runs require `--include-real-agents`. External usage limits, session limits, timeouts, and unavailable CLIs are stored as structured outcomes.

## Render a controlled experiment report

Render the fake-agent experiment artifacts into a final HTML report:
- `npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake --no-screenshot`

Capture an optional screenshot from the generated local HTML report:
- `npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake-shot --screenshot`

Expected outputs:
- `experiment-report.json`
- `experiment-report.html`
- `experiment-report-artifacts.json`
- `experiment-report.png` when `--screenshot` succeeds

The report shows project profile and complexity data, benchmark file tree entries, benchmark tasks, prompt strategy excerpts, agent run statuses, correctness scores, token and timing comparisons, formulas, aggregate answers, warnings, and limitations. It can include plot and visualization demo artifact links when those directories are provided.

## Run the final demo

Run the complete deterministic local batch demo:
- `npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot`

This runs a controlled experiment, renders an enhanced experiment report, generates plot data and SVG charts, runs fake my-dev-kit visualization demos, and writes a gallery manifest plus static gallery index. Plot generation and visualization demos are local deterministic artifacts; they do not depend on cloud APIs. Real Codex, Claude, and real my-dev-kit commands are optional and are not required for tests.
