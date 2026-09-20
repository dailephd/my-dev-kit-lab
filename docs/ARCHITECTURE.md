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

## Planned multi-plugin command generalization (v0.5.0)

The current experiment runtime is generic, but the current `runExperimentRunCommandFromArgs` still contains context-strategy-specific CLI/config/input behavior. Before `warm-index-reuse` becomes the second registered plugin, v0.5.0 must remove that future scalability trap without breaking the existing context-strategy surface.

```mermaid
flowchart LR
  Installed[my-dev-kit-lab experiment run] --> Owner[runExperimentRunCommandFromArgs]
  Source[npm run experiment:run --] --> Owner
  Owner --> Generic[generic flags: experiment / target / out / config]
  Owner --> Legacy[legacy context-strategy flags<br/>compatibility only]
  Generic --> Registry[default experiment registry]
  Legacy --> Registry
  Registry --> Plugin[registered plugin]
  Plugin --> Validate[plugin.validateConfig]
  Plugin --> Inputs[plugin-owned input/resource loading]
  Plugin --> Runner[runExperiment]
  Runner --> Reports[shared plugin report writers]
```

Planned rules:

* Add `--config <path>` as the generic plugin configuration input. The file uses an `ExperimentConfigFileV1` envelope: `{ schemaVersion: "1.0.0", experimentId, config }`. The envelope ID must match `--experiment`; the command owner validates the envelope and passes only `config` to the selected plugin's existing `validateConfig`.
* The config file path resolves against invocation CWD. The command context carries generic `configSource.filePath` and `configSource.baseDir` metadata so plugin-owned relative paths resolve against the config file directory instead of packageRoot or an undocumented process CWD.
* `--config` may coexist only with generic routing/output options (`--experiment`, `--target`, `--out`, and global `--workspace`). It is mutually exclusive with the context-strategy plugin's legacy convenience flags; those legacy flags retain current semantics when `--config` is absent.
* Extend `ExperimentPlugin` additively with optional `resolveInputs(context)`. `runExperiment` invokes it after config/target/output resolution only when `RunExperimentOptions.inputs` was not explicitly supplied. Programmatic `inputs` take precedence and bypass automatic resolution, preserving existing test/integration injection seams.
* Migrate the current context-strategy command-side `loadPluginInputs` behavior into the plugin's `resolveInputs` or a plugin-owned helper. After v0.5.0, new plugins do not add experiment-ID branches to the command owner for input/resource loading.
* Extend plugin metadata with optional CLI examples. `experiment describe` renders plugin-owned examples when present, otherwise a generic `--config <path>` example. It must not generate context-strategy-specific flags for unrelated plugins.
* `experiment list`, `experiment describe`, and `experiment run` continue to use `createDefaultExperimentPluginRegistry`; a plugin is not public until all three surfaces see the same registration in both installed and source-checkout modes.
* The existing installed/source implicit output-root difference remains intentional. Explicit `--config`, `--target`, and `--out` paths have identical semantics in both entry paths.
* This generalization is a v0.5.0 prerequisite for every later plugin, including incremental-change, context-window, retrieval, agent-success, and `software-review-calibration`.

### Planned generic experiment config and input-resolution contract

```ts
type ExperimentConfigFileV1 = {
  schemaVersion: "1.0.0";
  experimentId: string;
  config: Record<string, unknown>;
};

type ExperimentConfigSourceV1 = {
  filePath: string;
  baseDir: string;
};

type ExperimentInputResolutionContext<TConfig> = {
  toolRoot: string;
  target: ExperimentTarget;
  outputRoot: string;
  config: TConfig;
  configSource?: ExperimentConfigSourceV1;
};

interface ExperimentPlugin<TConfig = unknown, TResult extends ExperimentRun = ExperimentRun> {
  // existing metadata/defaultConfig/configDefinition/validateConfig/prepare/run/summarize/cleanup
  resolveInputs?(
    context: ExperimentInputResolutionContext<TConfig>
  ): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}
```

