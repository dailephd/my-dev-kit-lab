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
- full controlled agent experiments are future work
