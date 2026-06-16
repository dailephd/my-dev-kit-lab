# Architecture

## Current architecture

my-dev-kit-lab is organized as a layered pipeline. Each layer has a focused responsibility and writes structured artifacts that the next layer consumes.

### Module map

| Module | Path | Responsibility |
|---|---|---|
| Benchmarks | `benchmarks/` | Deterministic benchmark projects, contracts, and answer keys |
| Core utilities | `src/core/` | Token counting, safe paths, file glob collection, subprocess execution |
| Evaluation | `src/evaluation/` | File tree building, complexity scoring, benchmark metadata validation |
| Prompts | `src/prompts/` | Raw-full-file and my-dev-kit-guided prompt generation, prompt complexity metrics |
| Agents | `src/agents/` | fake-agent, Codex, and Claude adapter interfaces |
| Experiment runner | `src/commands/` | Controlled experiment orchestration, correctness scoring, artifact writing |
| Report | `src/report/` | Experiment report input model, HTML rendering, artifact writing |
| Screenshot | `src/screenshot/` | Optional PNG capture from generated local HTML reports |
| Plots | `src/plots/` | Plot-ready data generation and deterministic SVG chart rendering |
| Visualization demos | `src/visualizationDemos/` | Bounded my-dev-kit visualization command demos |
| Gallery | `src/gallery/` | Gallery manifest types and writer |
| Scripts | `scripts/` | Command entrypoints and verification helpers |
| Tests | `tests/` | Validation and parity tests |

---

### Current architecture diagram

```mermaid
graph TD
  subgraph Benchmarks
    BP[Benchmark Projects]
    BC[Benchmark Contracts\nand Answer Keys]
    PP[Project Profiles\nComplexity Scores]
  end

  subgraph Prompts
    PV[Prompt Variant Generator]
    PM[Prompt Complexity Metrics]
  end

  subgraph Agents
    FA[fake-agent]
    CX[Codex adapter]
    CL[Claude adapter]
  end

  subgraph Experiment
    ER[Controlled Experiment Runner]
    CS[Correctness Scorer]
    EA[Experiment Artifacts\nJSON]
  end

  subgraph Reporting
    RR[Report Renderer]
    PG[Plot Generator]
    VD[Visualization Demos]
    SC[Screenshot Capture]
  end

  subgraph Gallery
    GM[Gallery Manifest]
    GI[Gallery Index HTML]
  end

  BP --> PV
  BC --> PV
  PP --> PV
  PV --> FA
  PV --> CX
  PV --> CL
  FA --> ER
  CX --> ER
  CL --> ER
  BC --> CS
  ER --> CS
  CS --> EA
  EA --> RR
  EA --> PG
  EA --> VD
  RR --> SC
  RR --> GM
  PG --> GM
  VD --> GM
  SC --> GM
  GM --> GI
```

---

## How data moves through the system

### 1. Benchmark layer

Benchmark projects under `benchmarks/projects/` provide stable, version-controlled source trees at different complexity levels. Benchmark contracts in `benchmarks/contracts/` define task descriptions, expected files, expected symbols, and answer keys. Project profiles in `benchmarks/contracts/benchmark-project-profiles.json` store complexity metrics and complexity scores.

### 2. Prompt layer

The prompt variant generator reads benchmark cases and produces instruction text at `short`, `medium`, `long`, and `multi-step` complexity levels. Each variant is either a `raw-full-file` prompt (full file contents inlined) or a `my-dev-kit-guided` prompt (instructions to use my-dev-kit retrieval commands). Prompt complexity metrics are computed alongside each variant.

### 3. Agent layer

Agent adapters execute a single prompt against a benchmark case and return a structured result. The fake-agent adapter returns deterministic outputs without any external CLI. The Codex and Claude adapters invoke local CLI tools and capture stdout, stderr, token totals (when available), and duration. Runs that time out, produce invalid output, or hit session limits are recorded as structured outcomes.

### 4. Experiment runner

The controlled experiment runner pairs `raw-full-file` and `my-dev-kit-guided` runs for each combination of case, agent, and complexity level. It scores correctness against answer keys, computes token and duration comparisons for matched pairs, and writes `experiment-summary.json`, `experiment-runs.json`, and `experiment-comparisons.json`.

