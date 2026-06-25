# Commands

This document describes all available commands in my-dev-kit-lab, their options, expected outputs, and when to use each one.

See [docs/WORKFLOWS.md](docs/WORKFLOWS.md) for end-to-end workflow examples that combine multiple commands.

---

## Installation and build

### `npm install` / `npm ci`

Installs all dependencies. Use `npm ci` in CI environments for a clean, reproducible install.

```bash
npm install
```

```powershell
npm install
```

### `npm run build`

Compiles TypeScript sources to `dist/`. Run this before executing any lab commands.

```bash
npm run build
```

---

## Validation commands

### `npm run test`

Runs the full test suite. Use this to verify that all modules are working correctly.

```bash
npm run test
```

### `npm run test:benchmarks`

Runs benchmark-specific tests: project structure, contract shape, profile validation, answer keys, and complexity metrics.

```bash
npm run test:benchmarks
```

### `npm run test:report`

Runs report rendering tests.

```bash
npm run test:report
```

### `npm run test:experiments`

Runs controlled experiment runner tests.

```bash
npm run test:experiments
```

### `npm run test:plots`

Runs plot generation tests.

```bash
npm run test:plots
```

### `npm run test:gallery`

Runs gallery manifest and index tests.

```bash
npm run test:gallery
```

### `npm run test:integration`

Runs integration tests that exercise multiple modules together.

```bash
npm run test:integration
```

### `npm run verify`

Runs the full verification suite: build, tests, and benchmark checks. Use this as a final check before committing.

```bash
npm run verify
```

---

## Lab commands

### `npm run experiment:list`

Lists registered experiment plugins. The v0.2.0 command surface includes `context-strategy-comparison`, the first plugin built from the existing raw-full-file vs my-dev-kit-guided workflow.

**When to use:** To discover available local experiment plugins before describing or running one.

**Options:**
- `--json` — print structured JSON instead of readable console output

**Examples:**
```bash
npm run experiment:list
npm run --silent experiment:list -- --json
```

**Output includes:**
- plugin id
- plugin name and description
- status
- supported variants
- supported output types

---

### `npm run experiment:describe`

Prints metadata and usage details for a registered experiment plugin.

**When to use:** Before running an experiment, to inspect its purpose, supported variants, config fields, target behavior, reports, and examples.

**Options:**
- `--experiment` — plugin id, for example `context-strategy-comparison`
- `--json` — print structured JSON

**Examples:**
```bash
npm run experiment:describe -- --experiment context-strategy-comparison
npm run --silent experiment:describe -- --experiment context-strategy-comparison --json
```

Unknown plugin ids fail cleanly with a nonzero exit code and no stack trace unless `DEBUG` is set.

---

### `npm run experiment:run`

Runs an experiment plugin through the generic target-aware runner and writes plugin-aware reports.

The first plugin is `context-strategy-comparison`. It preserves the existing raw-full-file vs my-dev-kit-guided controlled experiment behavior while adding plugin metadata, target metadata, and normalized report outputs.

**When to use:** To run a plugin against my-dev-kit-lab itself or against an explicit local target project.

**Options:**
- `--experiment` — plugin id, for example `context-strategy-comparison`
- `--target` — optional local target project path; omitted means self mode
- `--out` — optional output directory; defaults to `lab-output/experiments/<plugin>/<target>/<run>`
- `--cases` — benchmark case JSON, default `examples/token-savings-cases.json`
- `--project-profiles` — benchmark project profile JSON
- `--case` — one or more comma-separated case ids
- `--benchmark-project` — one or more comma-separated benchmark project ids
- `--agents` — comma-separated agents: `fake-agent`, `codex`, `claude`
- `--strategies` — comma-separated variants: `raw-full-file`, `my-dev-kit-guided`
- `--complexities` — comma-separated complexity levels: `short`, `medium`, `long`, `multi-step`
- `--timeout-ms` — per-run timeout in milliseconds
- `--max-runs` — maximum run count
- `--continue-on-failure` / `--no-continue-on-failure` — partial outcome behavior
- `--include-real-agents` — allow Codex or Claude runs
- `--command-template-codex` / `--command-template-claude` — override real-agent command templates
- `--no-screenshot` — accepted for compatibility with demo smoke commands; plugin-aware reports do not capture screenshots yet

