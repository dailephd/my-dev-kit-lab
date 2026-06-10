# Architecture

Repository layers:

- `benchmarks/`: deterministic benchmark projects and benchmark contracts
- `docs/`: project, workflow, and roadmap documentation
- `src/report/`: report types, HTML rendering, and artifact writing
- `src/screenshot/`: optional PNG capture from generated local HTML reports
- `src/core/`: shared utilities for token counting, safe paths, file glob collection, and measured subprocess execution
- `src/evaluation/`: raw baseline, my-dev-kit retrieval, token comparison, and artifact generation
- `src/gallery/`: gallery manifest types and writer
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

Evaluation layer:

The evaluation layer measures two paths for each benchmark case:

- `RawFullFileBaselineRunner`: reads deterministic full-file context using safe, sorted file expansion under the benchmark target root
- `MyDevKitRetrievalRunner`: calls my-dev-kit externally as a subprocess using the sequence `index -> search -> lookup -> slice -> source`
- `TokenSavingsComparator`: compares estimated chars and estimated tokens between the two paths and aggregates the results

This layer writes structured JSON artifacts and feeds the results into the existing report layer. It does not create a second reporting or screenshot architecture.

my-dev-kit is called externally, not imported. This keeps my-dev-kit-lab decoupled from my-dev-kit internals and allows configurable commands such as `my-dev-kit`, `npx @dailephd/my-dev-kit`, or `node ../my-dev-kit-v1/dist/cli.js`.

Gallery layer:

The gallery layer packages evaluation outputs into a portable manifest that can drive README examples, GitHub evidence, tutorial references, later portfolio templates, and future gallery surfaces without changing the underlying evaluator.

Lab-demo orchestration layer:

The lab-demo command is an orchestrator over the existing Milestone 1 pieces. It validates benchmarks, runs token-savings evaluation, reuses the existing report and screenshot layers, and writes a gallery manifest.

Final Milestone 1 data flow:

`benchmark validation -> token-savings evaluation -> report JSON -> report HTML -> optional screenshot PNG -> gallery manifest -> tutorial documentation`

Gallery output is generated from evaluation artifacts. Screenshots remain presentation artifacts derived from the generated HTML report, not the evaluation source of truth.

Future provider telemetry layer:

Provider telemetry and adapter-specific metadata belong in a later layer that records run details without changing benchmark semantics. This is not part of Milestone 1.

Boundary between my-dev-kit and my-dev-kit-lab:

my-dev-kit remains the indexing and retrieval engine. my-dev-kit-lab owns benchmark inputs, validation, reports, and future evaluation workflows. In later prompts, my-dev-kit-lab will call my-dev-kit externally rather than importing internal my-dev-kit implementation details directly.
