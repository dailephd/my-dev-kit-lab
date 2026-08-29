# Architecture

## Android architecture

`src/mobile/android` adds Android validation to the existing security, audit, and evidence systems. Validation is non-destructive and static by default. Gradle operations, external tools, and network requests require explicit opt-in.

`src/audits/security` adds Android summaries and report references to the existing security audit adapter through `--android`. It does not create a parallel adapter or map `CandidateEvidence` to `AuditIssue`.

## Current implemented architecture

my-dev-kit-lab is the experiment, evidence, audit, and validation companion for my-dev-kit. The generic experiment-plugin architecture is implemented rather than being a migration in progress. The audit framework provides `code-rot` and `security`, including the Android-aware extension, over language-aware source facts for TypeScript/JavaScript, Python, Java, and Kotlin.

### Module map

```text
src/
  core/                                      shared process, path, token, and target utilities
  runtime/                                   v0.4.6 execution-context foundation: package-root discovery, LabExecutionContext (invocationCwd/packageRoot/workspaceRoot/resourceRoot), package-resource resolution
  cli/                                       v0.4.6 installed CLI router (runLabCli) and its help renderers; owns argument/command routing only, delegates to command owners under src/commands/
  commands/                                  shared command owners (argument parsing, target/output resolution, exit-code mapping) called by both the installed CLI router and the contributor npm-script thin adapters under scripts/ -- one implementation per capability, not two
  experiments/                               plugin runtime
    config.ts                                shared configuration loading
    defaultRegistry.ts                       built-in plugin registration
    registry.ts                              plugin lookup and uniqueness
    runner.ts                                generic execution lifecycle
    target.ts                                self/external-local target resolution
    types.ts                                 plugin contracts and normalized results
    plugins/contextStrategyComparison/       first implemented plugin; also owns the six v0.4.3 stage-context strategies
  evaluation/                                benchmark, controlled-run, scoring, and metrics logic
    upstreamArtifacts/                       exact ContextCapsule/RetrievalAuditRecord/WorkflowInstructionPacket mirrors, validators, and readers (v0.4.3); plus exact supplemental implementation/test-context packet/retrieval-report readers and a bounded plain-object readiness adapter (v0.4.4); plus exact condition-aware producer evidence mirrors (roleConditionCoverage, allocation/spillover GroupTruncationEntry fields, truncation.requiredEvidenceLost) and exact orchestrator run-integrity mirrors (RunIntegrityGateResult, JudgeIntegrityResult, FinalReportEligibilityResult, artifact-state.json lifecycle records) (v0.4.5)
    stageContextSelectors/                   selectors and consistency diagnostics over exact reader output (v0.4.3); plus orchestrator run-integrity selectors (v0.4.5)
    stageContextExpectations/                StageContextExpectationFixtureV1 contract and validation (v0.4.3); additive, optional producer-readiness expectations (v0.4.4)
    stageContextMetrics/                     evidence-centered evaluation metrics (v0.4.3); additive owner/allocation/truncation/agreement/criticality calculators plus evaluateProducerReadinessBridge, which composes them once per run over already-loaded evidence (v0.4.4); plus additive allocation/spillover/condition-coverage/producer-condition-agreement metrics and run-integrity agreement calculators, composed into the same bridge (v0.4.5)
    targetImmutability/                      read-only target snapshot and mutation comparison (v0.4.3)
    stageContextDeterminism/                 canonicalization and repeated-run digest comparison (v0.4.3)
    ecosystemFixtures/                       frozen ecosystem regression fixture manifest types, hash verification, and fixture loading (v0.4.5)
  agents/                                    fake-agent, Codex, and Claude adapters
  prompts/                                   prompt variant generation and prompt complexity metrics
  audits/                                    generic audit framework (code-rot and security audit types implemented)
    core/                                    target resolution, config, registry, inventory, source-of-truth, source facts, language analyzer registry, Python + JVM project metadata, exit-code policy, runner
    codeRot/                                 code-rot audit type
      detectors/                             10 code-rot detector families (TS/JS-, Python-, and Java/Kotlin-aware where source facts are available)
      utils/                                 shared detector helpers (bounded reads, doc-claim/command-reference parsing, JVM source-facts helpers, text-line utilities)
    security/                                security audit adapter: adapts securityValidation results into audit issues/report summary, including the Android-aware extension
    report/                                  audit report model, JSON/text renderers, writer, text sanitizer
  report/
    experiments/                             plugin-aware JSON/HTML/text report support (text renderer and the v0.4.3 stage-context section); plus the bounded ContextIntegrityReportV1 JSON/text/HTML report layer (v0.4.5), reusing V043BoundedReportListV1/V043ReportAvailability rather than duplicating them
    ...                                      shared and legacy report infrastructure
  mobile/android/                            Android detection, manifest parsing, static Gradle metadata, and advanced security checks
  securityValidation/                        automated security validation
    dependencies/                            npm and OSV checks
    packageChecks/                           npm package-content inspection
    cliAdversarial/                          CLI/path/read-only/malformed/subprocess checks
    attackScenarios/                         adversarial scenario contracts, profiles, runner, scenarios, schema guard
    staticScans/                             CodeQL and Semgrep integration
    fuzz/                                    bounded deterministic fuzz smoke
    validate/                                targets, orchestration, and verdicts
    report/                                  text and JSON security reports; buildSecurityReport.ts assembles the report object shared by scripts/security/validate.ts and the audits/security adapter
  plots/ screenshot/ gallery/                evidence presentation
  visualizationDemos/                        my-dev-kit visualization runs

scripts/
  cli.ts                                     installed my-dev-kit-lab bin entrypoint (v0.4.6); thin process adapter over src/cli/runLabCli.ts, contains no routing/product logic itself
  experiments/                               thin npm-script adapters (experiment:list, experiment:describe, experiment:run) over src/commands/runExperimentListCommand.ts / runExperimentDescribeCommand.ts / runExperimentRunCommand.ts
  security/                                  security:validate thin adapter over src/commands/runSecurityValidationCommand.ts, plus source-checkout-only helpers (security:deps/package/codeql/semgrep, fuzz smoke) with no installed-CLI equivalent
  audits/                                    runAudit.ts — npm run audit thin adapter over src/commands/runAuditCommand.ts
  ...                                        legacy/demo/report/plot/gallery entrypoints, each a thin adapter over the matching src/commands/ owner
```