Runner rule: explicit `RunExperimentOptions.inputs` wins. Otherwise the selected plugin's `resolveInputs` is called at most once and its result becomes `ExperimentExecutionContext.inputs`. The generic command owner never interprets plugin-specific case/profile/resource fields.

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

## Installed-package architecture (v0.4.6)

This section documents the current installed-package architecture, shipped in v0.4.6.

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

## Current browser/tutorial architecture

### v0.4.7 browser/tutorial architecture

The v0.4.7 release adds a generic tutorial runtime without stretching the existing report screenshot owner, duplicating v0.4.6 process/path infrastructure, or embedding product-specific demo logic in my-dev-kit-lab.

Current ownership:

```text
src/
  browser/                   shared Playwright loading, browser availability, Chromium launch, common cleanup
  runtime/
    managedProcess.ts        long-running child process lifecycle, readiness, logs, stop/forced cleanup
  tutorial/
    types.ts                 versioned scenario, target-contract, run/result, step, locator, action, assertion types
    scenarioValidation.ts    deterministic JSON contract validation
    tutorialSession.ts       persistent browser/context/page lifecycle and step timeline
    tutorialActions.ts       bounded action execution
    tutorialAssertions.ts    bounded runtime/artifact assertions
    tutorialCursor.ts        tutorial-only visible synthetic pointer/click feedback
    tutorialOverlay.ts       tutorial-only callout/highlight overlays
    tutorialArtifacts.ts     run directory and artifact finalization
    subtitleWriter.ts        SRT/VTT generation from the recorded narration timeline
    markdownTutorialWriter.ts  Markdown generation from the same scenario source
    runTutorial.ts           generic orchestration over already-validated contracts
  commands/
    ...                      thin installed-CLI owners for tutorial validate/run
```

The exact filenames may be adjusted during implementation planning, but the responsibility boundaries are fixed:

* **Shared browser runtime, not screenshot ownership:** `src/browser` owns Playwright module loading, package/browser availability classification, Chromium launch defaults, and common cleanup. `src/screenshot` continues to own one-shot report screenshots. `src/tutorial` owns persistent tutorial sessions, actions, assertions, overlays, step screenshots, recording, and timing.
* **Managed processes reuse existing process rules:** `src/runtime/managedProcess.ts` reuses `resolveCommand`, `shell:false`, current Windows shim behavior, and existing process-tree cleanup conventions. It adds start-without-waiting, bounded stdout/stderr logs, readiness probes/timeouts, explicit stop, graceful/forced cleanup, and failure/abort cleanup without a second command resolver.
* **Scenario and process trust are separate:** a versioned declarative `TutorialScenarioV1` carries user-visible tutorial steps. A separate trusted target/demo contract carries materialization/start/readiness/application information. Tutorial steps cannot contain arbitrary shell commands or arbitrary JavaScript/page-evaluation callbacks.
* **Bounded action vocabulary:** the first version is expected to support `goto`, `click`, `fill`, `press`, `hover`, `drag`, and `wait-for`.
* **Bounded locators and assertions:** locators should cover accessible role/name, text, CSS, and stable test/demo identifiers. Assertions should cover visibility, text equality/containment, URL/path state, DOM attribute/state, HTTP JSON fields, local JSON artifact fields, and file existence.
* **One scenario is the text/timing source of truth:** narration in the scenario drives visible explanation plus generated SRT, VTT, and Markdown. The runner records actual step boundaries instead of maintaining independent subtitle timings.
* **Runtime evidence, not recording alone:** a required assertion failure makes the tutorial run unsuccessful even if a video file exists. Video is human-reviewable runtime recording, not a substitute for runtime verification.
* **Workspace separation:** source demo template, disposable target working copy, tutorial artifacts, logs, and temporary browser/video data are distinct. Generated tutorial output belongs under the configured lab workspace/output, never under the installed package or product source template.
* **Installed-package behavior:** the implemented commands are `my-dev-kit-lab tutorial validate --scenario <path>` and `my-dev-kit-lab tutorial run --scenario <path> ...`. Validation does not require Chromium. Recording requires the configured browser runtime and fails explicitly with setup guidance when unavailable rather than silently passing without video.
* **Playwright packaging:** Playwright is an exact runtime dependency of the package. Browser-binary presence is checked separately at runtime, with no package-install hook or automatic download. The current optional one-shot screenshot semantics do not define the tutorial command's required-browser behavior.
* **Canonical artifacts:** v0.4.7 produces `tutorial.webm`, named step screenshots, `tutorial.srt`, `tutorial.vtt`, `tutorial.md`, process logs, and a versioned `tutorial-manifest.json`. FFmpeg/MP4 and generated audio narration remain outside v0.4.7.
* **Gallery is downstream:** v0.4.7 produces a canonical tutorial manifest but does not require gallery integration. Later report/gallery generalization may consume that manifest; tutorial execution does not depend on gallery generation.

