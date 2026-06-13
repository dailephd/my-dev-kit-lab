# Workflows

## Workflow 1: Benchmark Project Validation

Purpose:
- validate benchmark contracts
- validate benchmark project structure
- validate behavior parity across benchmark projects
- validate benchmark project profiles
- validate deterministic file-tree metadata
- validate project complexity metrics and complexity scores
- validate task answer keys and expected facts
- validate metric glossary coverage in `docs/METRICS.md`

Commands:
- `npm run test:benchmarks`
- `npm run verify:benchmarks`
- `npm run verify`
- `python -m unittest discover benchmarks/projects/todo-python/tests`

Expected outputs:
- passing benchmark contract checks
- passing benchmark profile and answer-key checks
- passing benchmark structure checks
- passing parity checks for TypeScript, JavaScript, Python, and mixed boundary projects
- concise pass/fail output from the benchmark verification script

Current limitations:
- no provider telemetry dashboards
- no semantic LLM judging

## Workflow 2: Report and Screenshot Capture

Purpose:
- render deterministic HTML reports from lab JSON input
- write local JSON and HTML evidence artifacts
- capture optional PNG screenshots from generated local HTML

Command:
- `npm run capture-demo-report -- --input examples/demo-report-input.json --out lab-output/demo-report`

Expected outputs:
- `lab-output/demo-report/demo-report.json`
- `lab-output/demo-report/demo-report.html`
- `lab-output/demo-report/demo-report.png` when Playwright and a browser runtime are available

Fallback behavior:
- if Playwright or the browser runtime is unavailable, JSON and HTML still succeed
- the command records a warning stating `PNG screenshot skipped because Playwright or browser runtime is unavailable.`

Current limitations:
- no provider telemetry dashboards
- no cloud API integration

Placeholders for later workflows:
- tutorial and gallery workflow
- provider telemetry

## Workflow 3: Token-Savings Evaluation

Purpose:
- measure raw full-file baseline context
- run external my-dev-kit retrieval
- compare estimated chars and estimated tokens
- render evaluation artifacts through the existing report and screenshot flow

Command:
- `npm run evaluate-token-savings -- --cases examples/token-savings-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/token-savings`

Raw baseline path:
- expand `rawIncludeGlobs` under each benchmark target root
- concatenate sorted full-file contents with file path headers

my-dev-kit path:
- run `index -> search -> lookup -> slice -> source` as external subprocess commands
- capture stdout, stderr, and telemetry for each command

Expected outputs:
- `token-savings-summary.json`
- `token-savings-runs.json`
- `token-savings-report.html`
- `token-savings-report.png` when screenshot capture succeeds
- `commands/*.stdout.txt`
- `commands/*.stderr.txt`
- `commands/*.telemetry.json`

Skipped behavior:
- if the configured my-dev-kit command is unavailable and `--require-kit` is not passed, the run succeeds with skipped warnings and still writes JSON and HTML artifacts

## Workflow 4: Prompt Variant Generation

Purpose:
- generate raw-full-file prompt previews
- generate my-dev-kit-guided prompt previews
- measure prompt complexity with the existing token estimator
- write deterministic prompt artifacts for later agent experiments and reports

Command:
- `npm run generate-prompt-variants -- --cases examples/token-savings-cases.json --out lab-output/prompt-variants`

Raw-full-file strategy:
- tells the agent to use full source files supplied separately by a later runner
- asks for relevant files, relevant symbols, expected facts found, token usage source, and timing if available
- does not require my-dev-kit commands

my-dev-kit-guided strategy:
- tells the agent not to read full files by default
- asks the agent to use my-dev-kit `index`, `search`, `lookup`, `slice`, and `source`
- asks for commands run, selected context, selected files, selected symbols, full-file reads if any, and justifications if any

Prompt complexity levels:
- `short`
- `medium`
- `long`
- `multi-step`

Expected outputs:
- `prompt-variants-summary.json`
- `prompt-variants.json`
- `prompts/*.txt`

Current limitations:
- prompt previews are static artifacts until they are consumed by later run and report workflows