The supporting ownership roots are `src/agents` for provider adapters, `src/prompts` for prompt variants/complexity, and `src/visualizationDemos` for visualization runs. They remain shared by the experiment/report flow rather than becoming separate pipelines.

### System diagram

```mermaid
flowchart TD
  CLI[scripts/experiments] --> Registry[default plugin registry]
  Registry --> Runner[src/experiments runner]
  Runner --> Target[self or external-local target]
  Runner --> Plugin[context-strategy-comparison plugin]
  Plugin --> Evaluation[src/evaluation]
  Evaluation --> Agents[fake-agent / Codex / Claude]
  Plugin --> Results[normalized plugin result + legacy artifacts]
  Results --> PluginReports[src/report/experiments]
  Results --> SharedReports[shared reports / plots / screenshots]
  PluginReports --> Gallery[gallery and evidence outputs]
  SharedReports --> Gallery

  SecurityCLI[scripts/security] --> Security[src/securityValidation]
  Security --> SecurityReports[automated validation reports and verdict]
  Security --> Android[src/mobile/android]

  AuditCLI[scripts/audits] --> AuditRunner[src/audits/core auditRunner]
  AuditRunner --> CodeRotDetectors[src/audits/codeRot detectors]
  AuditRunner --> SecurityAdapter[src/audits/security adapter]
  SecurityAdapter --> Security
  SecurityAdapter --> Android
  CodeRotDetectors --> AuditReportModel[src/audits/report]
  SecurityAdapter --> AuditReportModel
  AuditReportModel --> AuditReports[Audit text/JSON reports incl. securitySummary]
  SecurityAdapter -.reuses/links.-> SecurityReports
```

### Subsystem responsibilities and boundaries

| Subsystem | Responsibility | Inputs | Outputs | Primary owners | Extension points | Invariants and failure boundary |
|---|---|---|---|---|---|---|
| Core and target model | Resolve commands, paths, tokens, and local targets | CLI values and local paths | Normalized process/path/target metadata | `src/core` | Shared target helpers | Tool and target roots stay distinct; target source is not modified by default |
| Experiment runtime | Select and execute experiment plugins | Plugin ID, target, configuration, benchmark cases | Normalized results and legacy-compatible artifacts | `src/experiments` | Plugin registry and plugin contracts | One runner; invalid plugin/configuration fails before execution |
| Evaluation, prompts, and agents | Build trials, prompts, scores, and agent outcomes | Benchmarks, strategies, prompt variants, adapter output | Runs, correctness, token/duration/status metadata | `src/evaluation`, `src/prompts`, `src/agents` | New metrics and adapters | Partial outcomes remain explicit; missing telemetry is not fabricated |
| Reports and presentation | Render evidence for review | Normalized experiment and validation artifacts | JSON/HTML/text reports, plots, screenshots, gallery | `src/report`, `src/plots`, `src/screenshot`, `src/gallery`, `src/visualizationDemos` | Additive report sections and gallery entries | Presentation does not reinterpret missing data as success |
| Generic audit | Collect project facts and run registered audit types | Local target, audit configuration | Audit issues, summaries, text/JSON reports | `src/audits` | Detector and audit-type registries | Findings are conservative; no auto-fix; invalid configuration exits cleanly |
| Security validation | Run automated CLI/package checks and scenarios | Local target, checks/profile/options | `SecurityFinding` records, skips, verdict, security reports | `src/securityValidation`, `scripts/security` | Check/scenario/profile registries | Optional tools may skip; bounded evidence is not exhaustive proof |
| Android validation | Detect and statically inspect Android targets | Android project plus explicit opt-ins | Android checks, findings, CandidateEvidence, report sections | `src/mobile/android` | Closed checks and opt-in operations | Zero Gradle, external-tool, and network processes by default; CandidateEvidence is review-only |
| Security audit adapter | Reuse security results in audit output | Security-validation result and optional Android result | Mapped issues, summaries, report links | `src/audits/security` | Finding-to-issue mappings | One adapter; `security:validate` remains separate and authoritative for full evidence |
| Documentation preservation | Enforce required structure and lifecycle facts | Preservation manifest and tracked documentation | Actionable consistency errors | `scripts/check-docs.mjs`, `tests/scripts/checkDocs.test.ts` | Manifest structural requirements | Checks may be strengthened, not weakened to hide contradictions |

