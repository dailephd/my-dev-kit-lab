# Workflows

## Workflow 1: Benchmark Project Validation

Purpose:
- validate benchmark contracts
- validate benchmark project structure
- validate behavior parity across benchmark projects

Commands:
- `npm run test:benchmarks`
- `npm run verify:benchmarks`
- `npm run verify`
- `python -m unittest discover benchmarks/projects/todo-python/tests`

Expected outputs:
- passing benchmark contract checks
- passing benchmark structure checks
- passing parity checks for TypeScript, JavaScript, Python, and mixed boundary projects
- concise pass/fail output from the benchmark verification script

Current limitations:
- no provider telemetry
- no gallery workflow

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
- no token/context comparison
- no provider telemetry
- no gallery workflow

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