Cross-repository boundary:

```mermaid
flowchart LR
  Observer[my-frontend-observer<br/>deterministic demo template + product scenarios] --> Contract[trusted demo/target contract]
  Contract --> Lab[my-dev-kit-lab v0.4.8<br/>generic tutorial runtime]
  Lab --> Evidence[WebM + screenshots + SRT/VTT + Markdown + tutorial manifest]
```

`my-frontend-observer` owns its demo source, stable target identifiers, deterministic visual variants, reference images, materialization/reset behavior, readiness/start contract, and Observer-specific scenario files. my-dev-kit-lab must not encode Observer selectors or semantics in production code. The lab carries its own generic deterministic fixture, so normal lab CI and packed-package acceptance never require a sibling Observer checkout.

### Released v0.4.8 pointer-gesture extension

The v0.4.7 action model intentionally distinguishes browser elements but could not name two positions inside the same pointer-receiving element. The first Observer v0.9 integration exposed this as a generic capability gap for SVG/canvas drawing and similar editors. v0.4.8 releases an additive tutorial patch, not a product-specific workaround.

Implemented contract:

```ts
type TutorialFractionPointV1 = { x: number; y: number };

type TutorialPointerClickActionV1 = {
  type: "pointer-click";
  locator: TutorialLocatorV1;
  position: TutorialFractionPointV1;
  coordinateSpace: "fraction";
  timeoutMs?: number;
};

type TutorialPointerDragActionV1 = {
  type: "pointer-drag";
  locator: TutorialLocatorV1;
  from: TutorialFractionPointV1;
  to: TutorialFractionPointV1;
  coordinateSpace: "fraction";
  timeoutMs?: number;
};
```

Architecture rules and component ownership:

* **Browser runtime ownership (`src/browser/types.ts`):** `PlaywrightLikeTutorialPage` exposes minimal structural mouse input methods (`PlaywrightLikeMouse`: `move(x, y, options?)`, `down()`, `up()`). Browser abstraction and Playwright loading remain owned by `src/browser/`.
* **Tutorial runtime ownership (`src/tutorial/`):**
  - `src/tutorial/types.ts` defines `TutorialFractionPointV1`, `TutorialPointerClickActionV1`, and `TutorialPointerDragActionV1`.
  - `src/tutorial/scenarioValidation.ts` enforces closed validation, requiring `coordinateSpace: "fraction"`, bounding coordinates to `[0, 1]`, and rejecting zero-length pointer drags.
  - `src/tutorial/tutorialPointerGeometry.ts` converts validated locator-relative fraction points into absolute page coordinates within the locator bounding box.
  - `src/tutorial/tutorialActions.ts` executes real Playwright mouse input for `pointer-click` (`move`, `down`, `up`) and `pointer-drag` (sequence `mouse.move(start)`, `mouse.down()`, `mouse.move(end, { steps: 8 })`, `mouse.up()`), with `POINTER_DRAG_MOVE_STEPS = 8` and `mouse.up()` error cleanup.
  - `src/tutorial/tutorialSession.ts` and `src/tutorial/tutorialCursor.ts` manage non-authoritative synthetic cursor positioning and click feedback at resolved coordinates.