### 5. Reporting layer

The report renderer reads experiment artifacts and produces `experiment-report.json` and `experiment-report.html`. The plot generator reads experiment artifacts and produces `plot-data.json` and SVG charts. Visualization demos run bounded my-dev-kit commands against a benchmark project and write demo artifacts. Screenshot capture optionally produces a PNG from the HTML report.

### 6. Gallery layer

The gallery writer collects report, plot, visualization demo, and screenshot artifacts into a `gallery-manifest.json` and a static `gallery-index.html`.

---

## Raw-vs-indexed experiment data path

```mermaid
flowchart TD
  A[Benchmark Case\nand Answer Key] --> B[Generate Prompt Variants\nraw-full-file + my-dev-kit-guided]
  B --> C[Run raw-full-file\nvia agent adapter]
  B --> D[Run my-dev-kit-guided\nvia agent adapter]
  C --> E[raw run result JSON]
  D --> F[guided run result JSON]
  E --> G[Pair Runs\nby case + agent + complexity]
  F --> G
  G --> H[Score Correctness\nfrom answer key]
  G --> I[Compare Tokens\nand Duration]
  H --> J[experiment-comparisons.json]
  I --> J
  J --> K[Report Renderer]
  K --> L[experiment-report.html]
```

---

## Future experiment-plugin architecture

The next major development phase refactors my-dev-kit-lab into a generic experiment framework. The current pipeline becomes the first experiment plugin.

### Plugin model

Each experiment plugin declares:
- **Trial plan** — which cases, agents, strategies, and complexity levels to run
- **Agent execution** — how to invoke agents and collect results
- **Metric collection** — which metrics to record per run
- **Scoring** — how to evaluate run outputs
- **Report sections** — which sections to include in the HTML report
- **Plot sections** — which charts to generate
- **Screenshot capture** — whether to capture a PNG
- **Gallery publishing** — which artifacts to include in the gallery

### Future plugin architecture diagram

```mermaid
graph TD
  subgraph Runtime
    TP[Trial Planner]
    AE[Agent Executor]
    MC[Metric Collector]
    SC[Scorer]
    RP[Report Builder]
    PL[Plot Builder]
    SS[Screenshot Capture]
    GP[Gallery Publisher]
  end

  subgraph Plugins
    P1[context-strategy-comparison\ncurrent raw-vs-indexed]
    P2[warm-index-reuse]
    P3[incremental-change-staleness]
    P4[context-window-scaling]
    P5[retrieval-precision-recall]
    P6[agent-success-rate]
  end

  P1 --> TP
  P2 --> TP
  P3 --> TP
  P4 --> TP
  P5 --> TP
  P6 --> TP
  TP --> AE
  AE --> MC
  MC --> SC
  SC --> RP
  SC --> PL
  RP --> SS
  RP --> GP
  PL --> GP
  SS --> GP
```

### Migration path

```mermaid
flowchart TD
  A[Current: hardcoded\nraw-vs-indexed pipeline] --> B[Extract shared runtime\nfrom current pipeline]
  B --> C[Wrap current experiment\nas context-strategy-comparison plugin]
  C --> D[Validate plugin produces\nsame artifacts as current pipeline]
  D --> E[Add warm-index-reuse plugin]
  E --> F[Add incremental-change plugin]
  F --> G[Add context-window-scaling plugin]
  G --> H[Add retrieval-precision-recall plugin]
```

---

## Benchmark projects

| Project | Size | Languages |
|---|---|---|
| `todo-ts` | small | TypeScript |
| `todo-js` | small | JavaScript |
| `todo-python` | small | Python |
| `todo-mixed-ts-py` | small | TypeScript + Python |
| `task-workflow-medium-ts` | medium | TypeScript |
| `task-analytics-large-mixed` | large | TypeScript + Python |

---

## Key contract files

| File | Purpose |
|---|---|
| `benchmarks/contracts/benchmark-project-profiles.json` | Project descriptions, complexity metrics, complexity scores |
| `benchmarks/contracts/todo-benchmark-case.json` | Task definitions, expected files, expected symbols, answer keys |
| `examples/real-agent-campaign-cases.json` | Bounded real-agent campaign evaluation cases |
| `docs/METRICS.md` | Canonical metric glossary |
