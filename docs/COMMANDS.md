# Commands

Install:
- `npm install`

Tests:
- `npm run test`
- `npm run test:plots`
- `npm run test:visualization-demos`
- `npm run test:agents`
- `npm run test:report`
- `npm run test:screenshot`
- `npm run test:evaluation`
- `npm run test:gallery`
- `npm run test:demo`
- `npm run test:integration`
- `npm run test:e2e`
- `npm --prefix benchmarks/projects/todo-ts test`
- `npm --prefix benchmarks/projects/todo-js test`
- `npm --prefix benchmarks/projects/todo-mixed-ts-py test`

Benchmark verification:
- `npm run test:benchmarks`
- `npm run verify:benchmarks`
- `npm run verify`
- `python -m unittest discover benchmarks/projects/todo-python/tests`

Benchmark verification validates:
- benchmark project structure
- behavior contract presence
- benchmark task contract shape
- per-project expected files
- benchmark project profiles in `benchmarks/contracts/benchmark-project-profiles.json`
- deterministic file-tree metadata
- nonnegative complexity metrics and 0-100 complexity scores
- answer keys, unique expected fact IDs, and valid `minimumCorrectFacts`

Capture demo report:
- `npm run capture-demo-report -- --input examples/demo-report-input.json --out lab-output/demo-report`
- `--input`: path to a lab report JSON input file
- `--out`: output directory for generated artifacts
- `--no-screenshot`: skip PNG capture and write JSON and HTML only

Expected output files:
- `demo-report.json`
- `demo-report.html`
- `demo-report.png` when screenshot capture succeeds

Evaluate token savings:
- `npm run evaluate-token-savings -- --cases examples/token-savings-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/token-savings`
- `--cases`: path to the evaluation case list JSON
- `--kit-command`: external my-dev-kit command string
- `--out`: output directory for evaluation artifacts
- `--require-kit`: fail if my-dev-kit is unavailable or errors
- `--no-screenshot`: skip PNG capture and write JSON and HTML only

Expected output files:
- `token-savings-summary.json`
- `token-savings-runs.json`
- `token-savings-report.html`
- `token-savings-report.png` when screenshot capture succeeds
- `commands/*.stdout.txt`
- `commands/*.stderr.txt`
- `commands/*.telemetry.json`

Generate prompt variants:
- `npm run generate-prompt-variants -- --cases examples/token-savings-cases.json --out lab-output/prompt-variants`
- `--cases`: path to the evaluation case list JSON
- `--out`: output directory for prompt preview artifacts
- `--project-profiles`: optional path to benchmark project profiles, defaults to `benchmarks/contracts/benchmark-project-profiles.json`
- `--strategy`: optional filter, `raw-full-file` or `my-dev-kit-guided`
- `--complexity`: optional filter, `short`, `medium`, `long`, or `multi-step`

Expected output files:
- `prompt-variants-summary.json`
- `prompt-variants.json`
- `prompts/<caseId>.<strategy>.<complexity>.txt`

This command only writes prompt previews. It does not run Codex, Claude, fake agents, correctness scoring, screenshots, reports, or gallery updates.

Run one agent prompt:
- `npm run run-agent-prompt -- --agent fake-agent --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy raw-full-file --complexity short --out lab-output/agent-run-fake`
- `--agent`: `fake-agent`, `codex`, or `claude`
- `--cases`: path to the evaluation case list JSON
- `--case`: evaluation case ID to run
- `--strategy`: `raw-full-file` or `my-dev-kit-guided`
- `--complexity`: `short`, `medium`, `long`, or `multi-step`
- `--out`: output directory for prompt and agent-run artifacts
- `--command-template`: optional command override for real CLI adapters; use `{prompt}` as the prompt placeholder
- `--require-agent`: fail if a real CLI adapter is unavailable instead of skipping
- `--timeout-ms`: optional timeout for real CLI adapter prompt execution through the shared measured command runtime