* **Preservation of existing contracts:**
  - Existing element-to-element `drag` remains unchanged and continues to use Playwright locator `dragTo`.
  - `TutorialScenarioV1`, `TutorialTargetContractV1`, `TutorialRunResultV1`, and `TutorialManifestV1` schemas remain version `1.0.0`.
  - Existing one-shot screenshot ownership, managed processes, target contracts, loopback policy, artifacts, video/subtitle/Markdown writers, and gallery boundaries remain unchanged.
* **Generic acceptance fixture (`examples/tutorial-browser/`):**
  - Lab-owned generic fixture carries an interactive SVG pointer surface, 9-step scenario, and pointermove tracking evidence.
  - Real Chromium integration (`tests/integration/tutorialRealBrowser.spec.ts`) and exact packed-package gate (`scripts/verify-packed-package.mjs`) exercise both actions against clean consumers.
* **Consumer boundary:**
  - Downstream `my-frontend-observer` is a read-only compatibility consumer; Observer-specific selectors, demo templates, and product behaviors remain outside the lab. Lab CI remains sibling-independent.

Explicit non-goals:

* No page-wide coordinates, element-pixel mode, configurable drag steps, touch/pen, alternate mouse buttons, arbitrary event payloads, JavaScript callbacks, or shell actions.
* No Observer-only selectors, fake drag handles, hidden tutorial controls, or alternate product interaction paths.
* No change to FFmpeg/MP4/audio/gallery scope and no warm-index work.

## Planned software-review architecture (v0.10.x-v0.12.x)

This section describes planned architecture only. None of the contracts or flows below are implemented in the current v0.4.8 release.

The literature/standards review does **not** require replacing the planned implementation architecture. ISO/IEC 25010 defines a product-quality reference model, ISO/IEC 25023 defines product-quality measurement guidance, and ISO/IEC 5055 defines automated structural source-code quality measures; these standards constrain taxonomy, measurement definitions, provenance, and interpretation rather than prescribing a runner/registry/report implementation. The lab therefore keeps the existing architectural direction: one audit runner, shared evidence collectors, registered detectors, the existing issue/report contracts, and the independently authoritative security subsystem.

The planned review track extends the existing audit pipeline instead of creating a second architecture/quality runner. The central planned addition is one reusable architecture-evidence layer that can combine existing lab inventory/source facts with bounded, version-checked my-dev-kit graph evidence and then expose that evidence additively through `AuditDetectorContext`.

```mermaid
flowchart LR
  Target[Target repository] --> Inventory[Existing project inventory]
  Target --> SourceFacts[Existing SourceFactsSnapshot]
  MDK[Supported my-dev-kit graph artifacts] --> Adapter[Planned bounded graph adapter]
  Inventory --> ArchitectureEvidence[Planned ArchitectureEvidenceSnapshot]
  SourceFacts --> ArchitectureEvidence
  Adapter --> ArchitectureEvidence
  ArchitectureEvidence --> Context[Existing AuditDetectorContext + additive architecture evidence]
  Context --> Detectors[Existing AuditDetector registry]
  Detectors --> Issues[Existing AuditIssue model]
  Issues --> Reports[Existing AuditReportModel + JSON/text renderers]
  Security[Existing securityValidation owner] --> SecurityAdapter[Existing security audit adapter]
  SecurityAdapter --> Issues
```

Planned ownership rules:

* **One architecture evidence collector:** graph artifacts should be validated and normalized once per audit run, analogous to inventory/source-facts collection. Cycle, topology, extensibility, quality, behavior, and evolution detectors must not each parse my-dev-kit artifacts independently.
* **Exact evidence boundaries:** graph schema/version, target identity, path containment, analyzer coverage, unresolved edges, and partial/unavailable evidence must be preserved. Unsupported evidence is never silently treated as zero or complete.
* **Existing detector/report contracts remain primary:** findings continue to use `AuditDetector`, `AuditIssue`, the existing audit runner, and additive audit-report fields. A new detector must not introduce its own command or report engine.
* **Security remains independently authoritative:** security validation, Android validation, attack scenarios, optional scanners, and security verdict policy remain owned by `src/securityValidation`. Project-wide software review consumes confirmed security findings through `src/audits/security` rather than duplicating those checks.
* **Six review dimensions are product/reporting classification, not an ISO conformance claim:** the complete `all` software-review view organizes evidence under behavior, architecture, security, operations, quality, and evolution. The `project` audit type itself owns only architecture, behavior, evolution, and operations; quality and security remain separate audit/security owners combined only by `all`. ISO/IEC 25010 and ISO/IEC 5055 inform metric terminology and mapping, but the six lab dimensions are not asserted to equal the complete ISO quality model. A finding may map to more than one lab dimension while the underlying detector/evidence owner remains single.
* **Metric provenance is part of the evidence contract:** future review metrics record origin (`standard`, `published-literature`, `established-tooling`, or `lab-defined`), source URL(s), definition version, scope, availability, evidence coverage, threshold source, and calibration version where applicable.
* **No universal score is an architectural requirement:** the default report model carries raw/derived measures, evidence coverage, and findings. ISO/IEC 25023-style context dependence is preserved by keeping thresholds/reference bands separate from raw measurements; v0.12.2 may calibrate benchmark/project reference bands without making an opaque overall score the primary contract.
* **Heuristic architecture conclusions stay candidates:** missing-abstraction, plugin-opportunity, adapter-opportunity, cohesion, and similar intent-sensitive findings must expose confidence/false-positive risk and the deterministic evidence they are based on.
* **Scenario-based extensibility remains additive evidence:** v0.10.2 models "add another variant" as an explicit change scenario and reports static extension-point/touchpoint/impact-set evidence informed by ALMA/EMSA-style architecture modifiability analysis. It does not label hypothetical files/contracts as "modified." Observed modification counts require an actual before/after change set from history or an experiment and use separate metric IDs.
* **History and runtime evidence are separate inputs:** v0.11.2 may add bounded read-only Git history for churn/co-committal evidence. Runtime profiling and DORA delivery metrics are not implied by static architecture evidence and require separate explicitly supplied evidence sources.


### Planned audit command ownership and exposure parity

The future software-review command surface preserves the v0.4.6 command-owner correction instead of reintroducing source/installed divergence.

```mermaid
flowchart LR
  Installed[my-dev-kit-lab audit] --> Router[src/cli/runLabCli.ts]
  Router --> Owner[src/commands/runAuditCommand.ts<br/>runAuditCommandFromArgs]
  Source[npm run audit --] --> Thin[scripts/audits/runAudit.ts<br/>thin adapter only]
  Thin --> Owner
  Contract[planned src/audits/core/auditCliContract.ts<br/>flag/value/help contract] --> Owner
  Contract --> Config[src/audits/core/auditConfig.ts]
  Owner --> Config
  Owner --> Runner[src/audits/core/auditRunner.ts]
  Runner --> Registry[AuditDetector registry]
  Runner --> Security[src/audits/security adapter]
  Runner --> Reports[src/audits/report]
```

Planned ownership rules:

