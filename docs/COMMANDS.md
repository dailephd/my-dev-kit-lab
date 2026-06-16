# Commands

This document describes all available commands in my-dev-kit-lab, their options, expected outputs, and when to use each one.

See [docs/WORKFLOWS.md](docs/WORKFLOWS.md) for end-to-end workflow examples that combine multiple commands.

---

## Installation and build

### `npm install` / `npm ci`

Installs all dependencies. Use `npm ci` in CI environments for a clean, reproducible install.

```bash
npm install
```

### `npm run build`

Compiles TypeScript sources to `dist/`. Run this before executing any lab commands.

```bash
npm run build
```

---

## Validation commands

### `npm run test`

Runs the full test suite. Use this to verify that all modules are working correctly.

```bash
npm run test
```

### `npm run test:benchmarks`

Runs benchmark-specific tests: project structure, contract shape, profile validation, answer keys, and complexity metrics.

```bash
npm run test:benchmarks
```

### `npm run test:report`

Runs report rendering tests.

```bash
npm run test:report
```

### `npm run test:experiments`

Runs controlled experiment runner tests.

```bash
npm run test:experiments
```

### `npm run test:plots`

Runs plot generation tests.

```bash
npm run test:plots
```

### `npm run test:gallery`

Runs gallery manifest and index tests.

```bash
npm run test:gallery
```

### `npm run test:integration`

Runs integration tests that exercise multiple modules together.

```bash
npm run test:integration
```

### `npm run verify`

Runs the full verification suite: build, tests, and benchmark checks. Use this as a final check before committing.

```bash
npm run verify
```

---

## Lab commands

### `npm run generate-prompt-variants`

Generates raw-full-file and my-dev-kit-guided prompt variants for each benchmark case at the specified complexity levels. Writes prompt text files and prompt complexity metrics.

**When to use:** Before running an experiment, to preview the prompts that will be sent to agents.

**Options:**
- `--cases` — path to the benchmark case list JSON
- `--out` — output directory for generated prompt variant files

**Example:**
```bash
npm run generate-prompt-variants -- \
  --cases examples/token-savings-cases.json \
  --out lab-output/prompt-variants
```

**Outputs:**
- `lab-output/prompt-variants/<case>/<strategy>/<complexity>.txt`
- `lab-output/prompt-variants/prompt-variants-summary.json`

---

### `npm run run-agent-prompt`

Runs a single prompt against a single agent for a single benchmark case. Writes a prompt preview and an `agent-run-result.json`. Does not compare strategies, score correctness, or update the gallery.

**When to use:** To smoke-test a single agent run or preview what an agent returns for a specific case and strategy.

**Options:**
- `--agent` — agent name: `fake-agent`, `codex`, or `claude`
- `--cases` — path to the benchmark case list JSON
- `--case` — specific case ID to run
- `--strategy` — `raw-full-file` or `my-dev-kit-guided`
- `--complexity` — `short`, `medium`, `long`, or `multi-step`
- `--out` — output directory
- `--require-agent` — fail if the agent CLI is unavailable (default: skip)

**Examples:**
```bash
# Deterministic fake-agent run
npm run run-agent-prompt -- \
  --agent fake-agent \
  --cases examples/token-savings-cases.json \
  --case todo-ts-create-task \
  --strategy raw-full-file \
  --complexity short \
  --out lab-output/agent-run-fake

# Real Codex run (requires local Codex CLI)
npm run run-agent-prompt -- \
  --agent codex \
  --cases examples/token-savings-cases.json \
  --case todo-ts-create-task \
  --strategy my-dev-kit-guided \
  --complexity short \
  --out lab-output/agent-run-codex
```

**Outputs:**
- `lab-output/agent-run-fake/agent-run-result.json`

---

### `npm run run-controlled-experiment`

Runs a controlled experiment comparing `raw-full-file` and `my-dev-kit-guided` strategies across the specified cases, agents, and complexity levels. Pairs runs by case, agent, and complexity, scores correctness from answer keys, and computes token and duration comparisons.