## Experiment-plugin runtime

`src/experiments/defaultRegistry.ts` registers `context-strategy-comparison`. `src/experiments/runner.ts` resolves the requested plugin and target, validates configuration, executes the plugin, normalizes output, and invokes plugin-aware report generation.

The current plugin delegates trial execution and comparison logic to the established controlled-experiment infrastructure. This preserves:

- `raw-full-file` and `my-dev-kit-guided` variants
- benchmark cases and answer-key correctness
- fake-agent and real-agent adapters
- partial-outcome handling
- legacy experiment summary, run, and comparison artifacts
- `run-controlled-experiment` compatibility

```mermaid
sequenceDiagram
  participant User
  participant Command as experiment:run
  participant Runtime as Plugin runtime
  participant Plugin as context-strategy-comparison
  participant Legacy as Controlled experiment foundations
  participant Report as Plugin report support

  User->>Command: experiment id, target, options
  Command->>Runtime: runExperiment(...)
  Runtime->>Runtime: resolve plugin, target, config
  Runtime->>Plugin: execute context strategy comparison
  Plugin->>Legacy: run raw and guided trials
  Legacy-->>Plugin: runs, comparisons, artifacts
  Plugin-->>Runtime: normalized result
  Runtime->>Report: write JSON and HTML reports
  Report-->>User: plugin-aware and legacy outputs
```

## Stage-context evaluation architecture (v0.4.3)

Implemented and published. It extends the `context-strategy-comparison` plugin and its report layer rather than creating a parallel runner, evaluation system, or report system.

```mermaid
flowchart TD
  Readers[src/evaluation/upstreamArtifacts\nexact ContextCapsule / RetrievalAuditRecord / WorkflowInstructionPacket readers] --> Selectors[src/evaluation/stageContextSelectors\nselectors and consistency diagnostics]
  Selectors --> Expectations[src/evaluation/stageContextExpectations\nStageContextExpectationFixtureV1]
  Expectations --> Execution[contextStrategyComparison plugin\nsix v0.4.3 strategy executions]
  Readers --> Execution
  Execution --> Metrics[src/evaluation/stageContextMetrics\nevidence-centered metrics]
  Execution --> Assurance[src/evaluation/targetImmutability\n+ src/evaluation/stageContextDeterminism\nrun assurance]
  Metrics --> Reports[src/report/experiments\nbounded report.json / report.html / report.txt]
  Assurance --> Reports
```

Dependency direction is one-way: readers depend on nothing else in this list; selectors depend on readers; expectations depend on selectors; strategy execution depends on readers, selectors, and expectations; metrics depend on strategy execution output; run assurance depends on strategy execution and evaluation; reports depend on execution, evaluation, and assurance results and do not feed back into any earlier layer.

This architecture does not introduce a normalized upstream observation layer — readers preserve exact upstream field names, nesting, optionality, nullability, array order, and unknown additive fields, and never merge or reshape `ContextCapsule`/`RetrievalAuditRecord`/`WorkflowInstructionPacket` objects. Metrics are not upstream artifact properties; they are a separate, additive evaluation layer computed from reader output plus expectation fixtures. Reports do not recalculate execution results, metrics, target immutability, or determinism; the report layer only renders a bounded, deterministic view of already-computed results and never reruns a strategy.

The released compatibility behavior recognizes my-dev-kit's additive retrieval-audit `index.projectRoot` and `index.manifestSchemaVersion` fields within schema major 1. The exact reader retains these fields when present and leaves them absent for legacy audits; it never derives repository identity. The existing capsule/audit consistency selector compares project root and manifest schema alongside active index, before/after freshness identity, and the established shared summaries. It evaluates producer evidence but does not reimplement orchestrator readiness.

## Context-integrity evaluation architecture (v0.4.5)

Released in v0.4.5 after individual readiness, coordinated cross-repository validation, and published-upstream revalidation. It extends the existing producer-readiness bridge (`evaluateProducerReadinessBridge`) and the existing bounded report primitives additively; it does not introduce a parallel evaluation runner or a parallel report system.

