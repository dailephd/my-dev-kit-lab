# Project Overview

my-dev-kit-lab is the benchmark and evaluation companion repository for my-dev-kit.

It exists so benchmark assets, validation logic, screenshots, and later comparison workflows have a dedicated home instead of being mixed into the retrieval engine itself.

The problem it solves is repeatability. my-dev-kit needs small, deterministic projects that can be indexed, queried, and evaluated in a controlled way. The lab repository provides those fixtures, the contracts they follow, and the tests that prove they stay aligned.

Benchmark projects support future evaluation by giving later prompts a stable baseline for screenshot capture, token/context comparisons, and provider-specific runs without changing the benchmark semantics each time.

MVP scope for Milestone 1 is intentionally narrow:
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
- tutorial and gallery orchestration over those existing layers

Provider telemetry, semantic quality judging, and benchmark generation remain future work.
