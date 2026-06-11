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
- no provider telemetry
- no prompt variants
- no agent execution workflow
- no correctness scoring runtime

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
- no Codex or Claude execution
- no fake-agent execution
- no correctness scoring runtime
- no report or gallery display of prompt comparisons yet

## Workflow 5: Lab Demo And Gallery Workflow

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
