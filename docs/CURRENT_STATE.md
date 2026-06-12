# Current State

Implemented now:
- repository foundation
- documentation foundation
- project folder exists
- benchmark sample projects
- benchmark contract
- benchmark validation
- report layer
- screenshot capture as optional report screenshot capture
- token-savings evaluation
- raw full-file baseline
- my-dev-kit retrieval runner as external subprocess integration
- report and screenshot layer reuse for evaluation artifacts
- lab demo workflow
- gallery manifest
- tutorial documentation
- Milestone 1 MVP
- benchmark project profiles
- deterministic benchmark file tree metadata
- project complexity metrics and score formula
- benchmark task answer keys with expected facts
- raw-full-file prompt variants
- my-dev-kit-guided prompt variants
- prompt complexity metrics
- deterministic prompt preview artifacts
- agent adapter interface
- deterministic fake-agent adapter
- Codex CLI adapter
- Claude CLI adapter
- single-prompt `run-agent-prompt` smoke command
- normalized `AgentRunResult` artifacts
- Windows CLI shim resolution for npm-style `.cmd`, `.exe`, and `.ps1` wrappers
- controlled experiment runner under `src/evaluation`
- answer-key-based correctness scoring
- raw-full-file versus my-dev-kit-guided experiment comparisons
- deterministic fake-agent experiment tests
- structured outcomes for unavailable agents, external usage or session limits, timeouts, failures, and invalid output

Not implemented yet:
- provider telemetry
- semantic quality judging
- benchmark generation
- final experiment report redesign
- plots
- visualization demos
- experiment gallery integration

Architecture audit status:
- experiment report architecture audit completed
- migration plan documented in `docs/EXPERIMENT_REPORT_MIGRATION_PLAN.md`
- benchmark metadata and complexity contracts implemented after the audit
- prompt variants and prompt complexity metrics implemented after the metadata upgrade
- agent adapters implemented after prompt variants
- Windows CLI shim compatibility improved after agent adapters
- controlled experiment runtime and correctness scoring are implemented after agent adapters
- Codex and Claude controlled runs remain optional and can fail because of external usage or session limits
- screenshot behavior is unchanged
- gallery behavior is unchanged
- no final experiment report redesign, plot generation, or visualization demo workflow has been added yet
- next prompt is final experiment report redesign
