# Workflows

## Current workflow families

The repository supports experiment campaigns, evidence rendering, generic audits, automated security validation, Android validation, implementation verification, documentation reconciliation, and release operations. Each workflow below states its goal, prerequisites, steps, outputs, failure handling, and completion condition. Exact options belong in [COMMANDS.md](COMMANDS.md).

Android defaults remain static and start zero Gradle, external tool, and network processes. Release chronology belongs in [CHANGELOG.md](../CHANGELOG.md); future scope belongs in [ROADMAP.md](ROADMAP.md).

## Fake-agent final demo

**Goal:** validate the complete experiment-to-gallery pipeline without external agent CLIs.

**Prerequisites and starting state:** install dependencies and run `npm run build`. The fixture command and example cases must be present in the checkout.

**Steps:**

```bash
npm run build
npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot
```

**Expected outputs:**

- experiment summary artifacts
- HTML/JSON report
- plots
- visualization demo artifacts
- gallery artifacts

**Failure handling:** inspect the first failing stage and its stderr; keep partial artifacts for diagnosis. Rebuild after source changes.

**Completion:** the command exits successfully and the report, plots, visualization artifacts, and gallery are present beneath `lab-output/final-demo`.

## Context-strategy experiment run

**Goal:** compare `raw-full-file` and `my-dev-kit-guided` through the implemented `context-strategy-comparison` plugin.

**Prerequisites and starting state:** build the repository and choose either self mode or an existing local target. The target must remain unchanged during the run.

**Steps:**

```bash
npm run experiment:run -- --experiment context-strategy-comparison --target /path/to/local/project --agents fake-agent --complexities short --no-screenshot
```

**Expected behavior and outputs:**

- omitting `--target` uses self mode
- explicit targets are inspected without modifying target files
- normalized plugin and legacy experiment artifacts are written beneath the selected output root

**Failure handling:** invalid plugin IDs or options fail before the run. Agent-related partial outcomes remain structured results rather than being rewritten as successful comparisons.

**Completion:** both strategies have recorded outcomes and the target remains unchanged.

## Stage-context strategy evaluation (v0.4.3)

**Goal:** deterministically evaluate one of the six new stage-context strategies against explicit artifact inputs and an explicit expectation fixture, through the same `context-strategy-comparison` plugin.

**Prerequisites and starting state:** build the repository; supply explicit `v043StrategyInputs` programmatic configuration (expectations fixture path plus the artifact paths the selected strategy requires) — there is no CLI flag for these paths.

**Steps (implemented sequence):**

1. Read explicit artifact inputs (context capsule, retrieval-audit record, and/or `WorkflowInstructionPacket`) through the exact readers in `src/evaluation/upstreamArtifacts`.
2. Validate exact artifact schemas; unsupported schema majors or malformed input fail explicitly rather than being silently reinterpreted.
3. Validate the `StageContextExpectationFixtureV1` expectation fixture.
4. Execute the selected strategy and assemble its payload.
5. Collect observed evidence from the payload.
6. Match observed evidence against the expectation fixture's required/allowed/forbidden evidence.
7. Calculate evidence-centered metrics (recall, coverage, inclusion, responsibility mapping, state comparisons, context size).
8. Capture target-immutability before/after snapshots when target-immutability configuration is supplied.
9. Repeat runs (1 through 10) when a `repeatCount` greater than 1 is configured.
10. Calculate repeated-run determinism from the repeated runs.
11. Build the bounded `report.json`, `report.html`, and `report.txt` reports through the existing plugin report system.

**Expected behavior and outputs:** the target is never modified; missing upstream evidence is reported as `unavailable`, never coerced to zero; the report contains no composite score, grade, ranking, or winning strategy.

**Failure handling:** malformed artifacts or unsupported schema majors fail clearly. A detected target mutation is reported as a mutation, not auto-repaired or reset.

