# Project Overview

## What is my-dev-kit-lab?

my-dev-kit-lab is for maintainers, release engineers, coding-agent researchers, and contributors who need evidence about repository-context choices and local project health. A retrieval strategy can look efficient without selecting the right evidence. A project can also appear release-ready without consistent package, CLI, audit, or Android checks.

The project combines controlled experiments, deterministic fixtures, agent adapters, conservative audits, automated security validation, and reviewable reports. It records what ran, what evidence was available, what was skipped, and which limitations apply.

[my-dev-kit](https://www.npmjs.com/package/@dailephd/my-dev-kit) is the local-first indexing and graph-guided retrieval CLI being evaluated. my-dev-kit-lab is the separate experiment and validation layer. Workflow-packet inputs from my-dev-kit-orchestrator are read by the implemented v0.4.3 stage-context strategies through exact, non-normalizing readers; the orchestrator is not a runtime dependency.

Cross-repository workflows are documented once in [my-dev-kit/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md](https://github.com/dailephd/my-dev-kit/blob/main/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md). That guide combines static evidence from my-dev-kit, Orchestrator lifecycle, rendered evidence from my-frontend-observer, project tests, and risk-based Lab assurance. This repository retains its own [command reference](COMMANDS.md) and [Lab workflows](WORKFLOWS.md), not a duplicate ecosystem guide.

The compositions are externally executed recipes, not new Lab commands or a claim of a validated four-tool runtime pipeline. Field-failure feedback must be converted into a supported experiment/test contract before Lab can evaluate it. The installed CLI does not automatically ingest arbitrary workflow-feedback or Observer artifacts. Required assurance failures and unavailable required evidence cannot be counted as passed feature gates.

The strongest retrieval use case is a localized task in a repository that is larger than the task. The project measures that claim under defined conditions rather than assuming that guided retrieval always saves tokens.

## Current baseline

The latest release is v0.4.8 (locator-anchored pointer gestures for browser tutorials), which completes a missing visual-editor interaction class by adding locator-anchored pointer gestures (`pointer-click` and `pointer-drag`) using normalized fraction coordinates inside a single located surface, while existing `drag` remains element-to-element. Version v0.4.7 introduced generic tutorial automation while preserving product-specific demo ownership outside this repository. Version v0.5.0 warm-index reuse follows immediately afterward. See [CURRENT_STATE.md](CURRENT_STATE.md) for operational details, [CHANGELOG.md](../CHANGELOG.md) for release history, and [ROADMAP.md](ROADMAP.md) for future scope.

Context-integrity evaluation compares condition-aware producer evidence against orchestrator run-integrity evidence for a fixed request, target, and index identity, reporting agreement or contradiction between them rather than re-deriving either project's own verdict. It runs deterministically against a frozen, hash-verified regression fixture pair and produces bounded reports; it introduces no CLI, no live workflow replay, and no composite score, grade, ranking, or winner.

The generic experiment-plugin runtime has one registered plugin, `context-strategy-comparison`. It compares raw-full-file and my-dev-kit-guided strategies through a common runner and supports deterministic fake-agent runs, optional Codex or Claude campaigns, self-validation, and explicit local-project targets.

Automated security validation is implemented, supporting dependency and package checks, adversarial CLI checks, static scanning integrations, bounded fuzz smoke, structured verdicts, explicit local-project targets, and an attack-scenario layer with profiles, evidence, and report hardening. It is not a manual pentest framework. The installed command is `my-dev-kit-lab security validate`. `npm run security:validate` remains the source-checkout alias into the same focused command owner.

Android validation is implemented through `security validate --profile android` (or the source-checkout `security:validate` alias): project detection, manifest parsing, permission/exported-component/deep-link audits, static Gradle metadata, and eleven advanced internal checks, for nineteen default checks with zero default Gradle, external-tool, or network activity.

The generic audit framework provides language-aware `code-rot` detectors for TypeScript/JavaScript, Python, Java, and Kotlin. Its `security` type adapts the standalone validator's results into audit issues while preserving the original `reports/security/` output.

The `--android` extension maps confirmed Android findings through that same adapter and keeps `CandidateEvidence` separate. Audit remains distinct from both experiments and `security:validate`.

Java/Kotlin support is conservative and static only: no compiler parsing, no type/classpath resolution, and no Gradle/Maven execution. Android validation is likewise static and read-only; see [security-validation-framework.md](security-validation-framework.md) for its full limits.

Code-quality audit, project-wide combined audit defaults, framework-aware profiles, JVM package/environment rot, Gradle/Maven dependency freshness checks, and manual pentest remain future roadmap work.

The current tutorial capability executes `TutorialScenarioV1` scenarios through a persistent Playwright browser session against a trusted local target contract. It supports bounded actions and assertions, visual overlays, WebM recording, step screenshots, SRT/VTT subtitles, Markdown, and a versioned tutorial manifest. In v0.4.7, tutorial automation was introduced with element-to-element `drag`. Released v0.4.8 completes a missing visual-editor interaction class by adding bounded `pointer-click` and `pointer-drag` actions anchored to one existing locator with normalized fraction coordinates, while retaining the no-arbitrary-JavaScript/no-page-coordinate boundary. The generic packaged example is owned by this lab; product-specific demo sites and scenario definitions remain in their owning repositories.

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
  Security --> Android[Android validation]

  Target --> Audit[Generic audit framework]
  Audit --> CodeRot[Code-rot detectors]
  Audit --> Security

  Target --> Tutorial[Declarative browser tutorial runtime]
  Tutorial --> TutorialEvidence[WebM, screenshots, subtitles, Markdown, manifest]
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

Version v0.4.3 evaluates stage-specific bounded repository context and workflow instructions through the existing experiment infrastructure and is published. Version v0.4.4 added the producer-readiness bridge through programmatically configured inputs while preserving upstream producer and readiness ownership. Version v0.4.5 evaluates agreement between condition-aware producer evidence and orchestrator run-integrity evidence against a frozen, deterministic, hash-verified regression fixture pair. Version v0.4.6 added the installed-package CLI and runtime-boundary correction. Version v0.4.7 introduced the generic persistent-browser runtime, managed demo processes, bounded scenario actions and assertions, visible tutorial overlays, WebM recording, synchronized screenshots/subtitles/Markdown, a tutorial manifest, and clean-consumer package acceptance while keeping product-specific demo sites and scenarios in their owning repositories. Version v0.4.8 completes a missing visual-editor interaction class by adding locator-anchored fraction `pointer-click` and `pointer-drag` using real Playwright mouse input, keeping existing `drag` unchanged, extending the generic real-browser/packed-package fixture, and preserving all current safety boundaries. Version v0.5.0 warm-index reuse follows next.

Later work covers freshness and stale-index detection, context-window scaling, retrieval precision and recall, agent success, normalized telemetry, scheduling, prompt hardening, tutorial-manifest gallery consumption, and a generalized evidence portal.

These later items remain planned. Manual pentest remains a human-led post-v1/version-TBD workflow and is not part of the current automated validation system.

See [CURRENT_STATE.md](CURRENT_STATE.md) for implemented-versus-planned status and [ROADMAP.md](ROADMAP.md) for semantic version ordering.
