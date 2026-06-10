# Architecture

Repository layers:

- `benchmarks/`: deterministic benchmark projects and benchmark contracts
- `docs/`: project, workflow, and roadmap documentation
- `src/report/`: report types, HTML rendering, and artifact writing
- `src/screenshot/`: optional PNG capture from generated local HTML reports
- `src/commands/`: reusable command implementations
- `src/`: reusable lab runtime code and exports
- `scripts/`: command entrypoints and verification helpers
- `tests/`: root validation and parity tests

Benchmark layer:

The benchmark layer is the current center of the repository. It contains small, intentionally cheap sample projects that all implement the same Todo Core behavior across different language layouts.

Report layer:

The report layer normalizes lab report input, renders deterministic local HTML, and writes JSON and HTML artifacts. It is the reusable artifact foundation for benchmark validation today and token/context evaluation in Prompt 3.

Screenshot layer:

The screenshot layer consumes generated local HTML reports and produces optional PNG captures. The flow is `lab artifact JSON -> HTML report -> PNG screenshot`.

Screenshot output is presentation evidence, not the source of evaluation truth. JSON remains the structured artifact of record. HTML is the readable report view. PNG is a shareable snapshot of that report.

Future evaluation layer:

Later prompts will compare raw full-file context against my-dev-kit retrieval results. That layer will feed token-savings and evaluation artifacts into the same report layer instead of creating a second reporting architecture.

Future provider telemetry layer:

Provider telemetry and adapter-specific metadata belong in a later layer that records run details without changing benchmark semantics. This is not part of Prompt 1.

Boundary between my-dev-kit and my-dev-kit-lab:

my-dev-kit remains the indexing and retrieval engine. my-dev-kit-lab owns benchmark inputs, validation, reports, and future evaluation workflows. In later prompts, my-dev-kit-lab will call my-dev-kit externally rather than importing internal my-dev-kit implementation details directly.
