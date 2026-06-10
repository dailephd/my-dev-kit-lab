# my-dev-kit-lab

my-dev-kit-lab is the evidence, benchmark, screenshot, and evaluation companion for my-dev-kit. It exists to host deterministic benchmark projects, validation workflows, and later report-oriented lab runs that measure how my-dev-kit retrieval compares with raw full-file context.

my-dev-kit is the indexing and retrieval engine. my-dev-kit-lab is the separate lab layer that feeds it benchmark inputs and records evaluation outputs.

Current status: Milestone 1 Prompt 1 foundation is in progress on the benchmark branch. The repository currently focuses on documentation, benchmark contracts, sample projects, and validation workflows.

Planned Milestone 1 features:
- Prompt 1: project foundation, branch workflow, benchmark projects, and benchmark validation
- Prompt 2: report and screenshot capture
- Prompt 3: token/context comparison between raw full-file reading and my-dev-kit retrieval
- Prompt 4: tutorial and gallery workflow

Quick commands:
- `npm install`
- `npm run build`
- `npm run test`
- `npm run test:benchmarks`
- `npm run verify`

Not implemented yet:
- screenshot capture
- token-savings evaluation
- provider telemetry
- Codex or Claude adapters
- HTML report rendering
- gallery workflow

Install and usage details are documented in [docs/COMMANDS.md](docs/COMMANDS.md).