**Completion:** the bounded report reflects the selected strategy's execution, evaluation, and (when configured) run-assurance results. This workflow does not have a CLI entrypoint; all inputs are supplied programmatically. `v0.4.3` published this workflow and completed the pre-release readiness, cross-platform, security, and code-rot workflow before publication; see [ROADMAP.md](ROADMAP.md).

## Producer-readiness bridge evaluation (v0.4.4)

**Goal:** deterministically evaluate owner, allocation, truncation-cause, supplemental/raw agreement, readiness-agreement, and criticality-overlay evidence for the `combined-bounded-stage-context` strategy, without reproducing upstream producer or orchestrator-readiness policy.

**Prerequisites and starting state:** build the repository; supply the same `combined-bounded-stage-context` strategy input as `v0.4.3`, optionally extended with the implementation/test-context packet and retrieval-report file paths and a readiness plain object — there is no CLI flag for any of these inputs.

**Steps (implemented sequence):**

1. Load the same raw `ContextCapsule`/`RetrievalAuditRecord`/`WorkflowInstructionPacket` artifacts as `v0.4.3`.
2. When supplied, read the implementation/test-context packet and retrieval-report files through the `v0.4.4` supplemental readers (`src/evaluation/upstreamArtifacts`); when supplied, validate the readiness plain object through `validateOrchestratorContextReadinessResultV1` — never from a file, since the frozen orchestrator commit exposes no on-disk readiness artifact.
3. Run the existing `v0.4.3` stage-context evaluation unchanged.
4. Run the additive producer-readiness bridge evaluator (`evaluateProducerReadinessBridge`) once per run, composing the `v0.4.4` metric calculators over already-loaded evidence.
5. Capture target-immutability and repeated-run determinism exactly as `v0.4.3` does, now also covering the bridge result.
6. Build the same bounded `report.json`, `report.html`, and `report.txt` reports, with an additive, optional producer-readiness bridge section.

**Expected behavior and outputs:** absent supplemental/readiness inputs leave the bridge section reporting `not-applicable`/`unavailable` per metric rather than inventing evidence; existing `v0.4.3` strategies and reports are unaffected when no bridge inputs are supplied; the report contains no composite score, grade, ranking, or winning strategy; readiness, producer parity, owner selection, and allocation are never recomputed.

**Failure handling:** a supplied-but-unreadable supplemental path or an invalid readiness object fails the strategy execution clearly, the same way a malformed raw artifact does.

**Completion:** the bounded report reflects the selected strategy's execution, evaluation, and producer-readiness bridge evaluation. This workflow is released in v0.4.4 after upstream verification, PR, CI, merge, tag, GitHub Release, and npm publish. All release documentation is in final post-publication state. See [CURRENT_STATE.md](CURRENT_STATE.md) and [ROADMAP.md](ROADMAP.md).

## Context-integrity evaluation (v0.4.5, implemented, unreleased)

**Goal:** deterministically evaluate agreement between condition-aware producer evidence (mirrored from the frozen local `my-dev-kit` `v1.10.4` contract) and orchestrator run-integrity evidence (mirrored from the frozen local `my-dev-kit-orchestrator` `v1.2.3` contract) for a fixed request/target/index identity, using a frozen regression fixture pair, without reimplementing either upstream project's policy.

**Prerequisites and starting state:** build the repository. This workflow has no configurable CLI entrypoint; it runs through tests and through `npm run report:context-integrity-smoke` (a fixed, argument-less script that calls the underlying evaluation functions directly with the frozen fixture paths for manual report inspection).

**Steps (implemented sequence):**