Expected output files:
- `prompt.txt`
- `agent-run-result.json`
- `*.stdout.txt`, `*.stderr.txt`, and `*.telemetry.json` when the selected adapter writes command telemetry

This command runs one generated prompt through one adapter. It does not run all cases, compare strategies, score correctness, render final experiment reports, capture screenshots, or update the gallery.

Run a controlled experiment:
- `npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents fake-agent --strategies raw-full-file,my-dev-kit-guided --complexities short --out lab-output/controlled-experiment-fake`
- `--cases`: path to the evaluation case list JSON
- `--project-profiles`: optional path to benchmark project profiles, defaults to `benchmarks/contracts/benchmark-project-profiles.json`
- `--case`: optional evaluation case ID filter; may be repeated or comma-separated
- `--benchmark-project`: optional benchmark project ID filter; may be repeated or comma-separated
- `--agents`: comma-separated `fake-agent`, `codex`, or `claude`; defaults to `fake-agent`
- `--strategies`: comma-separated `raw-full-file` and/or `my-dev-kit-guided`; defaults to both
- `--complexities`: comma-separated `short`, `medium`, `long`, or `multi-step`; defaults to `short`
- `--out`: output directory for experiment artifacts
- `--timeout-ms`: optional timeout for real CLI adapter prompt execution
- `--max-runs`: optional cap for smoke tests
- `--continue-on-failure`: continue writing artifacts after individual failed runs; this is the default safe behavior
- `--require-agents`: turn unavailable real agents into failed adapter results
- `--include-real-agents`: required before Codex or Claude matrix runs are allowed
- `--command-template-codex`: optional Codex command override; use `{prompt}` as the prompt placeholder
- `--command-template-claude`: optional Claude command override; use `{prompt}` as the prompt placeholder

Expected output files:
- `experiment-summary.json`
- `experiment-runs.json`
- `experiment-comparisons.json`
- `experiment-config.json`
- `runs/<runId>/prompt.txt`
- `runs/<runId>/agent-run-result.json`
- `runs/<runId>/parsed-answer.json`
- `runs/<runId>/correctness-score.json`

This command writes structured experiment artifacts only. It does not render the final visual experiment report, capture screenshots, create plots, run visualization demos, or update the gallery manifest.

Render a controlled experiment report:
- `npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake --no-screenshot`
- `--experiment`: path to an existing controlled experiment output directory
- `--out`: output directory for report artifacts
- `--title`: optional report title override
- `--subtitle`: optional report subtitle override
- `--screenshot`: capture `experiment-report.png` through the existing screenshot layer
- `--no-screenshot`: skip PNG capture; this is the default
- `--require-screenshot`: fail if screenshot capture is requested but cannot complete
- `--max-prompt-chars`: optional prompt excerpt length cap for the HTML report
- `--max-file-tree-entries`: optional per-project file tree entry cap
- `--plots`: optional plot artifact directory to link in the report
- `--visualizations`: optional visualization demo artifact directory to link in the report

Expected output files:
- `experiment-report.json`
- `experiment-report.html`
- `experiment-report-artifacts.json`
- `experiment-report.png` when `--screenshot` succeeds

This command consumes existing controlled experiment artifacts. It does not run agents, run controlled experiments, generate plots, run visualization demos, or update the gallery manifest.

Generate experiment plots:
- `npm run generate-experiment-plots -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-plots`
- `--experiment`: controlled experiment output directory
- `--out`: output directory for plot artifacts

Expected output files:
- `plots-summary.json`
- `plot-data.json`
- `charts/token-savings-vs-prompt-length.svg`
- `charts/time-reduction-vs-prompt-length.svg`
- `charts/token-savings-vs-project-complexity.svg`
- `charts/time-reduction-vs-project-complexity.svg`
- `charts/correctness-by-strategy.svg`
- `charts/run-outcomes-by-agent.svg`

