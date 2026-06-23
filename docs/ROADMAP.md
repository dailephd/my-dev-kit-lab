# Roadmap

This document describes the current baseline state of my-dev-kit-lab and the planned development phases ahead.

---

## Roadmap overview

```mermaid
flowchart TD
  A[Current Baseline\nraw-vs-indexed pipeline\nreal-agent campaign support] --> B[Next Phase\nGeneric experiment-plugin framework\ncontext-strategy-comparison plugin migration]
  B --> C[Experiment Track\nWarm-index reuse experiments\nIncremental-change experiments]
  C --> D[Experiment Track\nContext-window scaling\nRetrieval precision and recall]
  D --> E[Experiment Track\nAgent-success-rate experiments\nReal-agent hardening\nRicher gallery and report UX]
  B --> F[Release-Security Track\nSecurity model and test matrix\npackage and dependency checks]
  F --> G[Release-Security Track\nCLI adversarial tests\nstatic scan integration]
  G --> H[Release-Security Track\nFuzz smoke tests\nrelease security reports]
```

---

## Current baseline

The current baseline is a fully working experiment pipeline for the raw-vs-indexed context comparison.

### What is implemented

- **Benchmark projects** — small, medium, and large benchmark projects with version-controlled source trees
- **Project complexity metrics** — weighted 0-100 complexity scores, file counts, line counts, language counts, import counts, and symbol estimates
- **Benchmark case metadata** — task descriptions, expected files, expected symbols, and answer keys
- **Prompt variant generation** — raw-full-file and my-dev-kit-guided variants at `short`, `medium`, `long`, and `multi-step` complexity levels with prompt complexity metrics
- **Agent adapters** — fake-agent (deterministic), Codex, and Claude
- **Windows-safe CLI command resolution** — safe subprocess execution on Windows
- **Controlled experiment runner** — pairs raw-full-file and my-dev-kit-guided runs by case, agent, and complexity; scores correctness from answer keys; computes token and duration comparisons
- **Report rendering** — HTML experiment report with project profiles, benchmark tasks, strategy comparisons, correctness scores, token usage, duration, status, warnings, and limitations
- **Plot generation** — static SVG charts from experiment data
- **Screenshot capture** — optional PNG capture from generated HTML reports
- **Gallery output** — gallery manifest and static gallery index
- **Visualization demos** — bounded my-dev-kit command demos against benchmark projects
- **Final demo workflow** — single command that runs the complete pipeline
- **Real-agent campaign support** — Codex and Claude campaigns with structured outcomes for timeouts, invalid output, and session limits
- **Metric glossary** — [METRICS.md](METRICS.md)

### Current benchmark projects

| Project | Size | Languages |
|---|---|---|
| `todo-ts` | small | TypeScript |
| `todo-js` | small | JavaScript |
| `todo-python` | small | Python |
| `todo-mixed-ts-py` | small | TypeScript + Python |
| `task-workflow-medium-ts` | medium | TypeScript |
| `task-analytics-large-mixed` | large | TypeScript + Python |

### Current limitations

- Token savings in fake-agent runs are estimated from character counts, not provider billing telemetry
- Claude does not expose token totals
- Codex may produce timeouts or invalid-output runs
- The current baseline does not yet prove every future value claim for my-dev-kit
- Provider telemetry dashboards, semantic LLM judging, and cloud API billing integration are not yet implemented
- The experiment pipeline is currently hardcoded for the raw-vs-indexed comparison; adding new experiment types requires significant pipeline changes

---

## Next phase: Generic experiment-plugin framework

The next major development item is to refactor my-dev-kit-lab into a generic experiment framework.

### What this means

Instead of a single hardcoded pipeline, each experiment type becomes a plugin. The shared runtime handles trial planning, agent execution, metric collection, scoring, report building, plot building, screenshot capture, and gallery publishing. Each plugin declares what it needs from the runtime.

The current raw-vs-indexed experiment becomes the first plugin: **context-strategy-comparison**.

### Migration steps

```mermaid
flowchart TD
  A[Extract shared runtime\nfrom current pipeline] --> B[Define experiment plugin interface]
  B --> C[Wrap current raw-vs-indexed experiment\nas context-strategy-comparison plugin]
  C --> D[Validate plugin produces\nsame artifacts as current pipeline]
  D --> E[Framework is ready\nfor new plugins]
```

### Why this matters

- New experiment types can be added as plugins without rebuilding the pipeline
- The shared runtime handles common concerns: agent execution, metric collection, report sections, gallery publishing
- Each plugin focuses only on what makes its experiment type unique

---

## Parallel track: Release-security validation for my-dev-kit

my-dev-kit-lab will also add a planned release-security track for **my-dev-kit**. This track is separate from the generic experiment-plugin framework and does not replace it. The goal is to produce repeatable security-validation evidence that release preparation for the local CLI/package can consume.

This is not a web-application pentest roadmap. The target under validation is a local CLI/package, so the correct model is CLI/package adversarial testing and release-gate evidence around these boundaries:

- local-first
- deterministic
- read-only with respect to user source files
- network-free during normal CLI operation
- LLM-free
- database-free
- safe to run on local repositories

The planned framework is described in [security-validation-framework.md](security-validation-framework.md). The milestones below describe how it fits into the roadmap.

### Security validation flow

```mermaid
flowchart LR
  A[Static scans\nCodeQL + Semgrep] --> E[Security report]
  B[Dependency and package checks\nnpm audit + OSV + npm pack dry run] --> E
  C[CLI adversarial tests\ntemp directories + built CLI] --> E
  D[Fuzz smoke tests\nbounded parser stress] --> E
  E --> F[Release verdict\nrelease gate for preparation]
```

### Phase 1: Security model and test matrix — **Implemented (v0.1.2)**