```mermaid
flowchart TD
  ProducerReaders[src/evaluation/upstreamArtifacts\nexact condition-aware producer mirrors\nmy-dev-kit v1.10.4] --> Bridge[evaluateProducerReadinessBridge]
  RunIntegrityReaders[src/evaluation/upstreamArtifacts\nexact orchestrator run-integrity mirrors\nmy-dev-kit-orchestrator v1.2.3] --> Selectors[src/evaluation/stageContextSelectors\norchestratorRunIntegritySelectors]
  Selectors --> Bridge
  Metrics[src/evaluation/stageContextMetrics\nallocation / spillover / condition-coverage\n+ run-integrity agreement calculators] --> Bridge
  Fixtures[tests/fixtures/ecosystem/context-integrity/v0.4.5\nfailed-run + corrected-replay] --> Loader[src/evaluation/ecosystemFixtures\nmanifest + hash verification + loader]
  Loader --> Bridge
  Bridge --> Reports[src/report/experiments\nContextIntegrityReportV1: JSON / text / HTML]
  Loader --> Determinism[src/evaluation/stageContextDeterminism\nreused, not duplicated]
  Determinism --> Reports
```

Ownership and boundaries:

- The published `my-dev-kit` `v1.10.4` and `my-dev-kit-orchestrator` `v1.2.3` contracts are mirrored exactly (field names, nesting, optionality) by dedicated readers in `src/evaluation/upstreamArtifacts`, following the same exact-mirror discipline as the `v0.4.3`/`v0.4.4` readers. There is no single combined upstream run-integrity JSON artifact — `RunIntegrityGateResult`, `JudgeIntegrityResult`, and `FinalReportEligibilityResult` are in-memory orchestrator computation results, mirrored as plain-object inputs, plus a separate on-disk `artifact-state.json` lifecycle record that is read directly.
- `evaluateProducerReadinessBridge` remains the single composition point for all condition-aware producer and run-integrity metrics; `v0.4.5` extends it additively with a `runIntegrityEvidence` input and `runIntegrityEvaluation`/agreement outputs, without changing its `v0.4.3`/`v0.4.4` behavior.
- Agreement calculators compare producer evidence against run-integrity evidence and report one of a shared outcome vocabulary (`agreement`, `contradiction`, `insufficient-evidence`, `unsupported-legacy-evidence`, `not-applicable`) rather than re-deriving or overriding either upstream project's own policy. The lab does not reimplement upstream owner-selection, allocation, readiness, or run-integrity policy at any point in this flow.
- The orchestrator does not expose a literal upstream `promptMode` field. `stageMayRenderNormalPrompt`, derived from structured blocked-stage evidence, is the bounded substitute the lab reads and reports instead.
- `src/evaluation/ecosystemFixtures` validates the fixture manifest, verifies SHA-256 hashes against tracked fixture bytes, and loads the fixture pair through bounded, traversal-safe path resolution. The frozen `failed-run` fixture is a byte-exact copy of a real historical `my-dev-kit` `v1.11.0` Batch 1 failed run. The `corrected-replay` fixture is a hand-distilled representation of the exact validated local `my-dev-kit` `v1.10.4` and `my-dev-kit-orchestrator` `v1.2.3` contracts, applied to the same request, target, and active-index identity as the paired failed-run fixture — it is not a live capture of a complete ten-stage AI-authored implementation workflow, and it is not proof that every future run against these contracts will behave identically.
- Determinism reuses `calculateStageContextDeterminism`/`canonicalizeStageContextRun` from `src/evaluation/stageContextDeterminism`. Fixture self-immutability is verified by re-running hash verification against the frozen fixture bytes rather than by mutating a live target, since no live target repository is exercised in this evaluation path.
- `src/report/experiments/contextIntegrityReportModel.ts` and `buildContextIntegrityReport.ts` define and populate `ContextIntegrityReportV1` as a pure, bounded reshaping of already-computed bridge results — the builder performs no recomputation. It reuses `V043BoundedReportListV1`/`V043ReportAvailability` from the existing `v0.4.3` report model rather than duplicating bounded-list or availability primitives. JSON, text, and HTML renderers follow the same conventions as the existing `v0.4.3` report renderers. No composite score, grade, ranking, or winner is computed or rendered anywhere in this layer.

See [context-integrity-fixtures.md](context-integrity-fixtures.md) for the frozen fixture pair's full provenance, tracked/excluded-artifact inventory, and hash-verification model, and [context-integrity-report-schema.md](context-integrity-report-schema.md) for the `ContextIntegrityReportV1` JSON/text/HTML report shape.

## Target model

Experiment and security commands distinguish the tool root from the target root. Omitting `--target` selects self mode. Supplying `--target <path>` selects an external local project. Experiment outputs remain in lab-controlled output directories by default; security reports remain under `reports/security` unless an explicit output directory is provided.

`src/core/localProjectTarget.ts` supplies shared local-project metadata. Experiment target resolution lives in `src/experiments/target.ts`; security target resolution lives in `src/securityValidation/validate/resolveTarget.ts`.

## Installed-package architecture (v0.4.6, implemented; not yet published)