* `runLabCli` owns only top-level `audit` routing and the global `--workspace` option. It must never parse software-review-specific audit flags.
* `scripts/audits/runAudit.ts` remains a thin source-checkout adapter and must never gain an independent parser, help text, default policy, or report logic.
* `runAuditCommandFromArgs` remains the single command owner for audit help, argument/config normalization, target/evidence resolution, execution, report writing, and fatal error mapping.
* The first new public review flags (v0.10.1) add one shared audit CLI contract under `src/audits/core` so parser-recognized flags and rendered usage/help cannot drift. Existing `AUDIT_USAGE` semantics are preserved through that owner.
* `auditConfig.ts` remains the normalized configuration owner. New evidence flags become explicit typed fields; invalid flag combinations fail before `runAudit`.
* `runAudit` remains the single execution owner. Shared inventory, source facts, architecture evidence, optional history/test evidence, and project metadata are collected once and passed through one detector context. For `all`, normalized configuration keeps requested versus expanded types separate; `all` is never a detector audit type, registered non-security detectors still execute once in registry order, and security remains a single adapter invocation after that detector loop.
* Installed/source parity is mandatory for every release that adds an audit option. Tests must exercise both entry paths with the same option matrix and compare normalized selection/configuration, report semantics, and exit behavior.
* The existing implicit-output-root difference is intentional and remains documented: installed execution defaults under `workspaceRoot`; source-checkout execution defaults under the package/repository root. Explicit `--out` and all other explicit paths have identical semantics. New selector directory names are based on the requested selector (`project`, `quality`, `all`), not the first expanded type; new explicit multi-type combinations use a deterministic combined-type slug while the existing `code-rot,security` legacy path is preserved.

The staged public exposure is:

```text
v0.10.1  project audit + architecture dimension
v0.10.2  project/architecture gains extensibility and reuse evidence
v0.11.0  quality audit
v0.11.1  project gains behavior
v0.11.2  project gains evolution
v0.12.0  project gains operations
v0.12.1  all aggregate + HTML audit report
```

`project` therefore is **not** an internal-only capability waiting until v0.12.1. The first architecture-review release exposes it through both supported audit entry paths.

The existing `--include` contract remains the detector-area filter. v0.11.0 adds a `source` area for production-source quality detectors using type-aware defaults, while the legacy no-flag code-rot default remains exactly `docs,tests,package,architecture,cli`. Evidence collectors may still gather shared facts once even when no selected detector consumes them; `--include` controls detector eligibility, not security-adapter execution.

#### Planned review configuration contract

The first public project audit also introduces a versioned, declarative `ReviewConfigV1` input for evidence that cannot be inferred safely:

```ts
type ReviewTestCommandV1 = {
  id: string;
  argv: readonly string[];
  cwdRelative?: string;
  timeoutMs: number;
};

type ReviewSymbolSelectorV1 = {
  relativePath: string;
  symbolName: string;
  symbolKind?: "class" | "interface" | "type" | "function" | "enum" | "variable" | "constant";
};

type ReviewConfigV1 = {
  schemaVersion: "1.0.0";
  architecture?: {
    layers?: readonly {
      id: string;
      pathPrefixes: readonly string[];
      mayDependOn: readonly string[];
    }[];
    extensionPoints?: readonly {
      id: string;
      contract: ReviewSymbolSelectorV1;
      registry?: ReviewSymbolSelectorV1;
    }[];
    changeScenarios?: readonly {
      id: string;
      description: string;
      featureFamily?: string;
      extensionPointId?: string;
    }[];
  };
  behavior?: {
    testCommands?: readonly ReviewTestCommandV1[];
  };
};
```

The serialized contract is closed for the supported schema version: unknown fields fail rather than being silently ignored. IDs are unique within their collections. `pathPrefixes` are normalized repository-relative POSIX prefixes only; absolute paths, `..`, glob syntax, and symlink traversal are invalid. v1 rejects overlapping layer prefixes rather than inventing hidden precedence. Layer self-dependency is implicitly allowed; `mayDependOn` lists additional declared layer IDs and every reference must resolve. Files outside all declared layer prefixes are unclassified, never automatic violations; layer-rule evidence reports classified/unclassified coverage. Symbol selectors use repository-relative path + symbol name (+ optional kind) to prevent name-only ambiguity. A configured selector that cannot be uniquely resolved is reported as an explicit requested-policy/evidence problem according to analyzer availability; it is never silently rebound. Test commands are structured argv only, run with `shell:false`, and are executable only after the explicit `--run-target-tests` opt-in. `cwdRelative` must remain within the disposable target copy, `timeoutMs` must be a positive bounded integer, and the v1 config has no arbitrary environment mutation. The config expresses review evidence/policy; it never authorizes source edits.