**When to use:** To run a full comparison experiment and produce structured JSON artifacts for reporting.

**Options:**
- `--cases` — path to the benchmark case list JSON
- `--agents` — comma-separated agent names: `fake-agent`, `codex`, `claude`
- `--strategies` — comma-separated strategies: `raw-full-file`, `my-dev-kit-guided`
- `--complexities` — comma-separated complexity levels: `short`, `medium`, `long`, `multi-step`
- `--out` — output directory
- `--include-real-agents` — include Codex and Claude runs (skipped by default)
- `--continue-on-failure` — continue after individual run failures
- `--timeout-ms` — per-run timeout in milliseconds
- `--max-runs` — maximum number of runs to execute

**Examples:**
```bash
# Fake-agent experiment
npm run run-controlled-experiment -- \
  --cases examples/token-savings-cases.json \
  --agents fake-agent \
  --strategies raw-full-file,my-dev-kit-guided \
  --complexities short \
  --out lab-output/controlled-experiment-fake

# Real-agent campaign
npm run run-controlled-experiment -- \
  --cases examples/real-agent-campaign-cases.json \
  --agents codex,claude \
  --strategies raw-full-file,my-dev-kit-guided \
  --complexities medium,multi-step \
  --out lab-output/real-agent-campaign \
  --include-real-agents \
  --continue-on-failure \
  --timeout-ms 240000
```

**Outputs:**
- `lab-output/<out>/experiment-summary.json`
- `lab-output/<out>/experiment-runs.json`
- `lab-output/<out>/experiment-comparisons.json`
- `lab-output/<out>/experiment-config.json`
- `lab-output/<out>/runs/<runId>/` — per-run artifacts

---

### `npm run render-experiment-report`

Renders experiment artifacts into an HTML report with JSON metadata. Optionally captures a PNG screenshot.

**When to use:** After running a controlled experiment, to produce a human-readable report.

**Options:**
- `--experiment` — path to the experiment output directory
- `--out` — output directory for report artifacts
- `--screenshot` / `--no-screenshot` — whether to capture a PNG (default: no screenshot)
- `--plots` — optional path to a plots directory to link in the report
- `--visualizations` — optional path to a visualization demos directory to link in the report

**Examples:**
```bash
# Render without screenshot
npm run render-experiment-report -- \
  --experiment lab-output/controlled-experiment-fake \
  --out lab-output/experiment-report-fake \
  --no-screenshot

# Render with screenshot
npm run render-experiment-report -- \
  --experiment lab-output/controlled-experiment-fake \
  --out lab-output/experiment-report-fake-shot \
  --screenshot
```

**Outputs:**
- `lab-output/<out>/experiment-report.json`
- `lab-output/<out>/experiment-report.html`
- `lab-output/<out>/experiment-report-artifacts.json`
- `lab-output/<out>/experiment-report.png` — when `--screenshot` succeeds

---

### `npm run generate-experiment-plots`

Generates plot data and static SVG charts from experiment artifacts.

**When to use:** After running a controlled experiment, to produce visual summaries of the results.

**Options:**
- `--experiment` — path to the experiment output directory
- `--out` — output directory for plot artifacts

**Example:**
```bash
npm run generate-experiment-plots -- \
  --experiment lab-output/controlled-experiment-fake \
  --out lab-output/experiment-plots
```

**Outputs:**
- `lab-output/experiment-plots/plot-data.json`
- `lab-output/experiment-plots/plots-summary.json`
- `lab-output/experiment-plots/charts/*.svg`

---

### `npm run run-visualization-demos`

Runs bounded my-dev-kit visualization command demos against a benchmark project and writes demo artifacts.

**When to use:** To demonstrate my-dev-kit retrieval commands on a benchmark project and include the results in a gallery.

