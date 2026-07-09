# Project Overview

## What is my-dev-kit-lab?

my-dev-kit-lab is the experiment, evidence, reporting, security-validation, and audit companion for my-dev-kit. It now includes three areas of validated capability: experiment/evidence, automated security validation, and a generic audit framework in the current published `v0.3.1` baseline (`code-rot` audit type, plus language-aware TypeScript/JavaScript source facts). The checked-out package state additionally implements Python-aware code-rot evidence and a security-validation audit adapter (`security` audit type) as `v0.3.2` release-prepared work. Package metadata is version-bumped, but publication has not happened yet. The audit framework does not perform code-quality analysis; that remains a planned, unimplemented audit type.

my-dev-kit is a local-first repository indexing and graph-guided retrieval CLI. It helps coding agents work with large codebases through reusable structural indexing, graph-guided retrieval, targeted source slices, and auditable context selection. Its strongest use case is when the repository is larger than the task; the project does not assume or claim that guided retrieval always saves tokens.

The lab supplies controlled benchmarks, agent adapters, metrics, reports, plots, screenshots, galleries, and automated CLI/package security checks.

## Current baseline

The current published npm baseline is version `0.3.1`. The generic experiment-plugin runtime introduced in `v0.2.0` is implemented. Its first and currently only registered plugin is `context-strategy-comparison`.

That plugin preserves the established raw-full-file versus my-dev-kit-guided experiment through the generic registry and runner. It supports self and explicit local-project targets, plugin-aware reports, deterministic fake-agent runs, and optional Codex or Claude campaigns. Existing legacy commands and artifacts remain supported.

Automated security validation is also implemented. It supports dependency and package checks, adversarial CLI checks, static scanning integrations, bounded fuzz smoke, structured verdicts, explicit local-project targets, and an attack-scenario layer with profiles, evidence, and report hardening. It is not a manual pentest framework. `security:validate` remains its standalone, focused command.

The generic audit framework is implemented in the current published baseline. `v0.3.0` added `npm run audit` with one audit type, `code-rot`, covering 10 heuristic detector families and writing stable text/JSON reports; `v0.3.1` added a language-aware source-facts substrate and TypeScript/JavaScript analyzer for those same detectors. Audit is a separate tool from both the experiment pipeline and `security:validate`.

The checked-out package state is `v0.3.2` release-prepared: a Python analyzer and Python project metadata extending the language-aware source-facts substrate to Python, and a security-validation audit adapter that makes `security` the second implemented audit type. The adapter calls `security:validate`'s internals directly, maps its findings into audit issues, adds a `securitySummary` report field, and preserves `security:validate`'s original `reports/security/` output unchanged. It does not replace or duplicate that command. Code-quality audit, project-wide combined audit defaults, Java, Kotlin, Android automated security validation, framework-aware profiles, and manual pentest remain future roadmap work.

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

The current published npm baseline is `v0.3.1`. After that, the immediate direction is:

1. publish `v0.3.2` (Python code-rot support and the security-validation audit adapter are release-prepared; publication remains pending)
2. complete the remaining language-aware code-rot track: Java/Kotlin in `v0.3.3`, and cross-language stability in `v0.3.4`
3. add Android validation MVP in `v0.4.0`
4. add advanced Android security checks in `v0.4.1`
5. optionally add an Android-specific extension of the security audit adapter in `v0.4.2`
6. keep manual pentest deferred until after `v1.0.0`

The experiment evidence track then expands through warm-index reuse, freshness and stale-index detection, context-window scaling, retrieval precision/recall, agent success, normalized telemetry, scheduling, prompt hardening, and generalized report/gallery publication.

See [CURRENT_STATE.md](CURRENT_STATE.md) for implemented-versus-planned status and [ROADMAP.md](ROADMAP.md) for semantic version ordering.
