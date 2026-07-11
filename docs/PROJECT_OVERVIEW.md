# Project Overview

my-dev-kit-lab remains the experiment, evidence, report, visualization, audit, and security-validation companion for my-dev-kit. `v0.4.0` is published. `v0.4.1` is implementation-complete but unreleased, with package metadata still at `0.4.0`.

The canonical Android profile runs nineteen deterministic checks: eight v0.4.0 checks and eleven advanced internal families covering network configuration, backup/release configuration, secrets/signing, WebView/FileProvider, sensitive storage/logging/clipboard, and Firebase/Google services. Four optional adapters - `semgrep`, `osv`, `android-lint`, and `dependency-check` - are explicit opt-ins. Gradle operations and external tools are disabled by default.

AndroidCheckResult is canonical. SecurityFinding is confirmed conservative evidence; CandidateEvidence is unresolved or review evidence. Text/JSON reports add advanced checks, external-tool checks, candidate summaries, relative artifact references, and target-mutation evidence.

The workflow does not modify targets automatically, merge manifests, evaluate full overlays or Gradle scripts, inspect APK/AABs, execute devices, automate Play Console work, verify remote Firebase deployment state, or perform pentesting. The general `npm run audit` remains separate. Android SecurityFinding-to-AuditIssue mapping remains planned for `v0.4.2`.

See [Commands](COMMANDS.md), [Workflows](WORKFLOWS.md), [Architecture](ARCHITECTURE.md), and [Roadmap](ROADMAP.md).