Security model, types, config, test matrix, command runner, and artifact writer are implemented in `src/securityValidation/`.

### Phase 2: Package and dependency checks — **Implemented (v0.1.2)**

`security:deps` runs `npm audit`, `npm audit --omit=dev`, OSV-Scanner (if available), `npm outdated`, and `npm ls --all`. `security:package` runs `npm pack --dry-run` and checks for forbidden contents.

### Phase 3: CLI adversarial tests — **Implemented (v0.1.2–v0.1.3)**

`test:security` runs 165 adversarial tests across path traversal, read-only boundary checks, malformed artifact handling, JSON stdout/stderr safety, subprocess safety, and data volume edge cases. All tests run against a deterministic `fake-adversarial-cli.js` fixture; real CLI opt-in available via `MY_DEV_KIT_SECURITY_TARGET_COMMAND`.

### Phase 4: Static scan integration — **Implemented (v0.1.4)**

`security:codeql` checks local CodeQL CLI availability and skips gracefully when absent. `security:semgrep` scans `src/` using `.semgrep.yml` rules via local binary or npx fallback. Both produce structured `SecurityCheckResult` outputs.

### Phase 5: Fuzz smoke tests — **Implemented (v0.1.4)**

`test:fuzz:smoke` runs 9 bounded fuzz targets (50 iterations each) with a seeded PRNG (Mulberry32 / `0xDEADBEEF`). Targets cover manifest reader, code-graph reader, npm parsers, DOT label escaping, path normalization, and source windowing. Completes in under 1 second.

### Phase 6: Release report generator — **Implemented (v0.1.4)**

`security:validate` orchestrates all security checks and writes:

- `reports/security/<prefix>-security-validation.txt` — 22-section human-readable report
- `reports/security/<prefix>-security-validation.json` — machine-readable report with `schemaVersion: 1`

Four release verdicts are possible:

- `ready for release preparation`
- `not ready: security blocker remains`
- `ready except optional manual checks`
- `inconclusive: audit environment incomplete`

When `--target` is omitted, the command performs self-validation. With `--target <path>`, it validates another local project without modifying target files and records tool-root and target-root metadata separately. Generated reports are excluded from git by default (`.gitignore`).

### Security commands (all implemented)

| Command | Description |
|---|---|
| `npm run security:deps` | Dependency and supply-chain audit |
| `npm run security:package` | Package tarball content inspection |
| `npm run security:codeql` | CodeQL CLI check (skips if absent) |
| `npm run security:semgrep` | Semgrep scan (npx fallback; skips if both absent) |
| `npm run test:security` | 165 adversarial CLI tests |
| `npm run test:fuzz:smoke` | 9 bounded fuzz targets |
| `npm run security:validate` | Full release gate with verdict and reports |

---

## Future phases

### Warm-index reuse experiments

```mermaid
flowchart TD
  A[Index benchmark project\none time] --> B[Run N queries\nagainst warm index]
  B --> C[Measure amortized\nper-query cost]
  C --> D[Compare with\ncold-start raw-full-file]
  D --> E[warm-index-reuse report]
```

The warm-index-reuse plugin will measure the amortized cost of my-dev-kit indexing when the index is reused across multiple queries. Cold-start comparisons understate this benefit because the indexing cost is paid only once.

### Incremental-change and stale-index experiments

```mermaid
flowchart TD
  A[Index project at version N] --> B[Apply incremental changes]
  B --> C[Run queries against stale index]
  C --> D[Measure correctness degradation]
  D --> E[Re-index and compare]
  E --> F[incremental-change report]
```

The incremental-change plugin will measure how well a partially stale index still guides retrieval after code changes, and how quickly correctness recovers after re-indexing.

### Context-window scaling experiments

This plugin will measure what happens as project size grows toward and beyond agent context window limits. Raw-full-file becomes infeasible at large scale; my-dev-kit-guided retrieval is expected to remain viable.

### Retrieval precision and recall experiments

This plugin will measure whether my-dev-kit retrieves the right files and symbols for a given task, not just fewer tokens. Precision and recall against answer keys will provide a more direct measure of retrieval quality.

### Agent-success-rate experiments

This plugin will measure overall agent task success rates across strategies, agents, and project sizes, going beyond token counts to measure whether agents actually complete tasks correctly.

### Real-agent campaign hardening

Improvements to real-agent campaign reliability: better timeout handling, retry logic, structured outcome reporting, and support for additional agent CLIs.

### Richer gallery and report UX

Interactive gallery with filtering, tagging, and side-by-side comparison views. Richer report sections with drill-down into individual runs.

### Dependency maintenance

Regular updates to Node.js, TypeScript, Playwright, and other dependencies.

---

## Roadmap sequence

```mermaid
flowchart LR
  A[Baseline\ncomplete] --> B[Plugin framework\nnext]
  B --> C[Experiment track\nwarm-index reuse]
  B --> D[Experiment track\nincremental change]
  C --> E[Context-window\nscaling]
  D --> E
  E --> F[Retrieval\nprecision/recall]
  F --> G[Agent success\nrate]
  G --> H[Real-agent\nhardening]
  H --> I[Richer gallery\nand report UX]
  B --> J[Security phase 1\nmodel and matrix]
  J --> K[Security phase 2\npackage and deps]
  K --> L[Security phase 3\nCLI adversarial tests]
  L --> M[Security phase 4\nstatic scans]
  M --> N[Security phase 5\nfuzz smoke]
  N --> O[Security phase 6\nrelease report]
```

---

## Project support

Sponsorships and donations help support continued independent development, maintenance, documentation, and future experiment-framework work.

- [Sponsor on GitHub](https://github.com/sponsors/dailephd)
- [Support via PayPal](https://paypal.me/daile88)