v0.4.6 is implemented on this branch but has not been published to npm; the latest published package is v0.4.5. This section documents the implemented architecture so it is not mistaken for the v0.4.5 published behavior.

### Path model

`src/runtime/labExecutionContext.ts` defines `LabExecutionContext`, a read-only structure with four distinct roots. Callers never collapse these into one path:

- **packageRoot** — the installed or checked-out my-dev-kit-lab package root. Discovered by `src/runtime/packageRoot.ts` by walking up from the executing module's own location (never from `process.cwd()`) until it finds the `package.json` whose `name` is `@dailephd/my-dev-kit-lab`. Treated as read-only by every command's default behavior.
- **invocationCwd** — the directory the user launched the command from (`process.cwd()` unless overridden for testing). Explicit relative paths supplied by the user (`--out`, `--target`, an explicit `--workspace`, an explicit `--project-profiles`/`--cases`) resolve against this, never against packageRoot or workspaceRoot.
- **workspaceRoot** — the writable location my-dev-kit-lab owns. Defaults to `<home>/.my-dev-kit-lab`; an explicit `--workspace` overrides it (absolute used as-is, relative resolved against invocationCwd). Commands with an implicit/default writable output (`audit`, `security validate`) root that default under workspaceRoot when running through the installed CLI; the contributor `npm run audit` / `npm run security:validate` scripts keep their existing packageRoot-relative default unchanged.
- **resourceRoot** — the root bundled runtime resources are resolved from. Equal to packageRoot in the current package layout, kept as a distinct field because it has a different responsibility. `src/runtime/packageResource.ts` resolves a package-relative resource path against resourceRoot with path-semantics containment (not string-prefix matching), rejecting empty, absolute, or traversal-escaping inputs.

A fifth root, **targetRoot** (the inspected external project, or packageRoot itself in self mode), is unrelated to and never conflated with workspaceRoot — target directories remain non-destructive/read-only by default regardless of workspace configuration.

### Router → command owners → subsystem owners

The installed bin (`dist/scripts/cli.js`, source `scripts/cli.ts`) is a thin process adapter: it reads `process.argv`, calls `src/cli/runLabCli.ts`'s `runLabCli()`, and sets `process.exitCode` from the returned number. It owns no routing or product logic itself.

`runLabCli()` owns: global `--workspace` parsing (must precede the command), top-level `--help`/`--version`, command-family routing, bounded family/command-level help rendering, and explicit legacy-final-demo flag detection (an allowlist of the exact flags `demo final` accepts — never a catch-all "unknown input must be final-demo" rule). It does not own experiment execution, security/audit logic, or report/plot/gallery generation; each route delegates to an existing `src/commands/` owner.

`src/commands/` owners (e.g. `runAuditCommand.ts`, `runSecurityValidationCommand.ts`, `runExperimentListCommand.ts`/`runExperimentDescribeCommand.ts`/`runExperimentRunCommand.ts`, `runControlledExperimentCommand.ts`, `renderExperimentReportCommand.ts`, `generateExperimentPlotsCommand.ts`, `buildGalleryCommand.ts`, `runFinalDemoCommand.ts`) own CLI-level argument parsing, target/output-path resolution, and exit-code mapping for one capability each, then call the existing subsystem owner (`src/audits/`, `src/securityValidation/`, `src/experiments/`, `src/report/`, `src/plots/`, `src/gallery/`) for the actual work. Subsystem behavior (detector logic, security checks, experiment scoring, report schemas) is unchanged by this layer.

The contributor `scripts/*.ts` npm-script entrypoints are thin adapters over the same `src/commands/` owners — there is one implementation per capability, not a separate one for `npm run` versus the installed CLI. A command owner that needs execution-context information accepts it through an optional parameter (e.g. `{ context, defaultOutRoot }`) rather than requiring every existing caller to construct one immediately.

### Packed-package acceptance boundary

`scripts/verify-packed-package.mjs` (`npm run verify:packed-package`) is a permanent, Node-only, cross-platform gate proving the sequence a real consumer experiences: build → real `npm pack` (not `--dry-run`) → locate the single generated tarball and hash it → install that exact tarball into a clean temporary consumer project (no source-checkout copy, no `npm link`) → resolve and execute the consumer-local installed binary → verify default (no `--workspace`) output lands under a temporary fake home's `.my-dev-kit-lab` directory, explicit `--workspace` output lands under that workspace, and neither the inspected target nor the installed package directory changes (recursive SHA-256 snapshot before/after, compared for exact equality) → clean up. It does not require `tsx`, TypeScript, Vitest, or Playwright to be present for the routes it exercises; if a public route unexpectedly required one, that would be a real runtime-boundary defect, not a tolerated gap.

## Automated security-validation architecture

The current security framework is automated CLI/package validation. It combines dependency and package inspection, adversarial CLI tests, static-tool integrations, bounded fuzz smoke, attack-scenario execution, and report/verdict generation. It is target-aware and preserves `npm run security:validate` self mode.

