# Architecture

Repository layers:

- `benchmarks/`: deterministic benchmark projects and benchmark contracts
- `docs/`: project, workflow, and roadmap documentation
- `src/`: reusable lab runtime code, initially minimal
- `scripts/`: command entrypoints and verification helpers
- `tests/`: root validation and parity tests

Benchmark layer:

The benchmark layer is the current center of the repository. It contains small, intentionally cheap sample projects that all implement the same Todo Core behavior across different language layouts.

Future report layer:

Later prompts will add report generation and screenshot capture around benchmark runs. That layer will consume benchmark definitions and validation results but is not implemented in Prompt 1.

Future evaluation layer:

Later prompts will compare raw full-file context against my-dev-kit retrieval results. That layer will use the benchmark contracts and project fixtures defined here.

Future provider telemetry layer:

Provider telemetry and adapter-specific metadata belong in a later layer that records run details without changing benchmark semantics. This is not part of Prompt 1.

Boundary between my-dev-kit and my-dev-kit-lab:

my-dev-kit remains the indexing and retrieval engine. my-dev-kit-lab owns benchmark inputs, validation, reports, and future evaluation workflows. In later prompts, my-dev-kit-lab will call my-dev-kit externally rather than importing internal my-dev-kit implementation details directly.