**Examples:**
```bash
# Self-target fake-agent smoke
npm run experiment:run -- \
  --experiment context-strategy-comparison \
  --agents fake-agent \
  --complexities short \
  --no-screenshot

# External local target
npm run experiment:run -- \
  --experiment context-strategy-comparison \
  --target /path/to/local/project \
  --case todo-ts-create-task \
  --agents fake-agent \
  --complexities short \
  --no-screenshot
```

```powershell
npm run experiment:run -- `
  --experiment context-strategy-comparison `
  --target "Z:\Users\newuser\Projects\my-dev-kit-v1" `
  --case todo-ts-create-task `
  --agents fake-agent `
  --complexities short `
  --no-screenshot
```

**Outputs:**
- legacy controlled-experiment artifacts: `experiment-summary.json`, `experiment-runs.json`, `experiment-comparisons.json`, `experiment-config.json`
- plugin result metadata: `experiment-plugin-result.json`
- plugin-aware reports: `report.json`, `report.html`

Reports include plugin, target, variant, case, metric, artifact, warning, skip, and failure metadata. Target projects are not modified; generated artifacts stay under lab-owned output paths unless an explicit lab output path is provided.

---

### `npm run generate-prompt-variants`

Generates raw-full-file and my-dev-kit-guided prompt variants for each benchmark case at the specified complexity levels. Writes prompt text files and prompt complexity metrics.

**When to use:** Before running an experiment, to preview the prompts that will be sent to agents.

**Options:**
- `--cases` — path to the benchmark case list JSON
- `--out` — output directory for generated prompt variant files

**Example:**
```bash
npm run generate-prompt-variants -- \
  --cases examples/token-savings-cases.json \
  --out lab-output/prompt-variants
```

**Outputs:**
- `lab-output/prompt-variants/<case>/<strategy>/<complexity>.txt`
- `lab-output/prompt-variants/prompt-variants-summary.json`

---

### `npm run run-agent-prompt`

Runs a single prompt against a single agent for a single benchmark case. Writes a prompt preview and an `agent-run-result.json`. Does not compare strategies, score correctness, or update the gallery.

**When to use:** To smoke-test a single agent run or preview what an agent returns for a specific case and strategy.

**Options:**
- `--agent` — agent name: `fake-agent`, `codex`, or `claude`
- `--cases` — path to the benchmark case list JSON
- `--case` — specific case ID to run
- `--strategy` — `raw-full-file` or `my-dev-kit-guided`
- `--complexity` — `short`, `medium`, `long`, or `multi-step`
- `--out` — output directory
- `--require-agent` — fail if the agent CLI is unavailable (default: skip)

**Examples:**
```bash
# Deterministic fake-agent run
npm run run-agent-prompt -- \
  --agent fake-agent \
  --cases examples/token-savings-cases.json \
  --case todo-ts-create-task \
  --strategy raw-full-file \
  --complexity short \
  --out lab-output/agent-run-fake

# Real Codex run (requires local Codex CLI)
npm run run-agent-prompt -- \
  --agent codex \
  --cases examples/token-savings-cases.json \
  --case todo-ts-create-task \
  --strategy my-dev-kit-guided \
  --complexity short \
  --out lab-output/agent-run-codex
```

**Outputs:**
- `lab-output/agent-run-fake/agent-run-result.json`

---

### `npm run run-controlled-experiment`

Runs a controlled experiment comparing `raw-full-file` and `my-dev-kit-guided` strategies across the specified cases, agents, and complexity levels. Pairs runs by case, agent, and complexity, scores correctness from answer keys, and computes token and duration comparisons.

**When to use:** To run a full comparison experiment and produce structured JSON artifacts for reporting.

**Options:**
- `--cases` — path to the benchmark case list JSON
- `--agents` — comma-separated agent names: `fake-agent`, `codex`, `claude`
- `--strategies` — comma-separated strategies: `raw-full-file`, `my-dev-kit-guided`
- `--complexities` — comma-separated complexity levels: `short`, `medium`, `long`, `multi-step`
- `--out` — output directory
- `--include-real-agents` — include Codex and Claude runs (skipped by default)
- `--continue-on-failure` — continue after individual run failures
- `--timeout-ms` — per-run timeout in milliseconds
- `--max-runs` — maximum number of runs to execute

