# Changelog

All notable changes to my-dev-kit-lab are documented here.

## [0.1.0] - 2026-06-16

### Initial public baseline

**Experiment pipeline**
- Raw-vs-indexed context experiment: compares `raw-full-file` and `my-dev-kit-guided` strategies across benchmark cases
- Controlled experiment runner with paired run comparison by case, project, agent, and prompt complexity
- Deterministic correctness scoring from benchmark answer keys (not semantic LLM judging)
- Token usage, duration, and status comparisons between matched strategy pairs

**Benchmark projects**
- `todo-ts`, `todo-js`, `todo-python`, `todo-mixed-ts-py` — small baseline projects
- `task-workflow-medium-ts` — medium TypeScript project
- `task-analytics-large-mixed` — large mixed TypeScript/Python project
- Project complexity metrics: file count, lines of code, language count, import count, exported symbol estimate, complexity score (0–100 weighted)

**Agent adapters**
- Fake-agent adapter for deterministic smoke and demo validation (no external CLI required)
- Codex adapter for real-agent campaigns (requires local Codex CLI and usage capacity)
- Claude adapter for real-agent campaigns (requires local Claude CLI; token totals not exposed)
- Windows-safe CLI command resolution

**Report, plot, screenshot, and gallery pipeline**
- HTML experiment report rendering with project profile, strategy comparisons, correctness, token savings, and warnings
- Static SVG plot generation
- Optional PNG screenshot capture via headless browser
- Gallery manifest and static gallery index output

**Documentation**
- Full user-facing documentation: README, PROJECT_OVERVIEW, ARCHITECTURE, WORKFLOWS, COMMANDS, TUTORIAL, METRICS, ROADMAP, GALLERY, CURRENT_STATE
- Metric glossary (docs/METRICS.md)
- Real-agent campaign report and final batch handoff notes

### Known limitations

- Token savings in fake-agent runs are estimated from character counts, not provider billing telemetry
- Claude does not expose token totals; token savings comparisons are unavailable for Claude runs
- Codex runs may produce timeouts, invalid output, or hit session limits
- Small projects may show negative token savings because raw-full-file is cheaper when the entire project fits in context
- Current baseline does not yet prove every future value claim; stronger evidence requires future experiment types

### Next roadmap phase

The next major development phase is a generic experiment-plugin framework. The current raw-vs-indexed pipeline will become the first experiment plugin (`context-strategy-comparison`). Future plugins will cover warm-index reuse, incremental-change staleness, context-window scaling, retrieval precision/recall, and agent-success-rate experiments.