### Planned review metric evidence contract

A future metric model should remain additive to audit evidence and should not become a second verdict engine. A code-shaped target is:

```ts
type ReviewDimensionV1 =
  | "behavior"
  | "architecture"
  | "security"
  | "operations"
  | "quality"
  | "evolution";

type ReviewMetricOriginV1 =
  | "standard"
  | "published-literature"
  | "established-tooling"
  | "lab-defined";

type ReviewMetricAvailabilityV1 =
  | "available"
  | "partial"
  | "unavailable"
  | "not-applicable";

type ReviewMetricV1 = {
  id: string;
  dimensions: readonly ReviewDimensionV1[];
  origin: ReviewMetricOriginV1;
  sourceUrls: readonly [string, ...string[]];
  definitionVersion: string;
  scope: string;
  availability: ReviewMetricAvailabilityV1;
  value: number | null;
  unit: string;
  numerator?: number;
  denominator?: number;
  evidenceCoverage?: number;
  confidence?: "high" | "medium" | "low";
  thresholdSource:
    | "none"
    | "configured-policy"
    | "project-baseline"
    | "benchmark-band"
    | "external-policy";
  calibrationVersion?: string | null;
};
```

The exact implementation type may evolve during version planning, but the semantics are fixed: source URLs and formula provenance travel with the metric; unavailable/partial evidence is explicit; ratios retain their denominators; and calibrated interpretation is separate from the raw measurement.

The canonical planned metric definitions and research URLs are maintained in [METRICS.md](METRICS.md). The architecture layer must not independently redefine those formulas.

### Planned issue-dimension and aggregate contract

The six-dimension combined report is an additive view over the existing issue model, not a replacement severity/verdict system.

```ts
type ReviewDimensionV1 =
  | "behavior"
  | "architecture"
  | "security"
  | "operations"
  | "quality"
  | "evolution";

// Additive field on AuditIssue by v0.12.1.
type AuditIssueReviewDimensionsV1 = {
  reviewDimensions: readonly [ReviewDimensionV1, ...ReviewDimensionV1[]];
};
```

Rules:

* `all` is a command selector only and must never be assigned to `AuditDetector.auditType`.
* `code-rot`, `quality`, and `project` detectors execute through the existing detector registry. The security type remains the existing adapter executed once after the detector loop.
* Existing code-rot findings receive explicit reviewed mappings to one or more dimensions by v0.12.1; there is no blanket rule that every code-rot issue is a quality issue.
* Security-adapter findings receive the `security` dimension while preserving their original security report/finding identity.
* One issue may appear in several dimension views, but the underlying issue exists once. Total issue count comes from the deduplicated issue set, never the sum of dimension counts.
* A finding in an `all` report without an explicit review dimension is a contract/test failure, not silently placed into an "other" bucket.

### Planned production owners for software review

These paths define ownership, not parallel frameworks:

