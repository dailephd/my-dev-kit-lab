# Tutorial

`my-dev-kit-lab` demonstrates the Milestone 1 MVP workflow for deterministic benchmark validation, estimated token/context comparison, report generation, optional screenshot capture, and gallery packaging.

## Benchmark Projects

The benchmark projects under `benchmarks/projects` are intentionally small Todo Core implementations. They exist to keep validation, retrieval, and static context comparisons cheap and reproducible.

Benchmark metadata lives in `benchmarks/contracts/benchmark-project-profiles.json` and `benchmarks/contracts/todo-benchmark-case.json`. Verification now checks project profiles, compact file trees, complexity metrics, and task answer keys in addition to the original fixture structure.

Run benchmark validation:

```bash
npm run verify:benchmarks
```

## Capture A Demo Report Screenshot

Prompt 2 added a report renderer and optional screenshot capture path:

```bash
npm run capture-demo-report -- --input examples/demo-report-input.json --out lab-output/demo-report
```

Screenshots capture generated local HTML reports. They are presentation artifacts, not arbitrary browser-page screenshots.

## Run Token-Savings Evaluation

Prompt 3 added the raw full-file baseline and external my-dev-kit retrieval workflow:

```bash
npm run evaluate-token-savings -- --cases examples/token-savings-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/token-savings
```

Token counts in the MVP are estimated with `estimated_chars_div_4`. They are static context estimates, not provider billing telemetry.

## Generate Prompt Variant Previews

Prompt variants compare two future agent-instruction strategies without running an agent:

- `raw-full-file`: assumes full source files will be supplied separately by a later runner
- `my-dev-kit-guided`: asks the agent to use my-dev-kit `index`, `search`, `lookup`, `slice`, and `source` before reading broad context

Run:

```bash
npm run generate-prompt-variants -- --cases examples/token-savings-cases.json --out lab-output/prompt-variants
```

The command writes `prompt-variants-summary.json`, `prompt-variants.json`, and text files under `prompts/`. Prompt complexity metrics use the existing `estimated_chars_div_4` token estimator.

## Run A Single Agent Prompt

Prompt 4 added a small adapter smoke command. It runs one generated prompt through one adapter and writes a normalized `AgentRunResult`.

Use fake-agent for deterministic local checks:

```bash
npm run run-agent-prompt -- --agent fake-agent --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy raw-full-file --complexity short --out lab-output/agent-run-fake
```

Codex and Claude adapters are optional CLI adapters. They skip when unavailable unless `--require-agent` is passed. This is not the controlled experiment runner and does not score correctness.

## Test Real Agents Locally

Real-agent checks are optional for automated tests. On Windows, npm CLI shims may resolve to `.cmd`, `.exe`, or `.ps1` files; the shared measured command runtime resolves those wrappers before running Codex or Claude.

Codex example:

```bash
npm run run-agent-prompt -- --agent codex --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy my-dev-kit-guided --complexity short --out lab-output/agent-run-codex
```

Claude example:

```bash
npm run run-agent-prompt -- --agent claude --cases examples/token-savings-cases.json --case todo-ts-create-task --strategy my-dev-kit-guided --complexity short --out lab-output/agent-run-claude
```

Use `--command-template` if your installed CLI has different non-interactive flags, and use `--require-agent` when a skipped real-agent run should be treated as a failure.

## Run A Controlled Experiment

Prompt 5 added the controlled experiment runner. Use fake-agent for deterministic local checks and CI tests:

```bash
npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents fake-agent --strategies raw-full-file,my-dev-kit-guided --complexities short --out lab-output/controlled-experiment-fake
```

The command writes JSON artifacts only: summary, runs, comparisons, config, prompts, agent results, parsed answers, and correctness scores. Correctness is scored from benchmark answer keys; no LLM judge or network service is used.

Codex and Claude runs are optional:

```bash
npm run run-controlled-experiment -- --cases examples/token-savings-cases.json --agents codex --strategies raw-full-file,my-dev-kit-guided --complexities short --max-runs 2 --out lab-output/controlled-experiment-codex --include-real-agents --continue-on-failure
```

Real-agent runs can hit external usage limits, session limits, local CLI availability issues, or timeouts. Those are recorded as structured run outcomes so experiment artifacts are still inspectable.

## Render The Controlled Experiment Report

Prompt 6 turns controlled experiment artifacts into a final HTML report:

```bash
npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake --no-screenshot
```

Open `lab-output/experiment-report-fake/experiment-report.html` in a browser. The report includes the project description, complexity metrics, compact file tree, benchmark task, prompt strategy excerpts, agent run statuses, correctness scores, token comparisons, timing comparisons, formulas, aggregate answers, warnings, and limitations.

To capture a screenshot from the same generated local HTML:

```bash
npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake-shot --screenshot
```

Use fake-agent output to verify the workflow deterministically. Fake-agent results are smoke evidence, not proof that real Codex or Claude sessions will behave the same way. Real Codex and Claude experiment artifacts can be rendered too, and any usage limits, session limits, timeouts, or invalid outputs will appear as structured report outcomes.

Interpret aggregate answers conservatively:

- `yes`: most available comparisons support the claim
- `no`: most available comparisons contradict the claim
- `mixed`: available comparisons disagree or correctness outcomes differ
- `inconclusive`: there is not enough comparable data
- `unavailable`: required token or timing totals are missing

## Generate Plots And Visualization Demos

Generate deterministic SVG charts from controlled experiment artifacts:

```bash
npm run generate-experiment-plots -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-plots
```

The charts cover token savings and execution-time reduction against prompt length and project complexity, correctness by strategy, and run outcome counts by agent.

Run bounded my-dev-kit visualization demos with the fake CLI:

```bash
npm run run-visualization-demos -- --project benchmarks/projects/todo-ts --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/visualization-demos
```

Inspect `visualization-demo-runs.json` for command status, stdout/stderr paths, telemetry paths, and produced graph artifacts.

## Build The Experiment Gallery

Build a gallery manifest and local index:

```bash
npm run build-gallery -- --report lab-output/experiment-report-fake --plots lab-output/experiment-plots --visualizations lab-output/visualization-demos --out lab-output/gallery
```

Open `gallery-index.html` for a compact local artifact index, or inspect `gallery-manifest.json` for structured paths.

## Run The Final Demo

Prompt 7 adds the full deterministic final demo:

```bash
npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot
```

This produces controlled experiment artifacts, plot data, SVG charts, visualization demo artifacts, an enhanced experiment report, and gallery artifacts. Use `--screenshot` to capture `experiment-report.png` when local screenshot dependencies are available.

## Run The All-In-One Lab Demo

Prompt 4 ties the Milestone 1 pieces together:

```bash
npm run lab-demo -- --cases examples/lab-demo-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/demo-gallery
```

This workflow runs:

- benchmark validation
- token-savings evaluation
- HTML report generation
- optional PNG screenshot capture
- gallery manifest writing

## Use Generated Artifacts

The generated output is designed for:

- README examples
- GitHub issue or pull request evidence
- npm package documentation later
- tutorial screenshots
- portfolio walkthroughs

The key artifacts are `token-savings-summary.json`, `token-savings-runs.json`, `token-savings-report.html`, optional `token-savings-report.png`, and `gallery-manifest.json`.

## MVP Limits

- token counts are estimated, not provider-reported
- provider telemetry is future work
- screenshots capture generated reports, not arbitrary browser pages
- semantic quality judging is not implemented in Milestone 1
- provider telemetry dashboards and cloud API billing dashboards are future work
