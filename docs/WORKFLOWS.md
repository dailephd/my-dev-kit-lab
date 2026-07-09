# Workflows

This document separates implementation workflows, documentation reconciliation, pre-release readiness, release preparation, and future planned workflows.

## Workflow 1: Fake-agent final demo

Use this workflow to validate the full experiment pipeline locally without external agent CLIs.

```bash
npm run build
npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot
```

Outputs:

- experiment summary artifacts
- HTML/JSON report
- plots
- visualization demo artifacts
- gallery artifacts

## Workflow 2: Context-strategy experiment run

Use the implemented `context-strategy-comparison` plugin to compare `raw-full-file` and `my-dev-kit-guided`.

```bash
npm run experiment:run -- --experiment context-strategy-comparison --target /path/to/local/project --agents fake-agent --complexities short --no-screenshot
```

Current behavior:

- omitting `--target` uses self mode
- explicit targets are inspected without modifying target files

## Workflow 3: Real-agent campaign

Use this workflow for Codex or Claude runs when local CLIs are configured.

```bash
npm run run-controlled-experiment -- --cases examples/real-agent-campaign-cases.json --agents codex,claude --strategies raw-full-file,my-dev-kit-guided --complexities medium,multi-step --out lab-output/real-agent-campaign --include-real-agents --continue-on-failure --timeout-ms 240000
```

Current behavior:

- partial outcomes are preserved
- missing token totals and timeouts are reported explicitly

## Workflow 4: Report, plots, and gallery

Use this workflow to render outputs from existing experiment artifacts.

```bash
npm run render-experiment-report -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-report-fake --no-screenshot
npm run generate-experiment-plots -- --experiment lab-output/controlled-experiment-fake --out lab-output/experiment-plots
npm run build-gallery -- --report lab-output/experiment-report-fake --plots lab-output/experiment-plots --visualizations lab-output/visualization-demos --out lab-output/gallery
```

## Workflow 5: Automated security validation

Use this workflow for the current implemented `security:validate` path.

```bash
npm run security:validate
```

Targeted example:

```powershell
npm run security:validate -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"
```

Current behavior:

- optional tools are skipped, not treated as passed
- target files are not modified by default
- this is automated validation, not manual pentest

## Workflow 6: Code-rot audit

Use this workflow for the current implemented audit path. The published `v0.3.0` baseline provides the generic audit framework and code-rot detectors; the active `v0.3.1` branch adds language-aware TypeScript/JavaScript source facts and source-facts-aware candidate evidence without adding command flags.

```bash
npm run audit
```

Targeted example:

```powershell
npm run audit -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1" --types code-rot --fail-on none
```

Current behavior:

- only `code-rot` runs today
- audit is independent from `security:validate`
- audit findings are heuristic candidates and do not auto-fix anything
- active-branch source-facts evidence is conservative static-analysis evidence, not proof of dead code, semantic duplicate implementation, complete test coverage, full module resolution, or runtime reachability

## Workflow 7: Implementation completion

Every implementation version ends with these stages before pre-release readiness:

1. implementation-completeness review
2. documentation source-of-truth reconciliation
3. validation commands
4. pre-release readiness review

Documentation reconciliation is a required workflow stage. It is not its own semantic version.

## Workflow 8: Documentation reconciliation

Use this workflow after implementation work and before pre-release readiness.

Required actions:

1. reconcile README, roadmap, architecture, workflows, commands, and current-state docs with the checked-in implementation
2. confirm current versus planned behavior is clearly separated
3. remove stale roadmap assignments or relabel them as future/historical as appropriate
4. run the required validation commands for the repository

This workflow does not create a separate product version.

## Workflow 9: Pre-release readiness

Use this workflow after implementation completion and documentation reconciliation.

Typical commands:

```bash
npm run typecheck
npm run build
npm run test
npm run verify
```

If a release-specific validation workflow exists for the implemented feature set, run it here as well.

## Workflow 10: Release preparation and publication

These are separate from implementation and documentation reconciliation.

Release preparation includes:

- changelog verification
- package/release hygiene checks
- final readiness review

Publication includes:

- publish/tag/release steps when explicitly authorized

Do not collapse these stages into implementation work.

## Future workflow: Android validation

This workflow is planned for `v0.4.x`. It is not implemented today.

Planned direction:

```bash
npm run security:validate -- --target /path/to/android/project --profile android
npm run security:validate -- --target /path/to/android/project --profile android-compose
```

Planned behavior:

- validate existing Android projects
- preserve non-destructive target handling
- include report/schema stability inside each Android implementation version

## Future workflow: Android audit bridge

This workflow is planned as the optional `v0.4.2` feature. It is not implemented today.

Planned direction:

```bash
npm run audit -- --target /path/to/android/project --types security --profile android
```

This bridge will summarize Android validation findings without replacing `security:validate`.

## Future workflow: Manual pentest

Manual pentest is deferred until after `v1.0.0`.

It is a human-led workflow and is not required for automated Android security validation.
