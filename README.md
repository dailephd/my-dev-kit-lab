# my-dev-kit-lab

my-dev-kit-lab is the experiment, evidence, reporting, visualization, audit, and security-validation companion for my-dev-kit. It provides controlled retrieval experiments, deterministic demonstrations, reports, plots, galleries, generic audits, and local security-validation workflows.

## Version state

`v0.4.0` is the published baseline. The `v0.4.1` advanced Android implementation is implementation-complete on `feature/v0.4.1-advanced-android-security` but unreleased. Package metadata remains `0.4.0` until a separate release-preparation workflow. `v0.4.2` remains future work.

## Android validation

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android
```

The default Android profile runs nineteen checks: the original eight checks plus eleven advanced internal checks for Network Security Config, backup/data extraction, release configuration, secret candidates, signing configuration, WebView, FileProvider, sensitive storage, sensitive logging, clipboard, and Firebase/Google services. It runs zero Gradle operations, zero external tools, and zero network operations by default.

`SecurityFinding` records confirmed conservative evidence. `CandidateEvidence` remains separate review or unresolved evidence and is not a confirmed vulnerability. Text and JSON reports under `reports/security/` include advanced-security checks, external-tool results, candidate-evidence summaries, artifacts, mutation evidence, verdict reasons, and limitations.

Optional Gradle operations use `--android-gradle-operations` and only accept `wrapper-version`, `tasks`, `assemble-debug`, `unit-test-debug`, and `lint-debug`. They are environment-dependent, record mutations, and never perform cleanup or arbitrary tasks.

Optional external tools use `--android-external-tools semgrep,osv,android-lint,dependency-check`. Network defaults to `--android-external-network deny`; `allow-requested` authorizes only requested supported network-capable tools. Semgrep uses package-owned local rules, Android Lint reuses the closed offline Gradle path, Dependency-Check disables updates, and OSV requires explicit network authorization. Tools are never installed automatically; unavailable requested tools are skipped or inconclusive, not clean passes.

Verdicts are `not-ready-security-blocker-remains`, `inconclusive-audit-environment-incomplete`, `ready-except-optional-manual-checks`, and `ready-for-release-preparation`. They are evidence states, not runtime, Play, publication, or pentest guarantees.

Selected local references such as supported `@xml` resources are resolved conservatively. Manifests are not merged, full overlay precedence and Gradle evaluation are not implemented, whole-program flow is not performed, and APK/AAB, signing, emulator/device, remote Firebase, live Play policy, and manual pentest validation remain outside scope.

See [Project overview](docs/PROJECT_OVERVIEW.md), [Commands](docs/COMMANDS.md), [Workflows](docs/WORKFLOWS.md), [Architecture](docs/ARCHITECTURE.md), and [Roadmap](docs/ROADMAP.md).