1. Load the fixture manifest (`failed-run` or `corrected-replay`) and verify tracked fixture file SHA-256 hashes against the manifest through `src/evaluation/ecosystemFixtures`.
2. Parse the condition-aware `ContextCapsule`/`RetrievalAuditRecord` producer evidence through the exact `v0.4.5` readers in `src/evaluation/upstreamArtifacts`.
3. Validate the loaded capsule/audit evidence against the same consistency selectors `v0.4.3`/`v0.4.4` use.
4. Calculate allocation, spillover, and condition-coverage metrics from the parsed producer evidence.
5. Parse the mirrored orchestrator run-integrity evidence (`RunIntegrityGateResult`, `JudgeIntegrityResult`, `FinalReportEligibilityResult`, and the `artifact-state.json` lifecycle record) through the `v0.4.5` orchestrator readers and selectors.
6. Calculate agreement between the producer evidence and the run-integrity evidence for each defined comparison pair, using the shared `AgreementOutcomeV1` vocabulary (`agreement` / `contradiction` / `insufficient-evidence` / `unsupported-legacy-evidence` / `not-applicable`).
7. Calculate the end-to-end agreement category from the individual agreement results.
8. Verify determinism by repeating the evaluation (reusing `calculateStageContextDeterminism`) and comparing canonicalized results.
9. Verify fixture self-immutability by re-running hash verification against the frozen fixture bytes.
10. Build the bounded `ContextIntegrityReportV1` JSON, text, and HTML reports through `buildContextIntegrityReport` and the corresponding renderers in `src/report/experiments`.

**Expected behavior and outputs:** the `failed-run` fixture evaluates to `contradiction-present` end-to-end and preserves real evidence of judge/lifecycle contradictions; the `corrected-replay` fixture evaluates to `full-agreement`; missing or legacy-incompatible evidence (e.g. no `roleConditionCoverage` on the failed-run producer) is reported as `unsupported-legacy-evidence`/`unavailable`, never coerced into agreement or zero; no composite score, grade, ranking, or winner is produced. The corrected-replay fixture and any report or document describing it must state that it is a hand-distilled representation of the validated `v1.10.4`/`v1.2.3` contracts, not a live capture of a complete ten-stage workflow and not proof that every future run will behave identically.

**Failure handling:** a hash-verification failure or malformed fixture manifest fails the load step clearly rather than falling back to unverified bytes. A missing or malformed piece of evidence produces an `unavailable`/`insufficient-evidence` agreement result rather than a fabricated agreement or contradiction.

**Completion:** the bounded report reflects hash-verified, deterministic evaluation of the selected fixture, and the underlying fixture bytes and recorded hashes are unchanged by evaluation. This workflow is implemented on the `fix/v0.4.5-context-integrity-validation` implementation branch and has not gone through pre-release readiness, release preparation, or publication. See [CURRENT_STATE.md](CURRENT_STATE.md) and [ROADMAP.md](ROADMAP.md).

## Real-agent campaign

**Goal:** run matched Codex or Claude trials while preserving partial outcomes.

**Prerequisites and starting state:** configure the selected local CLIs, confirm usage capacity, build the repository, and choose a bounded case set.

**Steps:**

```bash
npm run run-controlled-experiment -- --cases examples/real-agent-campaign-cases.json --agents codex,claude --strategies raw-full-file,my-dev-kit-guided --complexities medium,multi-step --out lab-output/real-agent-campaign --include-real-agents --continue-on-failure --timeout-ms 240000
```

**Expected outputs:**

- partial outcomes are preserved
- missing token totals and timeouts are reported explicitly

**Failure handling:** use `--continue-on-failure` for campaigns where one provider failure should not discard other runs. Treat provider limits and unavailable token totals as evidence limitations, not product regressions.

**Completion:** every scheduled run has a completed or explicit partial outcome and the campaign artifacts are available for rendering.

## Report, plots, and gallery

**Goal:** render existing experiment artifacts into reports, plots, and a browsable gallery.

**Prerequisites and starting state:** complete an experiment and verify the input artifact directories shown below exist.

**Steps:**

```bash
npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake --no-screenshot
npm run generate-experiment-plots -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-plots
npm run build-gallery -- --report lab-output/experiment-report-fake --plots lab-output/experiment-plots --visualizations lab-output/visualization-demos --out lab-output/gallery
```