```mermaid
flowchart LR
  Command[security:validate] --> Resolve[Resolve self or external target]
  Resolve --> Deps[Dependency checks]
  Resolve --> Package[Package checks]
  Resolve --> Static[CodeQL / Semgrep]
  Resolve --> CLI[Security test suite]
  Resolve --> Fuzz[Bounded fuzz smoke]
  Resolve --> Scenarios[Attack scenarios + profiles]
  Deps --> Verdict[Normalize findings and verdict]
  Package --> Verdict
  Static --> Verdict
  CLI --> Verdict
  Fuzz --> Verdict
  Scenarios --> Verdict
  Verdict --> Reports[Text + JSON reports]
```

For an external target, dependency, package, and supported static checks use the target project. If the target declares `test:security`, validation runs that script in the target root. The framework records command cwd, exit status, and bounded output summaries. Tool-specific self-tests remain clearly labeled.

`src/securityValidation/attackScenarios` is now part of the implemented validation layer. It contains the `AttackScenario` contract, `AttackResult` bridge model, reusable profiles, payload/evidence helpers, the integrated attack runner, and concrete scenarios for boundary, subprocess, secrets, and network checks.

`src/securityValidation/attackScenarios/reportSchemaGuard.ts` protects JSON report structure against payload-created top-level injection by comparing a clean baseline render with a payload-bearing render. This is schema/report hardening for the current report format, not a general renderer-safety proof.

`src/securityValidation/types.ts` defines `VerdictImpact`, which flows from `AttackScenario` to `AttackResult` to `SecurityCheckResult`. `src/securityValidation/validate/verdict.ts` reads that metadata directly when summarizing blocker categories, so the verdict layer no longer owns a hand-maintained scenario-impact map.

Profile behavior remains intentionally narrow in the current implementation: profiles drive default check selection and scenario applicability filtering, but they do not yet introduce deeper per-profile scenario branching beyond that selection metadata.

Optional local tools can be reported as skipped; absence alone does not make the framework crash. This automation is not equivalent to a manual pentest.

## Audit framework architecture

`src/audits/` is the implemented generic project-audit framework. `code-rot` (since `v0.3.0`) and `security` (since `v0.3.2`) are the currently implemented audit types. `quality`, `project`, and `all` audit types remain planned — supplying them to `--types` fails cleanly with exit code 2 and a clear message rather than running.

The audit framework and automated security validation (`src/securityValidation`) remain distinct systems. `src/audits/security` is an adapter, not another scanner family. It calls `runSecurityValidation()` directly, maps resulting `SecurityFinding` records into audit issues, and preserves the existing `reports/security/*.txt` and `.json` outputs.

The audit framework never invokes `security:validate` as a subprocess, and `security:validate` never calls the audit framework. The adapter only reuses exported security-validation functions.

```mermaid
flowchart LR
  Command[npm run audit] --> Config[Parse args / normalize config]
  Config --> Target[Resolve self or external target]
  Target --> Inventory[Project inventory scanner]
  Inventory --> Facts[Source facts collector: TS/JS + Python + Java + Kotlin analyzers]
  Target --> SoT[Source-of-truth collector]
  Target --> PyMeta[Python project metadata collector]
  Target --> JvmMeta[JVM project metadata collector]
  Inventory --> Registry[Detector registry: 10 code-rot detectors]
  Facts --> Registry
  SoT --> Registry
  JvmMeta --> Registry
  Registry --> Runner[auditRunner]
  Runner -- "--types includes security" --> SecAdapter[audits/security adapter]
  SecAdapter --> SecValidation[securityValidation.runSecurityValidation]
  SecValidation --> SecReports[reports/security/*.txt / *.json]
  PyMeta --> Model[Audit report model]
  Runner --> Model
  SecAdapter --> Model
  Model --> Reports[Text + JSON audit reports incl. pythonProjectMetadata + securitySummary]
  Reports -. links to .-> SecReports
```