**Examples:**
```bash
# Fake-agent experiment
npm run run-controlled-experiment -- \
  --cases examples/token-savings-cases.json \
  --agents fake-agent \
  --strategies raw-full-file,my-dev-kit-guided \
  --complexities short \
  --out lab-output/controlled-experiment-fake

# Real-agent campaign
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

**Outputs:**
- `lab-output/<out>/experiment-summary.json`
- `lab-output/<out>/experiment-runs.json`
- `lab-output/<out>/experiment-comparisons.json`
- `lab-output/<out>/experiment-config.json`
- `lab-output/<out>/runs/<runId>/` — per-run artifacts

---

### `npm run render-experiment-report`

Renders experiment artifacts into an HTML report with JSON metadata. Optionally captures a PNG screenshot.

**When to use:** After running a controlled experiment, to produce a human-readable report.

**Options:**
- `--experiment` — path to the experiment output directory
- `--out` — output directory for report artifacts
- `--screenshot` / `--no-screenshot` — whether to capture a PNG (default: no screenshot)
- `--plots` — optional path to a plots directory to link in the report
- `--visualizations` — optional path to a visualization demos directory to link in the report

**Examples:**
```bash
# Render without screenshot
npm run render-experiment-report -- \
  --experiment lab-output/controlled-experiment-fake \
  --out lab-output/experiment-report-fake \
  --no-screenshot

# Render with screenshot
npm run render-experiment-report -- \
  --experiment lab-output/controlled-experiment-fake \
  --out lab-output/experiment-report-fake-shot \
  --screenshot
```

**Outputs:**
- `lab-output/<out>/experiment-report.json`
- `lab-output/<out>/experiment-report.html`
- `lab-output/<out>/experiment-report-artifacts.json`
- `lab-output/<out>/experiment-report.png` — when `--screenshot` succeeds

---

### `npm run generate-experiment-plots`

Generates plot data and static SVG charts from experiment artifacts.

**When to use:** After running a controlled experiment, to produce visual summaries of the results.

**Options:**
- `--experiment` — path to the experiment output directory
- `--out` — output directory for plot artifacts

**Example:**
```bash
npm run generate-experiment-plots -- \
  --experiment lab-output/controlled-experiment-fake \
  --out lab-output/experiment-plots
