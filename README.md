# my-dev-kit-lab

my-dev-kit-lab is the experiment, audit, and evidence companion for [my-dev-kit](https://www.npmjs.com/package/@dailephd/my-dev-kit). It helps users compare repository-context strategies, audit project health, validate CLI/package and Android security boundaries, and turn each run into reviewable reports and visual artifacts.

my-dev-kit provides local repository indexing and graph-guided retrieval. my-dev-kit-lab supplies the controlled benchmarks, agent adapters, metrics, security checks, and reports needed to evaluate when that retrieval is useful. Results are evidence for a specific target and configuration; they do not guarantee token savings or security.

The latest published release is v0.4.5 (context-integrity validation), compatible with published `@dailephd/my-dev-kit@1.10.4` and `@dailephd/my-dev-kit-orchestrator@1.2.3`. See [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md).

### v0.4.6 status: implementation complete, not yet published

The v0.4.6 installed-package architecture correction is implemented on this repository's development branch but has not been published to npm — v0.4.5 remains the latest published package. v0.4.6 adds a supported `my-dev-kit-lab` installed CLI router (`--help`, `--version`, `security validate`, `audit`, the `experiment` family, `report render`, `plots generate`, `gallery build`, `demo final`, and the historical direct final-demo invocation form), a writable lab workspace model kept separate from the installed package and the inspected target, and a permanent packed-tarball installation/execution acceptance gate (`npm run verify:packed-package`). See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) for status detail and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the runtime path model. The "Installed CLI" section below documents the command surface that becomes available once v0.4.6 is published; until then, use the source-checkout `npm run` workflow in Quickstart.

## Current capabilities

- **Run context-strategy experiments:** compare `raw-full-file` with `my-dev-kit-guided` using deterministic fixtures or locally configured Codex and Claude CLIs.
- **Audit repository health:** run conservative code-rot detectors for TypeScript/JavaScript, Python, Java, and Kotlin, or adapt security findings into the common audit report.
- **Validate CLI/package security:** inspect dependencies, package contents, path and subprocess boundaries, malformed inputs, optional static scanners, and bounded fuzz targets.
- **Validate Android projects:** run nineteen static checks by default, with Gradle operations, external tools, and network access available only through explicit opt-in flags.
- **Review evidence:** generate JSON and HTML reports, SVG plots, optional screenshots, visualization demos, and a static gallery.
- **Evaluate stage-context strategies:** compare the two legacy strategies against six additional bounded stage-context strategies — `architecture-context-only`, `architecture-plus-implementation-refresh`, `architecture-plus-implementation-and-test-refresh`, `full-workflow-library`, `bounded-workflow-instruction-packet`, and `combined-bounded-stage-context` — selected through programmatic configuration, not CLI flags. Each strategy's evidence is reported through bounded `report.json`, `report.html`, and `report.txt` output with an explicit `available`/`unavailable`/`not-applicable` metric-availability model and no composite score, grade, ranking, or winning strategy.
- **Evaluate the producer-readiness bridge (v0.4.4):** optionally extend `combined-bounded-stage-context` with the frozen my-dev-kit-orchestrator supplemental implementation/test-context packet and retrieval-report documents plus an observed readiness result, all supplied programmatically (there is no CLI flag), to measure owner, allocation, truncation-cause, supplemental/raw agreement, readiness-agreement, and criticality-overlay evidence without reimplementing upstream owner-selection, allocation, producer-parity, or readiness policy.
- **Evaluate context integrity (v0.4.5):** compare condition-aware producer evidence from my-dev-kit v1.10.4 (role condition coverage, allocation/spillover, required-evidence-loss) against my-dev-kit-orchestrator v1.2.3 run-integrity evidence (run-integrity gate, judge integrity, final-report eligibility, artifact lifecycle state), reporting agreement or contradiction between them rather than re-deriving a verdict. Evaluation runs against a frozen, hash-verified regression fixture pair — a byte-exact real historical failed run and a hand-distilled corrected-replay counterpart representing the same validated contracts — and is programmatic/test-driven only. `npm run report:context-integrity-smoke` renders both fixtures' reports for manual inspection; it takes no arguments and is a developer convenience, not a configurable evaluation CLI.

## Installed CLI (v0.4.6, not yet published)

Once v0.4.6 is published, installing or invoking the package (for example via `npm install -g @dailephd/my-dev-kit-lab` or `npx @dailephd/my-dev-kit-lab@<version>`) exposes one `my-dev-kit-lab` binary. Users will not need to clone this repository to use these commands.

```
my-dev-kit-lab --help
my-dev-kit-lab --version

my-dev-kit-lab security validate [options]
my-dev-kit-lab audit [options]

my-dev-kit-lab experiment list
my-dev-kit-lab experiment describe --experiment <id>
my-dev-kit-lab experiment run --experiment <id> [options]
my-dev-kit-lab experiment controlled [options]

my-dev-kit-lab report render [options]
my-dev-kit-lab plots generate [options]
my-dev-kit-lab gallery build [options]
my-dev-kit-lab demo final [options]
```

A global `--workspace <path>` option, placed before the command, selects the writable lab workspace. The default workspace, used when `--workspace` is omitted, is `<home>/.my-dev-kit-lab`. Generated reports and experiment output are written under the workspace by default, never under the installed package directory or an inspected `--target` project. Explicit output paths (`--out`, and similar flags) keep their existing resolution behavior and are never redirected under the workspace.

The historical direct final-demo invocation form — the same flags `demo final` accepts, without the `demo final` prefix — continues to work for backward compatibility.

Low-level developer helpers (`security:deps`, `security:package`, `security:codeql`, `security:semgrep`, fuzz smoke, visualization demos, build/test/verify) are not part of the installed CLI. They remain source-checkout contributor workflows; see below.

See [docs/COMMANDS.md](docs/COMMANDS.md) for full command syntax and flags.

## Quickstart (contributor / source-checkout workflow)

The commands in this section run from a cloned repository checkout and are the contributor/development workflow. They are not required to use the v0.4.6 installed CLI once it is published.

### Install

```bash
npm install
```

The same command works in PowerShell and `cmd.exe`.

### Build

```bash
npm run build
```

### Verify the installation

```bash
npm run test
npm run verify
```

`npm test` runs the complete test suite; `npm run verify` runs the remaining non-test verification gates. Running both is complete validation and does not execute the suite twice.

### Run the fake-agent final demo (deterministic, no external CLIs required)

```bash
npm run run-final-demo -- \
  --cases examples/token-savings-cases.json \
  --out lab-output/final-demo \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --agents fake-agent \
  --complexities short \
  --no-screenshot
```

```powershell
npm run run-final-demo -- `
  --cases examples/token-savings-cases.json `
  --out lab-output/final-demo `
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" `
  --agents fake-agent `
  --complexities short `
  --no-screenshot
```

```bat
npm run run-final-demo -- --cases examples/token-savings-cases.json --out lab-output/final-demo --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --agents fake-agent --complexities short --no-screenshot
```

The lab resolves Windows `.cmd` and `.ps1` CLI shims, supports command paths with spaces, and keeps generated artifacts inside the requested output directory.

This runs a full pipeline: controlled experiment → report → plots → visualization demos → gallery.

### Run a real-agent campaign (requires Codex or Claude CLI)

```bash
npm run run-controlled-experiment -- \
  --cases examples/real-agent-campaign-cases.json \
  --agents codex,claude \
  --strategies raw-full-file,my-dev-kit-guided \
  --complexities medium,multi-step \
  --out lab-output/real-agent-campaign \
  --include-real-agents \
  --continue-on-failure \
  --timeout-ms 240000
```

Real-agent runs require local Codex or Claude CLI setup and available usage capacity. Runs that time out, produce invalid output, or hit session limits are recorded as structured outcomes rather than failures.

### List, describe, and run experiment plugins

```bash
npm run experiment:list
npm run experiment:describe -- --experiment context-strategy-comparison
npm run experiment:run -- \
  --experiment context-strategy-comparison \
  --target /path/to/local/project \
  --agents fake-agent \
  --complexities short \
  --no-screenshot
```

```powershell
npm run experiment:list
npm run experiment:describe -- --experiment context-strategy-comparison
npm run experiment:run -- `
  --experiment context-strategy-comparison `
  --target "Z:\Users\newuser\Projects\my-dev-kit-v1" `
  --agents fake-agent `
  --complexities short `
  --no-screenshot
```

When `--target` is omitted, the experiment runs in self mode against my-dev-kit-lab. When `--target <path>` is provided, the lab remains the tool root and the target project is inspected separately. Generated experiment outputs stay under lab-controlled output directories by default, not inside the target project.

---

## Where to find outputs

| Artifact | Location |
|---|---|
| Experiment summary | `lab-output/<experiment>/experiment-summary.json` |
| All runs | `lab-output/<experiment>/experiment-runs.json` |
| Strategy comparisons | `lab-output/<experiment>/experiment-comparisons.json` |
| HTML report | `lab-output/<report>/experiment-report.html` |
| Report JSON | `lab-output/<report>/experiment-report.json` |
| Report screenshot | `lab-output/<report>/experiment-report.png` |
| Plugin experiment report JSON | `lab-output/experiments/<plugin>/<target>/<run>/report.json` |
| Plugin experiment report HTML | `lab-output/experiments/<plugin>/<target>/<run>/report.html` |
| Plugin experiment report text | `lab-output/experiments/<plugin>/<target>/<run>/report.txt` |
| Plot data | `lab-output/<plots>/plot-data.json` |
| SVG charts | `lab-output/<plots>/charts/*.svg` |
| Gallery manifest | `lab-output/<gallery>/gallery-manifest.json` |
| Gallery index | `lab-output/<gallery>/gallery-index.html` |
| Audit reports | `reports/audits/<type>/code-rot-audit.txt` and `.json` |
| Security reports | `reports/security/<prefix>-security-validation.txt` and `.json` |

---

## How to read the main report

Open `experiment-report.html` in a browser. The report shows:

- **Project profile** — benchmark project name, language mix, complexity score, and file tree
- **Benchmark tasks** — task descriptions and answer keys
- **Strategy comparisons** — paired `raw-full-file` vs `my-dev-kit-guided` runs per case
- **Correctness scores** — deterministic answer-key scoring (not semantic LLM judging)
- **Token usage** — estimated or reported token totals per run
- **Token savings** — positive means my-dev-kit used fewer tokens; negative means it used more
- **Duration** — wall-clock time per run
- **Status** — completed, timeout, invalid-output, or limit-reached
- **Warnings and limitations** — notes on missing token totals or partial results

See [docs/METRICS.md](docs/METRICS.md) for full metric definitions.

---

## Current limitations

- Token savings shown in fake-agent runs are based on estimated character counts, not provider billing telemetry
- Claude does not expose token totals; token savings comparisons are unavailable for Claude runs
- Codex may expose token totals but can produce timeouts or invalid-output runs
- Small projects may make raw-full-file cheaper than my-dev-kit-guided; larger localized tasks are where my-dev-kit is expected to become more useful
- The generic experiment-plugin framework currently ships one plugin, `context-strategy-comparison`; future plugins such as warm-index reuse, incremental-change, and context-window scaling are not implemented yet
- The current release does not guarantee token savings; it produces auditable evidence for specific cases, targets, agents, and strategies
- Provider telemetry dashboards, semantic LLM judging, and cloud API billing integration are not yet implemented
- The six new stage-context strategies have no CLI flags yet, are configured programmatically, and do not yet include plots, screenshots, or gallery integration
- The published upstream artifacts the stage-context strategies read do not expose considered-but-unselected reads or unnecessary-read evidence; those metrics report `unavailable` rather than zero
- The v0.4.4 producer-readiness bridge is released. All bridge inputs are programmatic — there is no CLI flag. The coordinated upstream releases my-dev-kit@1.10.3 and orchestrator@1.2.2 were verified published before lab publication.
- The v0.4.5 context-integrity evaluation is released. It has no CLI flags, no plots/screenshot/gallery integration, and produces no composite score, grade, ranking, or winner. Its corrected-replay fixture is a hand-distilled representation of the validated my-dev-kit v1.10.4 and my-dev-kit-orchestrator v1.2.3 contracts, not a live capture of a complete ten-stage workflow. The orchestrator agreement evidence does not read a literal upstream `promptMode` field; `stageMayRenderNormalPrompt`, derived from structured blocked-stage evidence, is the bounded substitute used instead.

---

## Security validation

`npm run security:validate` (contributor/source-checkout) and, once v0.4.6 is published, `my-dev-kit-lab security validate` (installed CLI) both call the same standalone security-validation command owner. It checks local CLI/package boundaries and can inspect another local project with `--target <path>`. The generic audit command can reuse those results through `--types security`, but it does not replace the standalone validator or its reports.

Android validation uses `--profile android`. Its default path is static and non-destructive: it starts zero Gradle processes, zero external tools, and zero network operations. Only confirmed `SecurityFinding` records can become audit issues; Android `CandidateEvidence` remains review-only evidence.

Optional scanners are reported as `skipped` when unavailable, never as passed. The framework does not provide runtime isolation proof, device or APK/AAB analysis, signing verification, Play Console validation, automatic fixes, or manual pentesting. Manual pentest remains deferred until post-v1/version TBD.

See [COMMANDS.md](docs/COMMANDS.md) for exact syntax and [Security Validation Framework](docs/security-validation-framework.md) for checks, evidence semantics, verdicts, and limitations.

---

## License

MIT License. See [LICENSE](LICENSE) for the full text.

---

## Support

my-dev-kit-lab is an independent project by dailephd LLC, developed and maintained by Dai Le.

If this project helps your workflow, you can support continued development through GitHub Sponsors or PayPal:

- [Sponsor on GitHub](https://github.com/sponsors/dailephd)
- [Support via PayPal](https://paypal.me/daile88)

Support is optional and does not affect access to the project.

---

## Documentation

- [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) — product purpose and target users
- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) — implemented, planned, validated, blocked, and next state
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current components, ownership, flows, and invariants
- [docs/WORKFLOWS.md](docs/WORKFLOWS.md) — step-by-step workflows with diagrams
- [docs/COMMANDS.md](docs/COMMANDS.md) — all commands with options and examples
- [docs/TUTORIAL.md](docs/TUTORIAL.md) — first-run walkthrough
- [docs/METRICS.md](docs/METRICS.md) — metric definitions and interpretation
- [docs/ROADMAP.md](docs/ROADMAP.md) — versioned plans, dependencies, exclusions, and acceptance criteria
- [docs/GALLERY.md](docs/GALLERY.md) — gallery output explained
- [docs/security-validation-framework.md](docs/security-validation-framework.md) — security evidence, verdicts, and safety boundaries