**Expected outputs:** JSON/HTML reports, plot data and SVG charts, a gallery manifest, and `gallery-index.html`.

**Failure handling:** correct the missing or mismatched input directory reported by the failing renderer. Do not fabricate absent artifacts.

**Completion:** open `lab-output/gallery/gallery-index.html` and confirm its relative links resolve.

## Automated security validation

**Goal:** collect standalone automated CLI/package security evidence and a structured verdict.

**Prerequisites and starting state:** build the repository; choose self mode or an existing local target. Optional scanners may be unavailable.

**Steps:**

```bash
npm run security:validate
```

Targeted example:

```powershell
npm run security:validate -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"
```

**Expected behavior and outputs:**

- optional tools are skipped, not treated as passed
- target files are not modified by default
- this is automated validation, not manual pentest

Reports are written beneath `reports/security/` unless `--out` is supplied.

**Failure handling:** treat unavailable optional tools as `skipped`, not passed. Investigate failed checks and inconclusive environments from the generated report; do not weaken thresholds to hide findings.

**Completion:** the selected checks finish, the report records every pass/failure/skip, and the target mutation evidence shows no unintended change.

## Code-rot audit

**Goal:** inspect repository-health signals with the implemented code-rot detector family.

**Prerequisites and starting state:** build the repository and choose a local target. TypeScript/JavaScript, Python, Java, and Kotlin evidence is static and conservative.

**Steps:**

```bash
npm run audit
```

Targeted example:

```powershell
npm run audit -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --types code-rot --fail-on none
```

**Expected behavior and outputs:**

- `code-rot` runs in this workflow; `security` runs through the security-validation audit adapter below
- audit is independent from `security:validate`
- audit findings are heuristic candidates and do not auto-fix anything
- source-facts evidence (TypeScript/JavaScript, Python, Java, and Kotlin) is conservative static-analysis evidence, not proof of dead code, semantic duplicate implementation, complete test coverage, full module resolution, runtime reachability, or language-specific semantic correctness
- for Java/Kotlin targets, the workflow reads files and static Gradle/Maven/source-set metadata only; it does not execute Gradle, Maven, compilers, Android tooling, or target tests

Generated report location: `reports/audits/code-rot/code-rot-audit.txt` / `.json` (or `--out <path>` when supplied).

**Failure handling:** exit code `1` means an issue met the selected threshold; exit code `2` means invalid configuration, target resolution failure, or runtime failure. Review candidates before treating them as defects.

**Completion:** reports are written, target files remain unchanged, and every issue is interpreted as evidence rather than proof.

## Security-validation audit adapter

**Goal:** include standalone security-validation results in the shared audit report.

**Prerequisites and starting state:** use the same target requirements as standalone security validation. This adapter does not replace `security:validate`.

**Steps:**

```bash
npm run audit -- --types security --fail-on none
```

Targeted example:

```powershell
npm run audit -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --types security --fail-on none
```

```mermaid
flowchart LR
  Command[npm run audit --types security] --> Adapter[audits/security adapter]
  Adapter --> Validation[securityValidation.runSecurityValidation]
  Validation --> Checks[deps / package / static / cli-adversarial / fuzz]
  Checks --> Findings[SecurityFinding list + verdict]
  Findings --> Mapped[Mapped audit issues]
  Findings --> OriginalReports[reports/security/*.txt / *.json - unchanged]
  Mapped --> AuditReport[Audit report: issues + securitySummary]
  OriginalReports -. linked from .-> AuditReport
```

**Expected behavior and outputs:**

- reuses the same default check groups `security:validate` runs with no flags; there is no `--checks`/`--profile` passthrough on `npm run audit` yet
- adds a `securitySummary` field to the audit JSON/text report (verdict, check counts, finding counts, and links to the original security report)
- skipped optional security checks are represented only in `securitySummary`'s counts — never as a passed check, never as an audit issue
- the original `reports/security/` report family is generated exactly as `security:validate` would generate it
- generated report location: audit report under `reports/audits/security/code-rot-audit.txt` / `.json`; original security report under `reports/security/<prefix>-security-validation.txt` / `.json`