```

**Outputs:**
- `lab-output/experiment-plots/plot-data.json`
- `lab-output/experiment-plots/plots-summary.json`
- `lab-output/experiment-plots/charts/*.svg`

---

### `npm run run-visualization-demos`

Runs bounded my-dev-kit visualization command demos against a benchmark project and writes demo artifacts.

**When to use:** To demonstrate my-dev-kit retrieval commands on a benchmark project and include the results in a gallery.

**Options:**
- `--project` — path to the benchmark project directory
- `--kit-command` — my-dev-kit CLI command string
- `--out` — output directory for demo artifacts

**Example:**
```bash
npm run run-visualization-demos -- \
  --project benchmarks/projects/todo-ts \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --out lab-output/visualization-demos
```

---

### `npm run build-gallery`

Collects report, plot, visualization demo, and screenshot artifacts into a gallery manifest and a static gallery index.

**When to use:** After generating a report, plots, and visualization demos, to publish a browsable gallery.

**Options:**
- `--report` — path to the report output directory
- `--plots` — path to the plots output directory
- `--visualizations` — path to the visualization demos output directory
- `--out` — output directory for gallery artifacts

**Example:**
```bash
npm run build-gallery -- \
  --report lab-output/experiment-report-fake \
  --plots lab-output/experiment-plots \
  --visualizations lab-output/visualization-demos \
  --out lab-output/gallery
```

**Outputs:**
- `lab-output/gallery/gallery-manifest.json`
- `lab-output/gallery/gallery-index.html`

---

### `npm run run-final-demo`

Runs the complete pipeline in one command: controlled experiment → report → plots → visualization demos → gallery. Use this for a full end-to-end demo.

**When to use:** To run the entire pipeline in one step, typically with fake-agent for a deterministic demo.

**Options:**
- `--cases` — path to the benchmark case list JSON
- `--out` — output directory for all artifacts
- `--kit-command` — my-dev-kit CLI command string
- `--agents` — comma-separated agent names
- `--complexities` — comma-separated complexity levels
- `--screenshot` / `--no-screenshot` — whether to capture a PNG

**Example:**
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

- `--kit-command` should be passed as one command string such as `node tests/fixtures/fake-my-dev-kit-cli.js`.
- Paths with spaces are supported on Windows, macOS, and Linux.
- `cmd.exe` users should run the same arguments on one line instead of using line continuations.

---

### `npm run evaluate-token-savings`

Runs the earlier token-savings evaluation workflow: measures raw full-file baseline context, runs my-dev-kit retrieval, and compares estimated token counts. This is a simpler predecessor to the controlled experiment workflow.

**When to use:** For a quick estimated token comparison without full experiment infrastructure.

**Options:**
- `--cases` — path to the evaluation case list JSON
- `--kit-command` — my-dev-kit CLI command string
- `--out` — output directory
- `--require-kit` — fail if my-dev-kit is unavailable
- `--no-screenshot` — skip PNG capture

**Example:**
```bash
npm run evaluate-token-savings -- \
  --cases examples/token-savings-cases.json \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --out lab-output/token-savings
```

**Note:** Token counts in this workflow are estimated using `Math.ceil(characterCount / 4)`. This is a static context-size comparison, not provider billing telemetry.

---

### `npm run lab-demo`

Runs the earlier quick demo workflow: token-savings evaluation → report → screenshot → gallery manifest.

**When to use:** For a quick demo of the token-savings evaluation pipeline.

**Example:**
```bash
npm run lab-demo -- \
  --cases examples/lab-demo-cases.json \
  --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" \
  --out lab-output/demo-gallery
```

---

### `npm run capture-demo-report`

Renders a demo report from a JSON input file and optionally captures a PNG screenshot.

**When to use:** To render a standalone demo report from a custom JSON input.

**Options:**
- `--input` — path to a lab report JSON input file
- `--out` — output directory
- `--no-screenshot` — skip PNG capture

**Example:**
```bash
npm run capture-demo-report -- \
  --input examples/demo-report-input.json \
  --out lab-output/demo-report
```

**Outputs:**
- `lab-output/demo-report/demo-report.json`
- `lab-output/demo-report/demo-report.html`
- `lab-output/demo-report/demo-report.png` — when screenshot capture succeeds

---

## Screenshot capture notes

Screenshot capture uses Playwright and requires a browser runtime. When Playwright or the browser runtime is unavailable, JSON and HTML artifacts are still written and the command succeeds with a warning. Pass `--no-screenshot` to skip capture explicitly.

---

## Security validation commands

These commands implement the planned release-security validation track for **my-dev-kit**. They do not replace the experiment pipeline and do not require internet access for their core logic (though `npm audit` and `npm ls` do contact the npm registry).

### `npm run security:deps`

Runs dependency audit checks and writes structured results to `reports/security/`.

Checks performed:
- `npm audit --json` — full audit including devDependencies
- `npm audit --omit=dev --json` — runtime dependencies only
- `npm outdated --json` — outdated package detection (informational)
- `npm ls --all --json` — dependency tree resolution
- OSV-Scanner — if installed; skipped with a clear reason if not available

**Options:**
- `--target <path>` - audit a different project directory instead of the current one

**Target behavior:** Reads package metadata and dependency state from the target project without modifying target files. Generated artifacts stay under this tool's `reports/security/` directory.

**When to use:** Before release preparation to check for known dependency vulnerabilities.

**Outputs:**
- `reports/security/dependency-checks.json` — combined summary
- `reports/security/npm-audit-full.json`
- `reports/security/npm-audit-runtime.json`
- `reports/security/npm-outdated.json`
- `reports/security/npm-ls.json`
- `reports/security/osv-scanner.json`
- `reports/security/raw/` — raw stdout/stderr captured from each command

**Exit code:** Non-zero when any blocker-severity finding is detected. Zero when only informational, minor, or skipped checks exist.

```bash
npm run security:deps
```

```powershell
npm run security:deps
```

```powershell
npm run security:deps -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"
```

---

### `npm run security:package`

Runs `npm pack --dry-run` and inspects the tarball file list for forbidden contents. Does not publish anything.

Checks performed:
- Detects lab-output/, .my-dev-kit/, .env files, private planning docs, node_modules/, tarballs, and other unsafe inclusions

**Options:**
- `--target <path>` - inspect a different project's tarball instead of the current one

**Target behavior:** Runs `npm pack --dry-run` in the target project without publishing or modifying target files. Generated artifacts stay under this tool's `reports/security/` directory.

**When to use:** Before release preparation to verify the npm tarball does not include generated artifacts, secrets, or internal files.

**Outputs:**
- `reports/security/package-checks.json` — combined summary
- `reports/security/npm-pack-dry-run.json`
- `reports/security/raw/` — raw stdout/stderr from npm pack

**Exit code:** Non-zero when any blocker or major finding is detected.

```bash
npm run security:package
```

```powershell
npm run security:package
```

```powershell
npm run security:package -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"
```

---

### `npm run test:security`

Runs all security-validation unit tests without network access or external tools.

**When to use:** As part of regular development to verify the security types, test matrix, parser logic, CLI adversarial boundary checks, static scan parsers, and the validate gate are correct.

Tests included (v0.1.4):
- `securityValidationTypes.test.ts` — type and enumeration completeness
- `securityValidationTestMatrix.test.ts` — test matrix structure and uniqueness
- `dependencyChecks.test.ts` — dependency parser unit tests
- `packageContentChecks.test.ts` — forbidden-content detection unit tests
- `cliAdversarialPathBoundary.test.ts` — path traversal, safe paths, escape detection
- `cliAdversarialReadOnlyBoundary.test.ts` — source not modified, write containment, cleanup safety
- `cliAdversarialMalformedArtifacts.test.ts` — malformed JSON artifacts, unsupported schema versions
- `cliAdversarialJsonStdout.test.ts` — JSON stdout/stderr safety
- `cliAdversarialSubprocessSafety.test.ts` — DOT label escaping, shell metacharacter injection
- `cliAdversarialDataVolume.test.ts` — huge source file, many files, deep nesting
- `staticScanChecks.test.ts` — CodeQL/Semgrep skip gracefully when unavailable; Semgrep JSON parser
- `securityValidateGate.test.ts` — verdict calculation, report rendering (text and JSON)
- `cliSecuritySuiteCheck.test.ts` — external target `test:security` cwd, pass/fail behavior, and path-with-spaces coverage

By default, adversarial tests run against a deterministic fake CLI fixture — no my-dev-kit installation required. To run against a real CLI, set `MY_DEV_KIT_SECURITY_TARGET_COMMAND=<path>` before running.

```bash
npm run test:security
```

```powershell
$env:MY_DEV_KIT_SECURITY_TARGET_COMMAND = "node path/to/my-dev-kit/dist/cli.js"
npm run test:security
```

---

### `npm run security:codeql`

Checks if the CodeQL CLI is available locally and verifies it is functional.

**When CodeQL is present:** Runs `codeql version --format terse` to confirm the CLI works. Full database creation and analysis is delegated to the GitHub Actions code-scanning workflow.

**When CodeQL is absent:** Returns a structured `skipped` result with a clear reason. CodeQL absence does not fail `security:validate`.

**Note:** This is an optional check. The GitHub Actions workflow at `.github/workflows/codeql.yml` runs the full CodeQL analysis on push. Local validation is a best-effort availability check only.

**Options:**
- `--target <path>` - resolve and label a different validation target while keeping the local CLI availability check anchored to the tool root

**Target behavior:** External-target mode does not modify target files. It preserves target-aware context for the validation workflow while the local CodeQL check remains an availability/functionality probe.

```bash
npm run security:codeql
```

```powershell
npm run security:codeql
```

```powershell
npm run security:codeql -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"
```

---

### `npm run security:semgrep`

Runs Semgrep static analysis using the project's `.semgrep.yml` configuration.

**When Semgrep is available (local or npx):** Runs rules covering subprocess safety, path traversal, unsafe `fs.rm`, secret leakage, and similar patterns. Returns structured findings.

**When Semgrep is unavailable:** Returns a structured `skipped` result with a clear reason. Semgrep absence does not fail `security:validate`.

**Options:**
- `--target <path>` - scan a different project's source files; scans `<target>/src/` if present, else `<target>/` directly

**Target behavior:** Semgrep reads the target project in place and does not modify target files. Rules come from the tool root's `.semgrep.yml`; generated artifacts stay under `reports/security/`.

Semgrep rules focus on:
- `spawn/exec` with `shell: true`
- `exec()` with string interpolation
- `path.join()` with user-controlled input
- Recursive `fs.rm` on unvalidated paths
- `process.env` values serialized into JSON output

**Configuration:** `.semgrep.yml` at repo root.

```bash
npm run security:semgrep
```

```powershell
npm run security:semgrep
```

```powershell
npm run security:semgrep -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"
```

---

### `npm run test:fuzz:smoke`

Runs bounded, deterministic fuzz smoke tests against security-sensitive parsers and helpers.

**When to use:** Before release to verify that no parser crashes on malformed input.

**Design:**
- Seeded PRNG (default seed: `0xDEADBEEF`) for reproducibility.
- Default: 50 iterations per target.
- Completes in under 1 second.
- Does not require network access, external tools, or a my-dev-kit installation.
- Does not write outside temp directories.
- Does not mutate source files.

**Fuzz targets:**
- `manifest-reader` — manifest JSON parsing
- `code-graph-reader` — code-graph JSON parsing
- `npm-audit-parser` — npm audit JSON parsing
- `npm-ls-parser` — npm ls JSON parsing
- `npm-outdated-parser` — npm outdated JSON parsing
- `npm-pack-dry-run-parser` — npm pack dry-run output parsing
- `dot-label-escaping` — DOT label escaping helper (arbitrary string input)
- `path-normalization` — path.normalize/resolve with traversal inputs
- `source-windowing` — source retrieval window size edge cases

**Environment variables:**
- `FUZZ_SEED` — override the PRNG seed (hex, default: `0xDEADBEEF`)
- `FUZZ_ITERATIONS` — override iterations per target (default: `50`)

```bash
npm run test:fuzz:smoke
```

```powershell
$env:FUZZ_ITERATIONS = "200"
npm run test:fuzz:smoke
```

---

### `npm run security:validate`

Orchestrates all security-validation checks and writes a release security report.

**When to use:** Before release preparation to get a single verdict and actionable report. Can validate the current project (self-validation) or any local project directory via `--target`.

**Options:**
- `--target <path>` / `-t <path>` — path to the project to validate (default: self-validation of my-dev-kit-lab)
- `--out <dir>` — report output directory (default: `reports/security/`)
- `--report-prefix <name>` — override the generated filename prefix

**Checks orchestrated:**
- dependency audit — `npm audit` and `npm outdated` against the target (mandatory)
- package tarball inspection — `npm pack --dry-run` against the target (mandatory if target has package.json)
- CodeQL availability check — optional, skipped if CLI absent
- Semgrep static analysis — optional, skipped if unavailable
- target security test suite — runs `npm run test:security` in the target root for external validation when the target defines `scripts.test:security`; self-validation still runs the lab's own `test:security` suite in the tool root
- fuzz smoke — bounded fuzz targets against tool root (mandatory)

**Mandatory checks:** npm audit, package tarball inspection (when target has package.json), target/tool security test suite, fuzz smoke.

**Optional checks:** CodeQL CLI local availability, Semgrep, OSV-Scanner. Skipped with a structured reason when tools are absent.

**Report outputs:**
- `reports/security/<prefix>-security-validation.txt` — human-readable full report
- `reports/security/<prefix>-security-validation.json` — machine-readable structured report

Where `<prefix>` is derived automatically: `v0.2.1` for self, `my-dev-kit-v1.2.0` for scoped packages, `biolit-v1` for name-only packages, or directory basename for projects with no package.json.

External-target reports include both the tool root (`my-dev-kit-lab`) and the target root, plus target package and git metadata when available. The target security suite check records the executed command, command cwd, exit code, and stdout/stderr summaries. Target project files are not modified during validation.

Installed-package validation must be smoke-tested from a packed tarball before publish. This catches cases where source-checkout execution differs from the npm package layout.

Generated reports are not committed by default (see `.gitignore`). To preserve a report for a release handoff, copy it to a versioned location explicitly.

**Verdict options:**
- `ready for release preparation` — all mandatory checks passed, no blocker/major findings
- `ready except optional manual checks` — mandatory checks passed but some optional tools were absent
- `not ready: security blocker remains` — blocker or mandatory check failure
- `inconclusive: audit environment incomplete` — too many mandatory checks were skipped

**Exit codes:** `0` = ready or ready-except-optional, `1` = blocker, `2` = inconclusive.

```bash
# Self-validation (default)
npm run security:validate

# Validate an external project
npm run security:validate -- --target /path/to/my-dev-kit

# Custom output directory and prefix
npm run security:validate -- --target /path/to/project --out /tmp/reports --report-prefix my-project-v1
```

```powershell
# Self-validation (default)
npm run security:validate

# Validate an external project on Windows
npm run security:validate -- --target "Z:\Users\newuser\Projects\my-dev-kit-v1"

# Invalid target — fails cleanly with an error message
npm run security:validate -- --target "Z:\does\not\exist"
```