## Workflow 5: Single Agent Prompt Smoke Run

Purpose:
- generate one prompt variant from an existing evaluation case
- run it through one selected adapter
- capture normalized agent output and telemetry
- verify adapter wiring without running a full experiment matrix

Fake-agent command:
- `npm run run-agent-prompt -- --agent fake-agent --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy raw-full-file --complexity short --out lab-output/agent-run-fake`

Codex command:
- `npm run run-agent-prompt -- --agent codex --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy my-dev-kit-guided --complexity short --out lab-output/agent-run-codex`

Claude command:
- `npm run run-agent-prompt -- --agent claude --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy my-dev-kit-guided --complexity short --out lab-output/agent-run-claude`

Expected outputs:
- `prompt.txt`
- `agent-run-result.json`
- adapter stdout, stderr, and telemetry files when produced by the adapter

Unavailable-agent behavior:
- real Codex and Claude CLI adapters skip when unavailable
- passing `--require-agent` turns unavailable real agents into command failures
- automated tests use `fake-agent` and do not require Codex or Claude installations

Windows troubleshooting:
- run fake-agent first to verify prompt generation and artifact writing
- Codex installed through npm may resolve to `codex.cmd`, `codex.exe`, or `codex.ps1`
- the runtime prefers `.cmd` over `.ps1` and invokes PowerShell only for resolved `.ps1` shims
- if local CLI flags differ, pass `--command-template`, for example `codex exec --json {{prompt}}`
- if a real-agent smoke run skips unexpectedly, rerun with `--require-agent` to surface the failure as a command error

Current limitations:
- this command is intentionally a single-run smoke path and does not compare strategies or update reports or galleries by itself

## Workflow 6: Controlled Experiment Runner

Purpose:
- run a controlled matrix across selected benchmark cases
- pair `raw-full-file` and `my-dev-kit-guided` prompt strategies
- run selected agents and prompt complexity levels
- score correctness from benchmark answer keys
- compare correctness, token totals, and execution time when data is available
- write JSON artifacts for later report rendering, plots, and gallery indexing

Fake-agent command:
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents fake-agent --strategies raw-full-file,my-dev-kit-guided --complexities short --out lab-output/controlled-experiment-fake`

Fake-agent matrix smoke command:
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents fake-agent --strategies raw-full-file,my-dev-kit-guided --complexities short,multi-step --max-runs 4 --out lab-output/controlled-experiment-fake-matrix`

Optional Codex command:
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents codex --strategies raw-full-file,my-dev-kit-guided --complexities short --out lab-output/controlled-experiment-codex --include-real-agents --continue-on-failure`

Optional Claude command:
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents claude --strategies raw-full-file,my-dev-kit-guided --complexities short --out lab-output/controlled-experiment-claude --include-real-agents --continue-on-failure`

Expected outputs:
- `experiment-summary.json`
- `experiment-runs.json`
- `experiment-comparisons.json`
- `experiment-config.json`
- `runs/<runId>/prompt.txt`
- `runs/<runId>/agent-run-result.json`
- `runs/<runId>/parsed-answer.json`
- `runs/<runId>/correctness-score.json`

Real-agent campaign note:
- `examples/real-agent-campaign-cases.json` is the bounded medium and large project case set for Codex and Claude campaign runs.

External-agent behavior:
- fake-agent is the default and is used by deterministic tests
- Codex and Claude require `--include-real-agents`
- unavailable CLIs are stored as `agent-unavailable`
- usage limits, rate limits, quotas, and session limits are stored as `agent-limit-reached`
- timeouts are stored as `timeout`
- failed or unparsable outputs still produce artifacts

Current limitations:
- this command writes experiment artifacts only; report rendering, plots, visualization demos, and gallery updates are separate workflows

## Workflow 7: Experiment Report Rendering

Purpose:
- render controlled experiment artifacts into a final HTML report
- show project profile, project complexity metrics, benchmark file tree, prompts, agent outcomes, correctness, token usage, timing, formulas, warnings, and limitations
- optionally capture a screenshot of the generated local HTML report through the existing screenshot layer