**Failure handling:** optional-tool skips remain summary data; they never become audit issues or passes. Use the original security report for complete evidence.

**Completion:** both report families exist, the audit report links to the security report, and mapped issues correspond only to confirmed findings.

## Combined code-rot and security audit

**Goal:** run both implemented audit types and apply one fail-on threshold to their combined issue list.

**Prerequisites and starting state:** satisfy the code-rot and security-audit prerequisites above.

**Steps:**

```bash
npm run audit -- --types code-rot,security --fail-on none
```

```mermaid
flowchart LR
  Command[npm run audit --types code-rot,security] --> CodeRot[10 code-rot detectors]
  Command --> SecAdapter[Security audit adapter]
  CodeRot --> Issues[Combined issues list: code-rot first, then security]
  SecAdapter --> Issues
  Issues --> FailOn[--fail-on threshold applied to combined list]
  FailOn --> Report[Audit report: issues + securitySummary]
```

**Expected behavior and outputs:**

- code-rot issues are ordered first (detector registry order), followed by mapped security issues, deterministically
- `--fail-on` applies to the combined issue list

**Failure handling:** distinguish detector errors from threshold-triggering findings in the report. Preserve the standalone security report for diagnosis.

**Completion:** deterministic combined issues and the security summary are written without modifying the target.

## Implementation completion

Every implementation version ends with these stages before pre-release readiness:

1. implementation-completeness review
2. documentation source-of-truth reconciliation
3. validation commands
4. pre-release readiness review

Documentation reconciliation is a required workflow stage. It is not its own semantic version.

## Documentation reconciliation

Use this workflow after implementation work and before pre-release readiness.

Required actions:

1. reconcile README, roadmap, architecture, workflows, commands, and current-state docs with the checked-in implementation
2. confirm current versus planned behavior is clearly separated
3. remove stale roadmap assignments or relabel them as future/historical as appropriate
4. run the required validation commands for the repository

This workflow does not create a separate product version.

## Pre-release readiness

Use this workflow after implementation completion and documentation reconciliation.

Typical commands:

```bash
npm run typecheck
npm run build
npm run test
npm run verify
npm run docs:check
```

Run safe command discovery/help smokes for changed command families and any release-specific fixture checks. Android releases must preserve project detection, manifest and advanced-security checks, report-schema stability, non-destructive target evidence, and optional-tool skip handling. Required CI must pass on the repository's configured operating-system matrix before publication work begins.

**Completion:** the worktree is clean, package/release metadata is internally consistent, required checks pass, and no generated report or local artifact is staged.

## Release preparation and publication

These are separate from implementation and documentation reconciliation.

Release preparation includes:

- changelog verification
- package/release hygiene checks
- final readiness review
- version change from the previous release to the target release version

Publication includes:

- publish/tag/release steps when explicitly authorized

Do not collapse these stages into implementation work.

### v0.4.4 release preparation and publication procedure

This procedure is inactive until a separately authorized release workflow
begins. Completing the correction or readiness workflow does not authorize any
step below.

1. Require published `my-dev-kit@1.10.3`.
2. Require published `my-dev-kit-orchestrator@1.2.2`.
3. Revalidate lab compatibility against both published upstream packages.
4. Verify the corrected `v0.4.4` candidate commit and clean candidate branch.
5. Confirm that `@dailephd/my-dev-kit-lab@0.4.4` is available on npm.
6. Create `release/v0.4.4` from the verified candidate.
7. Update `package.json` and both package-lock root version fields to `0.4.4`.
8. Update the changelog and release-state documentation for the release.
9. Run the complete configured repository validation suite.
10. Run self-security and target-aware security validation.
11. Run the code-rot audit and package-content security checks.
12. Run the corrected full-bridge JSON, text, and HTML report smoke.
13. Inspect the complete `npm pack --dry-run` inventory.
14. Commit the exact release files and push `release/v0.4.4`.
15. Create a pull request targeting `main`.
16. Require passing CI, review, and the repository's approved pull-request gate.
17. Merge only through that approved pull-request gate.
18. Verify the merged release commit on `main`.
19. Create and push tag `v0.4.4` at the verified merged commit.
20. Create the GitHub Release for `v0.4.4` and verify its tag and commit.
21. Verify npm authentication, registry state, and version availability again.
22. Run `npm publish --access public` as the final publication command because
    it requires the user's passkey.