| Planned owner | Responsibility |
|---|---|
| `src/audits/core/auditCliContract.ts` | One source of truth for audit flags, values, help rendering metadata, and staged option availability |
| `src/audits/core/auditConfig.ts` | Raw-to-normalized audit config, requested/expanded types, dimensions, type-aware include defaults, option-combination validation |
| `src/audits/core/reviewConfig.ts` | `ReviewConfigV1` parsing, closed-schema/path/reference validation |
| `src/audits/core/reviewMetric.ts` | `ReviewDimensionV1`, `ReviewMetricV1`, provenance/availability validation |
| `src/audits/core/architectureEvidence.ts` | `ArchitectureEvidenceSnapshot` contract and shared availability/coverage model |
| `src/audits/core/readMyDevKitArchitectureEvidence.ts` | Version/identity/path-safe adapter from supported my-dev-kit graph artifacts |
| `src/audits/core/historyEvidence.ts` | v0.11.2 bounded read-only Git history/churn/co-committal evidence |
| `src/audits/quality/detectors/` | v0.11.0 quality detector implementations registered into the existing audit registry |
| `src/audits/project/detectors/` | Architecture/behavior/evolution/operations project detectors, added by their owning versions |
| `src/audits/report/` | Existing report model/renderers extended additively for metrics, dimensions, availability, HTML |
| `src/experiments/config.ts` | v0.5.0 generic `ExperimentConfigFileV1` loading/config-source metadata |
| `src/experiments/types.ts` | additive plugin `resolveInputs`/config-source contract |
| `src/experiments/plugins/softwareReviewCalibration/` | v0.12.2 calibration plugin; invokes audit/review programmatically |
| `src/commands/runAuditCommand.ts` | unchanged single audit command owner |
| `src/commands/runExperimentRunCommand.ts` | unchanged single experiment-run command owner after generic config generalization |

No new top-level `src/review/` runner, second audit registry, second command parser, or review-specific report framework is planned.

The following layers remain planned and must not be treated as current behavior:

- JVM package/environment rot or Gradle/Maven dependency freshness checks
- the v0.10.0 shared architecture-evidence snapshot/adapter and repository graph consumption
- v0.10.1 deterministic architecture topology analysis (cycles, fan-in/fan-out, static blast radius, and explicit-rule dependency direction)
- v0.10.2 extensibility/reuse analysis (extension-point bypass, parallel architecture, static extension-impact evidence, and candidate missing abstractions/plugins/adapters)
- the `quality` audit type and v0.11.0 maintainability/complexity analysis
- v0.11.1 behavior/test evidence and optional explicitly configured sandboxed target-test evidence
- v0.11.2 read-only history/change-coupling/change-cost evidence
- v0.12.0 non-security operational-quality/resilience analysis
- the `project` audit selection and architecture dimension planned for v0.10.1, with behavior/evolution/operations added incrementally through v0.12.0
- the `all` aggregate selection, cross-type deduplication, and complete six-dimension combined view planned for v0.12.1
- the v0.12.2 software-review benchmark/calibration suite
- a human-led manual pentest workflow after `v1.0.0`
- additional experiment plugins for warm indexes, freshness, scale, retrieval quality, and agent success (`v0.5.0` and later)
- normalized telemetry, scheduling, prompt hardening, and generalized report/gallery publication
- later gallery consumption of the canonical tutorial manifest

`v0.4.3` stage-specific bounded-context and workflow-instruction evaluation is implemented and published (see "Stage-context evaluation architecture (v0.4.3)" above). `v0.4.5` context-integrity evaluation is implemented and published (see "Context-integrity evaluation architecture (v0.4.5)" above).

Future audit/review work should reuse `src/audits/core`, `src/audits/security`, target metadata, source facts, the normalized issue schema, and shared reports. Shared graph/history evidence should be collected once and added to the existing detector context rather than parsed independently by each detector. Future review work must not replace the experiment runtime, duplicate report/gallery systems, create one command per review dimension, or absorb `security:validate` into the audit framework.

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
| v0.4.7 tutorial contracts and types (released) | `src/tutorial/types.ts` |
| v0.4.7 persistent tutorial session and cursor overlay (released) | `src/tutorial/tutorialSession.ts` / `src/tutorial/tutorialCursor.ts` |
| v0.4.8 pointer actions and fraction point types (released) | `src/tutorial/types.ts` |
| v0.4.8 pointer geometry resolution (released) | `src/tutorial/tutorialPointerGeometry.ts` |
| v0.4.8 pointer action execution and move steps (released) | `src/tutorial/tutorialActions.ts` |
| v0.4.8 structural browser mouse interface (released) | `src/browser/types.ts` |
| v0.4.8 generic tutorial browser fixture (released) | `examples/tutorial-browser/` |
