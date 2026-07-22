# my-dev-kit-lab

my-dev-kit-lab is the experiment, audit, and evidence companion for [my-dev-kit](https://www.npmjs.com/package/@dailephd/my-dev-kit). It helps users compare repository-context strategies, audit project health, validate CLI/package and Android security boundaries, and turn each run into reviewable reports and visual artifacts.

my-dev-kit provides local repository indexing and graph-guided retrieval. my-dev-kit-lab supplies the controlled benchmarks, agent adapters, metrics, security checks, and reports needed to evaluate when that retrieval is useful. Results are evidence for a specific target and configuration; they do not guarantee token savings or security.

The latest published release is v0.4.3 (stage-specific bounded-context and workflow-instruction evaluation). See [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md).

## Current capabilities

- **Run context-strategy experiments:** compare `raw-full-file` with `my-dev-kit-guided` using deterministic fixtures or locally configured Codex and Claude CLIs.
- **Audit repository health:** run conservative code-rot detectors for TypeScript/JavaScript, Python, Java, and Kotlin, or adapt security findings into the common audit report.
- **Validate CLI/package security:** inspect dependencies, package contents, path and subprocess boundaries, malformed inputs, optional static scanners, and bounded fuzz targets.
- **Validate Android projects:** run nineteen static checks by default, with Gradle operations, external tools, and network access available only through explicit opt-in flags.
- **Review evidence:** generate JSON and HTML reports, SVG plots, optional screenshots, visualization demos, and a static gallery.
- **Evaluate stage-context strategies:** compare the two legacy strategies against six additional bounded stage-context strategies — `architecture-context-only`, `architecture-plus-implementation-refresh`, `architecture-plus-implementation-and-test-refresh`, `full-workflow-library`, `bounded-workflow-instruction-packet`, and `combined-bounded-stage-context` — selected through programmatic configuration, not CLI flags. Each strategy's evidence is reported through bounded `report.json`, `report.html`, and `report.txt` output with an explicit `available`/`unavailable`/`not-applicable` metric-availability model and no composite score, grade, ranking, or winning strategy.

## Quickstart

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
npm run verify
```

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

---

## Security validation

`npm run security:validate` is the standalone security-validation command. It checks local CLI/package boundaries and can inspect another local project with `--target <path>`. The generic audit command can reuse those results through `--types security`, but it does not replace the standalone validator or its reports.

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