Fake-agent command sequence:
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents fake-agent --strategies raw-full-file,my-dev-kit-guided --complexities short --out lab-output/controlled-experiment-fake`
- `npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake --no-screenshot`

Optional screenshot:
- `npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake-shot --screenshot`

Optional Codex and Claude note:
- real-agent experiment artifacts can be rendered the same way after `run-controlled-experiment`
- unavailable CLIs, usage limits, session limits, timeouts, invalid output, and failures remain visible as structured report statuses

Expected outputs:
- `experiment-report.json`
- `experiment-report.html`
- `experiment-report-artifacts.json`
- `experiment-report.png` when screenshot capture is requested and succeeds

Current limitations:
- plots and visualization sections appear only when artifact directories are provided
- full metric definitions live in `docs/METRICS.md`; the HTML report links that glossary through the artifact index

## Workflow 8: Plot Generation

Purpose:
- generate plot-ready data from controlled experiment comparisons
- write deterministic static SVG charts
- preserve warnings for unavailable token or timing comparisons

Command:
- `npm run generate-experiment-plots -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-plots`

Expected outputs:
- `plots-summary.json`
- `plot-data.json`
- six SVG files under `charts/`

## Workflow 9: Visualization Demos

Purpose:
- run bounded my-dev-kit visualization-oriented commands against a benchmark project
- record stdout, stderr, command telemetry, expected artifacts, warnings, and failures
- support fake my-dev-kit for deterministic tests

Command:
- `npm run run-visualization-demos -- --project benchmarks/projects/todo-ts --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/visualization-demos`

Unsupported graph behavior:
- unsupported commands are recorded as failed demo outcomes and warnings
- the demo continues unless `--require-all` is provided

## Workflow 10: Experiment Gallery

Purpose:
- index controlled experiment reports, screenshots, plots, and visualization demo artifacts in the existing gallery manifest
- write a simple static gallery index for local browsing

Command:
- `npm run build-gallery -- --report lab-output/experiment-report-fake --plots lab-output/experiment-plots --visualizations lab-output/visualization-demos --out lab-output/gallery`

Expected outputs:
- `gallery-manifest.json`
- `gallery-index.html`

## Workflow 11: Final Demo

Purpose:
- run the final deterministic local workflow for this feature batch
- run controlled experiment
- generate plots
- run visualization demos
- render an enhanced experiment report
- build gallery
- optionally capture a report screenshot

Command:
- `npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot`

Expected outputs:
- `controlled-experiment/*`
- `plots/*`
- `visualization-demos/*`
- `experiment-report/*`
- `gallery/gallery-manifest.json`
- `gallery/gallery-index.html`

## Workflow 12: Lab Demo And Gallery Workflow

Purpose:
- run the Milestone 1 MVP end to end
- validate benchmarks before evaluation
- generate token-savings artifacts
- capture optional report screenshots
- write a gallery manifest for tutorial and gallery consumers

Command:
- `npm run lab-demo -- --cases examples/lab-demo-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/demo-gallery`

Expected outputs:
- `token-savings-summary.json`
- `token-savings-runs.json`
- `token-savings-report.html`
- `token-savings-report.png` when screenshot capture succeeds
- `gallery-manifest.json`
- `commands/*.stdout.txt`
- `commands/*.stderr.txt`
- `commands/*.telemetry.json`

Failure and skip behavior:
- benchmark validation runs by default and fails the workflow when contracts or project structure are broken
- `--skip-benchmark-validation` skips that step and records a warning
- screenshot capture is attempted by default and skips gracefully when Playwright or the browser runtime is unavailable
- missing or failing my-dev-kit does not fail the workflow unless `--require-kit` is passed

Workflow relationship:
- benchmark validation proves the fixture suite is intact
- profile validation proves project complexity metadata and file trees are trustworthy
- answer-key validation proves later correctness scoring has stable expected facts
- token evaluation produces the structured JSON artifacts
- report rendering converts those results into HTML
- screenshot capture turns the HTML report into a shareable PNG when available
- gallery manifest records how those artifacts fit together
