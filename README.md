# my-dev-kit-lab

my-dev-kit-lab is the evidence, benchmark, screenshot, and evaluation companion for my-dev-kit. It exists to host deterministic benchmark projects, validation workflows, and later report-oriented lab runs that measure how my-dev-kit retrieval compares with raw full-file context.

my-dev-kit is the indexing and retrieval engine. my-dev-kit-lab is the separate lab layer that feeds it benchmark inputs and records evaluation outputs.

Current status: Milestone 1 Prompts 1 and 2 are implemented. The repository currently contains the documentation foundation, benchmark contracts, four deterministic benchmark projects, report artifact generation, and optional report screenshot capture.

Planned Milestone 1 features:
- Prompt 1: project foundation, branch workflow, benchmark projects, and benchmark validation
- Prompt 2: report and screenshot capture
- Prompt 3: token/context comparison between raw full-file reading and my-dev-kit retrieval
- Prompt 4: tutorial and gallery workflow

Quick commands:
- `npm install`
- `npm run build`
- `npm run test`
- `npm run test:benchmarks`
- `npm run capture-demo-report -- --input examples/demo-report-input.json --out lab-output/demo-report`
- `npm run verify`

Benchmark projects:
- `benchmarks/projects/todo-ts`
- `benchmarks/projects/todo-js`
- `benchmarks/projects/todo-python`
- `benchmarks/projects/todo-mixed-ts-py`

They exist to provide the same small Todo Core behavior in different language layouts so later prompts can compare retrieval quality, screenshots, and context usage against a stable benchmark suite.

Not implemented yet:
- token-savings evaluation
- provider telemetry
- Codex or Claude adapters
- gallery workflow

Install:
- `npm install`

Run tests:
- `npm run test`
- `npm run test:benchmarks`
- `npm run test:report`
- `npm run test:screenshot`
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

Token-savings evaluation is Prompt 3 and is not implemented yet. Install and usage details are documented in [docs/COMMANDS.md](docs/COMMANDS.md).
