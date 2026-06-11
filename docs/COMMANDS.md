# Commands

Install:
- `npm install`

Tests:
- `npm run test`
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