**Options:**
- `--project` — path to the benchmark project directory
- `--kit-command` — my-dev-kit CLI command string
- `--out` — output directory for demo artifacts

**Example:**
```bash
npm run run-visualization-demos -- \
  --project benchmarks/projects/todo-ts \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --out lab-output/visualization-demos
```

---

### `npm run build-gallery`

Collects report, plot, visualization demo, and screenshot artifacts into a gallery manifest and a static gallery index.

**When to use:** After generating a report, plots, and visualization demos, to publish a browsable gallery.

**Options:**
- `--report` — path to the report output directory
- `--plots` — path to the plots output directory
- `--visualizations` — path to the visualization demos output directory
- `--out` — output directory for gallery artifacts

**Example:**
```bash
npm run build-gallery -- \
  --report lab-output/experiment-report-fake \
  --plots lab-output/experiment-plots \
  --visualizations lab-output/visualization-demos \
  --out lab-output/gallery
```

**Outputs:**
- `lab-output/gallery/gallery-manifest.json`
- `lab-output/gallery/gallery-index.html`

---

### `npm run run-final-demo`

Runs the complete pipeline in one command: controlled experiment → report → plots → visualization demos → gallery. Use this for a full end-to-end demo.

**When to use:** To run the entire pipeline in one step, typically with fake-agent for a deterministic demo.

**Options:**
- `--cases` — path to the benchmark case list JSON
- `--out` — output directory for all artifacts
- `--kit-command` — my-dev-kit CLI command string
- `--agents` — comma-separated agent names
- `--complexities` — comma-separated complexity levels
- `--screenshot` / `--no-screenshot` — whether to capture a PNG

**Example:**
```bash
npm run run-final-demo -- \
  --cases examples/token-savings-cases.json \
  --out lab-output/final-demo \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --agents fake-agent \
  --complexities short \
  --no-screenshot
```

---

### `npm run evaluate-token-savings`

Runs the earlier token-savings evaluation workflow: measures raw full-file baseline context, runs my-dev-kit retrieval, and compares estimated token counts. This is a simpler predecessor to the controlled experiment workflow.

**When to use:** For a quick estimated token comparison without full experiment infrastructure.

**Options:**
- `--cases` — path to the evaluation case list JSON
- `--kit-command` — my-dev-kit CLI command string
- `--out` — output directory
- `--require-kit` — fail if my-dev-kit is unavailable
- `--no-screenshot` — skip PNG capture

**Example:**
```bash
npm run evaluate-token-savings -- \
  --cases examples/token-savings-cases.json \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --out lab-output/token-savings
```

**Note:** Token counts in this workflow are estimated using `Math.ceil(characterCount / 4)`. This is a static context-size comparison, not provider billing telemetry.

---

### `npm run lab-demo`

Runs the earlier quick demo workflow: token-savings evaluation → report → screenshot → gallery manifest.

**When to use:** For a quick demo of the token-savings evaluation pipeline.

**Example:**
```bash
npm run lab-demo -- \
  --cases examples/lab-demo-cases.json \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --out lab-output/demo-gallery
```

---

### `npm run capture-demo-report`

Renders a demo report from a JSON input file and optionally captures a PNG screenshot.

**When to use:** To render a standalone demo report from a custom JSON input.

**Options:**
- `--input` — path to a lab report JSON input file
- `--out` — output directory
- `--no-screenshot` — skip PNG capture

**Example:**
```bash
npm run capture-demo-report -- \
  --input examples/demo-report-input.json \
  --out lab-output/demo-report
```

**Outputs:**
- `lab-output/demo-report/demo-report.json`
- `lab-output/demo-report/demo-report.html`
- `lab-output/demo-report/demo-report.png` — when screenshot capture succeeds

---

## Screenshot capture notes

Screenshot capture uses Playwright and requires a browser runtime. When Playwright or the browser runtime is unavailable, JSON and HTML artifacts are still written and the command succeeds with a warning. Pass `--no-screenshot` to skip capture explicitly.