Run visualization demos:
- `npm run run-visualization-demos -- --project benchmarks/projects/todo-ts --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/visualization-demos`
- `--project`: benchmark project directory
- `--kit-command`: fake or real my-dev-kit command
- `--out`: output directory
- `--query`: optional search query
- `--node`: optional node ID for source smoke command
- `--require-all`: stop/fail when a visualization command fails
- `--timeout-ms`: optional command timeout

Real my-dev-kit example:
- `npm run run-visualization-demos -- --project benchmarks/projects/todo-ts --kit-command "node ../my-dev-kit-v1/dist/cli.js" --out lab-output/visualization-demos-real`

Expected output files:
- `visualization-demo-summary.json`
- `visualization-demo-runs.json`
- `commands/<command-id>/*.stdout.txt`
- `commands/<command-id>/*.stderr.txt`
- `commands/<command-id>/*.telemetry.json`
- `artifacts/*` when graph commands produce output

Build gallery:
- `npm run build-gallery -- --report lab-output/experiment-report-fake --plots lab-output/experiment-plots --visualizations lab-output/visualization-demos --out lab-output/gallery`
- `--report`: experiment report directory
- `--plots`: experiment plot directory
- `--visualizations`: visualization demo directory
- `--experiment`: optional controlled experiment directory
- `--out`: gallery output directory

Expected output files:
- `gallery-manifest.json`
- `gallery-index.html`

Run final demo:
- `npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot`
- `--cases`: evaluation cases file
- `--out`: final demo output directory
- `--kit-command`: fake or real my-dev-kit command
- `--agents`: comma-separated `fake-agent`, `codex`, or `claude`; defaults to `fake-agent`
- `--strategies`: comma-separated strategies; defaults to both
- `--complexities`: comma-separated complexity levels; defaults to `short`
- `--case`: optional case filter
- `--benchmark-project`: optional project filter
- `--max-runs`: optional run cap
- `--screenshot` or `--no-screenshot`: optional report screenshot
- `--include-real-agents`: allow Codex or Claude
- `--continue-on-failure`: continue after failed runs
- `--timeout-ms`: optional command timeout

The final demo uses fake-agent and fake my-dev-kit cleanly for deterministic local runs. It does not require real Codex, Claude, my-dev-kit, network, or cloud APIs.

Expected output directories:
- `controlled-experiment/*`
- `plots/*`
- `visualization-demos/*`
- `experiment-report/*`
- `gallery/gallery-manifest.json`
- `gallery/gallery-index.html`

Windows CLI shim notes:
- npm-installed CLIs may appear as `codex.cmd`, `codex.exe`, `codex.ps1`, or extensionless commands on PATH
- the shared measured command runtime resolves extensionless commands on Windows before spawning
- `.cmd` and `.bat` wrappers are invoked through a controlled `cmd.exe` command path, not `shell: true`
- `.ps1` wrappers are invoked through `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <shim>` only after resolving a `.ps1` shim
- `.cmd` is preferred over `.ps1` when both are available
- use `--command-template` to override local CLI syntax, for example `codex exec --json {{prompt}}` or `claude --print {{prompt}}`
- use `--require-agent` when a missing or unusable real CLI should fail the command instead of writing a skipped result

Run the full lab demo:
- `npm run lab-demo -- --cases examples/lab-demo-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/demo-gallery`
- `--cases`: path to the lab demo case list JSON
- `--kit-command`: external my-dev-kit command string
- `--out`: output directory for the complete demo artifacts
- `--require-kit`: fail if my-dev-kit is unavailable or errors
- `--no-screenshot`: skip PNG capture and write JSON and HTML only
- `--skip-benchmark-validation`: skip benchmark verification and record a warning

Expected output files:
- `token-savings-summary.json`
- `token-savings-runs.json`
- `token-savings-report.html`
- `token-savings-report.png` when screenshot capture succeeds
- `gallery-manifest.json`
- `commands/*.stdout.txt`
- `commands/*.stderr.txt`
- `commands/*.telemetry.json`
