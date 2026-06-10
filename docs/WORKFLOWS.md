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
- no token/context comparison
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
- token-savings evaluation
- tutorial and gallery workflow
- provider telemetry
