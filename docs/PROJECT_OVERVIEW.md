# Project Overview

my-dev-kit-lab is the benchmark and evaluation companion repository for my-dev-kit.

It exists so benchmark assets, validation logic, screenshots, controlled experiment workflows, plots, and gallery artifacts have a dedicated home instead of being mixed into the retrieval engine itself.

The problem it solves is repeatability. my-dev-kit needs small, deterministic projects that can be indexed, queried, and evaluated in a controlled way. The lab repository provides those fixtures, the contracts they follow, and the tests that prove they stay aligned.

Benchmark projects provide a stable baseline for screenshot capture, token/context comparisons, controlled experiments, visualization demos, and optional provider-specific runs without changing the benchmark semantics each time.

The completed feature batch covers:
- documentation foundation
- repository and branch setup
- deterministic benchmark projects
- benchmark contracts
- validation tests and scripts
- deterministic report generation
- optional screenshot capture from local reports
- raw full-file context baseline
- external my-dev-kit retrieval measurement
- estimated token/context comparison artifacts
- prompt variants and prompt complexity metrics
- fake-agent, Codex, and Claude adapter wiring
- controlled experiment orchestration and correctness scoring
- experiment report rendering
- deterministic static SVG plots
- bounded my-dev-kit visualization demos
- gallery orchestration over those existing layers

Provider telemetry dashboards, OpenTelemetry collection, semantic LLM judging, cloud API integration, richer gallery UI, larger benchmark suites, and benchmark generation remain future work.
