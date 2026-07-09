# Project Overview

## What is my-dev-kit-lab?

my-dev-kit-lab is the experiment, evidence, reporting, security-validation, and audit companion for my-dev-kit. It now includes three areas of validated capability: experiment/evidence, automated security validation, and a generic audit framework (code-rot audit type) in the current published `v0.3.0` baseline.

my-dev-kit is a local-first repository indexing and graph-guided retrieval CLI. It helps coding agents work with large codebases through reusable structural indexing, graph-guided retrieval, targeted source slices, and auditable context selection. Its strongest use case is when the repository is larger than the task; the project does not assume or claim that guided retrieval always saves tokens.

The lab supplies controlled benchmarks, agent adapters, metrics, reports, plots, screenshots, galleries, and automated CLI/package security checks.

## Current baseline

The current published npm baseline is version `0.3.0`. The generic experiment-plugin runtime introduced in `v0.2.0` is implemented. Its first and currently only registered plugin is `context-strategy-comparison`.

That plugin preserves the established raw-full-file versus my-dev-kit-guided experiment through the generic registry and runner. It supports self and explicit local-project targets, plugin-aware reports, deterministic fake-agent runs, and optional Codex or Claude campaigns. Existing legacy commands and artifacts remain supported.

Automated security validation is also implemented. It supports dependency and package checks, adversarial CLI checks, static scanning integrations, bounded fuzz smoke, structured verdicts, explicit local-project targets, and an attack-scenario layer with profiles, evidence, and report hardening. It is not a manual pentest framework.

The `v0.3.0` generic audit framework is implemented in the current published baseline. It adds `npm run audit`, which currently supports one audit type, `code-rot`, covering 10 heuristic detector families and writing stable text/JSON reports. Audit is a separate tool from both the experiment pipeline and `security:validate`: it does not call `security:validate`.

The checked-out package is release-prepared for `v0.3.1` language-aware code-rot substrate plus TypeScript/JavaScript support. It adds normalized language/file-role inventory, source facts, a TypeScript/JavaScript analyzer, source-facts-aware detector signals, and source-facts report summaries while preserving the existing audit command surface. Python, Java, Kotlin, Android automated security validation, framework-aware profiles, and broader audit types remain future roadmap work.

## Product flow

```mermaid
flowchart LR
  Target[Repository or benchmark target] --> Experiment[Experiment plugin runtime]
  Experiment --> Plugin[context-strategy-comparison]
  Plugin --> Agents[Fake or real agent adapters]
  Agents --> Evidence[Runs, metrics, correctness, artifacts]
  Evidence --> Reports[Reports, plots, screenshots, gallery]

  Target --> Security[Automated security validation]
  Security --> SecurityEvidence[Findings, skips, verdict, attack-scenario evidence, reports]
```

## Users

- maintainers evaluating my-dev-kit behavior
- coding-agent workflow researchers
- teams comparing context-selection strategies
- release engineers collecting local CLI/package security evidence
- contributors adding future experiment or audit capabilities

## What the evidence can establish

The lab can compare matched strategies for a defined target, task, agent, and configuration. It can record correctness, context size, reported or estimated tokens, duration, status, and partial outcomes. It can also preserve the retrieval and report artifacts needed to audit a result.

Results are scoped evidence, not a universal performance claim. Small repositories or broad tasks may favor raw reading. Reused indexes and localized tasks in larger repositories are stronger candidates for graph-guided retrieval.

## Next phases

The current published npm baseline is `v0.3.0`. After that, the immediate direction is:

1. complete the remaining language-aware code-rot track after release-prepared `v0.3.1`: Python in `v0.3.2`, Java/Kotlin in `v0.3.3`, and cross-language stability in `v0.3.4`
2. add Android validation MVP in `v0.4.0`
3. add advanced Android security checks in `v0.4.1`
4. optionally add the Android audit bridge in `v0.4.2`
5. keep manual pentest deferred until after `v1.0.0`

The experiment evidence track then expands through warm-index reuse, freshness and stale-index detection, context-window scaling, retrieval precision/recall, agent success, normalized telemetry, scheduling, prompt hardening, and generalized report/gallery publication.

See [CURRENT_STATE.md](CURRENT_STATE.md) for implemented-versus-planned status and [ROADMAP.md](ROADMAP.md) for semantic version ordering.