`src/audits/core/` supplies:
- `auditConfig.ts` — `--target`, `--types`, `--include`, `--format`, `--fail-on`, `--out` flag parsing and normalization
- `auditTarget.ts` — target resolution (self or external local project), non-destructive with respect to the target
- `projectInventory.ts` — project inventory scanner (files by category/extension, normalized language, file role, excluded directories)
- `sourceOfTruth.ts` — source-of-truth collector (package metadata, scripts, docs, CI, build tooling, tests, security, experiment truth)
- `sourceFacts.ts` / `collectSourceFacts.ts` — source facts model and collector for source/test files
- `languageAnalyzerRegistry.ts` / `typescriptJavaScriptAnalyzer.ts` / `pythonAnalyzer.ts` / `javaAnalyzer.ts` / `kotlinAnalyzer.ts` — language analyzer registry with TypeScript/JavaScript, Python, Java, and Kotlin analyzers registered for their supported extensions
- `pythonProjectMetadata.ts` — presence/simple-text-extraction collector for Python project/config files (`pyproject.toml`, `requirements.txt`, `setup.py`, `setup.cfg`, `tox.ini`, `pytest.ini`); never executes Python tooling
- `jvmProjectMetadata.ts` — static Gradle/Maven/wrapper/source-set presence detection and best-effort project-name extraction; never executes Gradle, Maven, compilers, or target tests
- `auditRegistry.ts` — `DEFAULT_AUDIT_REGISTRY`, detector contract, and `selectDetectors()` filtering by type/include area
- `auditRunner.ts` — executes selected detectors against the collected inventory/source-of-truth
- `auditExitCode.ts` — exit-code policy: `0` no issue met the `--fail-on` threshold, `1` at least one issue met or exceeded it, `2` invalid config/target or a runtime failure (never returned by the pure exit-code calculator itself; the CLI script's own try/catch blocks return it directly)

`src/audits/codeRot/detectors/` implements the 10 registered code-rot detector families, in registry order:
1. `stale-command-reference` — stale command/workflow references in docs
2. `docs-code-mismatch` — documentation/code mismatch
3. `package-release-rot` — package/release metadata rot
4. `duplicate-implementation-candidate` — duplicate or parallel implementation candidates
5. `dead-code-candidate` — dead-code candidates from deterministic evidence
6. `test-rot` — test rot signals
7. `architecture-drift` — architecture drift between docs and implemented modules
8. `dependency-environment-rot` — dependency/environment rot
9. `cross-platform-rot` — cross-platform rot
10. `security-validation-assumption-rot` — stale documentation *claims* about security-validation (this detector checks claims about security-validation; it does not itself perform security validation)

`src/audits/report/` builds and writes the stable, versioned report:
- `auditReportModel.ts` — pure `AuditResult -> AuditReportModel` transform; `AUDIT_REPORT_SCHEMA_VERSION = "1.0"`; the published `v0.3.2` package state includes 16 top-level fields (`schemaVersion`, `metadata`, `target`, `config`, `summary`, `inventory`, `sourceOfTruth`, `sourceFacts`, `pythonProjectMetadata`, `securitySummary`, `detectors`, `issues`, `skippedDetectors`, `detectorErrors`, `recommendations`, `exit`) — `v0.3.1` had 14 (no `pythonProjectMetadata`/`securitySummary`); `metadata.auditType` (joined string) and `metadata.auditTypes` (string array) are both present
- `renderAuditJsonReport.ts` / `renderAuditTextReport.ts` — JSON and text renderers; the text renderer sanitizes all issue/recommendation text through `sanitizeAuditText.ts` before printing and renders both an evidence message and excerpt when both are present
- `writeAuditReports.ts` — writes the selected `--format` outputs
- Reports are written under `reports/audits/code-rot/` by default (`code-rot-audit.json`, `code-rot-audit.txt`), or under `--out <path>` when supplied

`scripts/audits/runAudit.ts` is a thin CLI entrypoint: parse args → normalize config → resolve target → `runAudit()` → `buildAuditReportModel()` → `writeAuditReports()` → console summary → set `process.exitCode`. It mirrors the structure of `scripts/security/validate.ts` but shares no code with it.

Fail-on policy: `--fail-on blocker|high|medium|low|none` (default `blocker`; see `docs/COMMANDS.md` for full threshold semantics). External-target audits are non-destructive — target resolution and the runner do not write or delete files inside the target root; generated reports stay under the tool root's `reports/audits/` unless `--out` redirects them.

### Language-analyzer boundary

The source-facts layer registers TypeScript/JavaScript, Python, Java, and Kotlin analyzers. TypeScript/JavaScript parsing is syntax-only and single-file; Python and JVM analyzers use conservative, dependency-free scanning. Detector groups remain analyzer-scoped, and JVM metadata is static presence/text extraction rather than a report-schema field.

These analyzers provide candidate evidence. They do not provide type checking, full module or classpath resolution, runtime reachability, clone detection, coverage analysis, compiler execution, Gradle/Maven execution, target-test execution, or dependency-freshness proof. See [CHANGELOG.md](../CHANGELOG.md) for the release-by-release history of this substrate.

## Shared report and evidence infrastructure

`src/report` remains the shared report layer. `src/report/experiments` extends it for plugin metadata rather than creating a parallel reporting product. Plots, screenshots, visualization demos, and gallery output consume experiment artifacts and remain reusable across future plugins.

## Future architecture

The following layers are planned and must not be treated as current published or checked-out behavior:

- JVM package/environment rot or Gradle/Maven dependency freshness checks
- the `quality`, `project`, and `all` audit types, and any project-wide default audit behavior combining multiple audit types
- cross-type issue deduplication or release-readiness aggregation across audit families beyond the current per-type additive report fields
- a human-led manual pentest workflow after `v1.0.0`
- additional experiment plugins for warm indexes, freshness, scale, retrieval quality, and agent success (`v0.5.0` and later)
- normalized telemetry, scheduling, prompt hardening, and generalized report/gallery publication

`v0.4.3` stage-specific bounded-context and workflow-instruction evaluation is implemented and published (see "Stage-context evaluation architecture (v0.4.3)" above). `v0.4.5` context-integrity evaluation is implemented and published (see "Context-integrity evaluation architecture (v0.4.5)" above).

Future audit work should reuse `src/audits/core`, `src/audits/security`, target metadata, the normalized issue schema, and shared reports. It must not replace the experiment runtime, duplicate report/gallery systems, or absorb `security:validate` into the audit framework.

## Key contracts

| Contract | Location |
|---|---|
| Plugin and result types | `src/experiments/types.ts` |
| Plugin registry | `src/experiments/registry.ts` |
| Generic runner | `src/experiments/runner.ts` |
| Current plugin | `src/experiments/plugins/contextStrategyComparison/plugin.ts` |
| Plugin report model | `src/report/experiments/experimentReportModel.ts` |
| Controlled experiment types | `src/evaluation/controlledExperimentTypes.ts` |
| Shared local target metadata | `src/core/localProjectTarget.ts` |
| Security result types | `src/securityValidation/types.ts` |
| Security orchestrator | `src/securityValidation/validate/runSecurityValidation.ts` |
| Audit issue / result types | `src/audits/core/auditIssue.ts` / `src/audits/core/auditRunner.ts` |
| Audit detector registry | `src/audits/core/auditRegistry.ts` |
| Audit report model | `src/audits/report/auditReportModel.ts` |
| Source facts model | `src/audits/core/sourceFacts.ts` |
| Language analyzer registry | `src/audits/core/languageAnalyzerRegistry.ts` |
| TypeScript/JavaScript analyzer | `src/audits/core/typescriptJavaScriptAnalyzer.ts` |
| Python analyzer | `src/audits/core/pythonAnalyzer.ts` |
| Java analyzer | `src/audits/core/javaAnalyzer.ts` |
| Kotlin analyzer | `src/audits/core/kotlinAnalyzer.ts` |
| Python project metadata | `src/audits/core/pythonProjectMetadata.ts` |
| JVM project metadata | `src/audits/core/jvmProjectMetadata.ts` |
| Security audit adapter | `src/audits/security/securityAuditAdapter.ts` |
| Security finding → audit issue mapping | `src/audits/security/mapSecurityFindingToAuditIssue.ts` |
| v0.4.3 upstream artifact readers | `src/evaluation/upstreamArtifacts/` |
| v0.4.3 strategy input contracts and IDs | `src/experiments/plugins/contextStrategyComparison/v043StrategyInputContracts.ts` / `v043StrategyIds.ts` |
| v0.4.3 expectation fixture contract | `src/evaluation/stageContextExpectations/types.ts` |
| v0.4.3 evidence-centered metrics | `src/evaluation/stageContextMetrics/` |
| v0.4.3 target immutability | `src/evaluation/targetImmutability/` |
| v0.4.3 repeated-run determinism | `src/evaluation/stageContextDeterminism/` |
| v0.4.3 bounded report model | `src/report/experiments/contextStrategyComparisonV043ReportModel.ts` |
| v0.4.4 supplemental packet/report readers and readiness adapter (released) | `src/evaluation/upstreamArtifacts/` (e.g. `readImplementationContextPacketV1.ts`, `orchestratorContextReadinessResultV1.ts`) |
| v0.4.4 producer-readiness metric calculators (released) | `src/evaluation/stageContextMetrics/` (`calculateOwnerMetrics.ts`, `calculateAllocationMetrics.ts`, `calculateTruncationClassification.ts`, `calculateSupplementalRawAgreement.ts`, `calculateReadinessAgreement.ts`, `calculateCriticalityMetrics.ts`) |
| v0.4.4 producer-readiness bridge evaluator (released) | `src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.ts` |
| v0.4.5 condition-aware producer / run-integrity readers (released) | `src/evaluation/upstreamArtifacts/` (e.g. `myDevKitContextArtifactsV1.ts`, `orchestratorRunIntegrityV1.ts`, `readOrchestratorRunIntegrityV1.ts`) |
| v0.4.5 allocation/condition-coverage/run-integrity-agreement metric calculators (released) | `src/evaluation/stageContextMetrics/` (`calculateAllocationMetrics.ts`, `calculateTruncationClassification.ts`, `calculateConditionCoverageMetrics.ts`, `calculateProducerConditionAgreement.ts`, `calculateReadinessAgreement.ts`, `calculateSupplementalRawAgreement.ts`, `calculateRunIntegrityAgreement.ts`) |
| v0.4.5 ecosystem regression fixture manifest / hash verification / loader (released) | `src/evaluation/ecosystemFixtures/` |
| v0.4.5 frozen failed-run and corrected-replay fixture pair (released) | `tests/fixtures/ecosystem/context-integrity/v0.4.5/` |
| v0.4.5 bounded context-integrity report model, builder, and renderers (released) | `src/report/experiments/contextIntegrityReportModel.ts`, `buildContextIntegrityReport.ts`, `renderContextIntegrityJsonReport.ts`, `renderContextIntegrityText.ts`, `renderContextIntegrityHtml.ts` |
