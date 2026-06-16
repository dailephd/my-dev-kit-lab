# Current State

This document summarizes the current release-ready baseline state of my-dev-kit-lab.

---

## Status: Working baseline

my-dev-kit-lab is at a working baseline. The raw-vs-indexed experiment pipeline is fully implemented and produces reproducible artifacts. Real-agent campaign support exists for Codex and Claude. All core modules are tested and verified.

---

## What is implemented

### Benchmark layer
- Six benchmark projects: four small Todo projects, one medium TypeScript project, one large mixed TypeScript/Python project
- Benchmark contracts with task descriptions, expected files, expected symbols, and answer keys
- Project profiles with complexity metrics and 0-100 complexity scores
- Benchmark verification scripts

### Prompt layer
- Raw-full-file and my-dev-kit-guided prompt variant generation
- Four complexity levels: `short`, `medium`, `long`, `multi-step`
- Prompt complexity metrics computed alongside each variant

### Agent layer
- fake-agent adapter — deterministic, no external CLI required
- Codex adapter — requires local Codex CLI
- Claude adapter — requires local Claude CLI
- Windows-safe CLI command resolution

### Experiment layer
- Controlled experiment runner
- Strategy pairing by case, agent, and complexity level
- Deterministic correctness scoring from answer keys
- Token usage, duration, and status comparisons
- Structured outcomes for timeouts, invalid output, and session limits

### Reporting layer
- HTML experiment report rendering
- JSON experiment report metadata
- Optional PNG screenshot capture via Playwright
- Static SVG plot generation
- Visualization demos using my-dev-kit commands

### Gallery layer
- Gallery manifest writer
- Static gallery index HTML

### Pipeline commands
- `npm run generate-prompt-variants`
- `npm run run-agent-prompt`
- `npm run run-controlled-experiment`
- `npm run render-experiment-report`
- `npm run generate-experiment-plots`
- `npm run run-visualization-demos`
- `npm run build-gallery`
- `npm run run-final-demo`
- `npm run evaluate-token-savings`
- `npm run lab-demo`
- `npm run capture-demo-report`
- `npm run verify`

---

## What is not yet implemented

- Provider telemetry dashboards
- OpenTelemetry collection
- Semantic LLM judging
- Cloud API billing integration
- Generic experiment-plugin framework
- Warm-index reuse experiments
- Incremental-change experiments
- Context-window scaling experiments
- Retrieval precision and recall experiments
- Agent-success-rate experiments
- Richer gallery UI with filtering and comparison views
- Benchmark project generator

---

## Real-agent campaign status

A real-agent campaign was run on the `feature/real-agent-benchmark-campaign` branch using Codex and Claude against the medium and large benchmark projects (`task-workflow-medium-ts` and `task-analytics-large-mixed`).

Campaign results were partial. Real-agent CLIs can produce completed runs, timeouts, invalid output, and session limits. The campaign infrastructure recorded all outcomes as structured JSON. The experiment report shows warnings for missing token totals and non-completed runs.

**Claude** does not expose token totals; token savings comparisons are unavailable for Claude runs.

**Codex** may expose token totals but produced some timeouts and invalid-output runs during the campaign.

These partial results demonstrate that the experiment infrastructure works end-to-end with real agents. They do not constitute proof of token savings. Stronger evidence requires future experiment types. See [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Output locations

| Artifact | Location |
|---|---|
| Experiment summary | `lab-output/<experiment>/experiment-summary.json` |
| All runs | `lab-output/<experiment>/experiment-runs.json` |
| Strategy comparisons | `lab-output/<experiment>/experiment-comparisons.json` |
| HTML report | `lab-output/<report>/experiment-report.html` |
| Report JSON | `lab-output/<report>/experiment-report.json` |
| Report screenshot | `lab-output/<report>/experiment-report.png` |
| Plot data | `lab-output/<plots>/plot-data.json` |
| Plots summary | `lab-output/<plots>/plots-summary.json` |
| SVG charts | `lab-output/<plots>/charts/*.svg` |
| Gallery manifest | `lab-output/<gallery>/gallery-manifest.json` |
| Gallery index | `lab-output/<gallery>/gallery-index.html` |

---

## Next development direction

The next major development phase is the generic experiment-plugin framework. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full roadmap.