23. Verify the published package and that npm `latest` resolves to `0.4.4`.
24. Run read-only post-publication CLI, report, and compatibility smoke tests.

### Publication-order invariant

`npm publish --access public` must be the final state-changing command of the full release workflow. All GitHub repository work must finish before npm publication. Specifically, the following must all complete before `npm publish` runs:

- release docs (CHANGELOG, README, docs) committed
- release-prep and merge commits made
- the default/publication branch pushed
- required GitHub Actions passed
- the git tag in place, local and remote
- a GitHub Release in place and verified against that tag/commit
- `npm pack --dry-run` inspected
- the release-channel parity gate below verified

After `npm publish` succeeds, only read-only verification commands are allowed:

- `npm view <package>@<version> version`
- `npm view <package> versions --json`
- `gh release view <tag>`
- `git status --short`

No commits, tags, pushes, or GitHub Release creation may happen after `npm publish`. If docs need to be updated to reflect the now-published state, that update is a separate, explicit follow-up commit — it does not change the invariant that no further GitHub-side release work happens before `npm publish` in the same release.

### Release-channel parity gate

Before any future `npm publish`, verify:

- package.json target version
- package-lock.json target version (and `packages[""].version`, if applicable)
- the npm target version does not already exist on the registry
- the default/publication branch is pushed
- required GitHub Actions passed
- the local and remote git tag exist (or are created before `npm publish`, per repo policy)
- a GitHub Release is in place and points to the correct tag/commit before `npm publish`
- `npm pack --dry-run` passes with expected contents
- `git status --short` is clean

Do not treat a GitHub Release as optional when the GitHub CLI is authenticated and available — create it and verify it before publishing.

## Android validation

**Goal:** statically validate an existing Android project and produce security evidence.

**Prerequisites and starting state:** choose an Android project and keep all Gradle, external-tool, and network opt-ins disabled unless the review explicitly requires them.

**Steps:**

Current command:

```bash
npm run security:validate -- --target /path/to/android/project --profile android
```

**Expected behavior and outputs:**

- validate existing Android projects
- preserve non-destructive target handling
- include report/schema stability inside each Android implementation version

The default run executes nineteen checks and starts zero Gradle, external-tool, and network processes. Reports remain under the security report root.

**Failure handling:** unavailable optional tools are skipped. Report target mutations; never clean or reset the target to hide them.

**Completion:** the report records Android applicability, findings, CandidateEvidence, skips, verdict, and unchanged-target evidence.

## Android extension of the security audit adapter

**Goal:** add confirmed Android findings and bounded Android summaries to the existing security audit adapter.

**Prerequisites and starting state:** choose an Android project and include `security` in `--types`. The audit command exposes no Gradle, external-tool, or network opt-ins.

**Steps:**

Current command (published):

```bash
npm run audit -- --target /path/to/android/project --types security --android --format text,json --fail-on none
```

**Expected behavior and outputs:** confirmed Android findings use the existing mapping path; `CandidateEvidence` remains separate; the report links to the full standalone Android evidence. Omitting `--android` preserves the non-Android audit path.

**Failure handling:** Android validator failures are contained and reported without discarding already collected non-Android issues.

**Completion:** Android status, completeness, verdict, report references, mapped counts, and review-only evidence summaries appear in the audit output.

## Manual pentest

Manual pentest is deferred until after `v1.0.0`.

It is a human-led workflow and is not required for automated Android security validation.
