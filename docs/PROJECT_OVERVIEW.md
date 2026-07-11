# Project Overview

## What is my-dev-kit-lab?

my-dev-kit-lab is the experiment, evidence, reporting, visualization, and security-validation companion for my-dev-kit. It preserves the controlled raw-full-file versus graph-guided retrieval experiments while providing local, report-first validation tools.

The current published baseline is `v0.3.4`. The work on `feature/v0.4.0-android-validation-mvp` is **implementation complete; pending pre-release readiness and release preparation**. It is not published and package metadata remains `0.3.4`.

## Implemented capabilities on the feature branch

- The existing standalone `security:validate` command supports the canonical `android` profile.
- Android validation detects and classifies local Android Gradle projects, including application, library, multi-module, partial, and non-Android targets; it also recognizes Compose, XML/View, mixed, and uncertain UI evidence.
- It parses manifests independently, audits permissions, exported components, intent filters, and deep-link evidence, and records conservative `SecurityFinding` evidence.
- It statically extracts Gradle wrapper/module metadata, including plugins, SDK levels, namespace/application identity, version metadata, build/source sets, version-catalog evidence, and cross-module applicationId conflicts.
- It writes bounded text and JSON reports under the existing `reports/security/` root and records target-mutation evidence.

Android validation extends the existing security-validation system; it is not a separate product or a replacement for `security:validate`. The general security audit adapter remains separate. Android-specific `SecurityFinding` to `AuditIssue` mapping is planned for `v0.4.2`.

## Operating model

Default Android validation is static and read-only with respect to the target. It runs no Gradle process. Optional wrapper-backed validation is explicit, allowlisted, and limited to `wrapper-version`, `tasks`, `assemble-debug`, `unit-test-debug`, and `lint-debug`.

Reports are written outside the target by default. Optional Gradle execution records expected generated outputs and unexpected target changes rather than attempting cleanup.

## Boundaries

Static Android analysis is evidence, not a runtime-security or Google Play compliance guarantee. Manifests are not merged; placeholders and Android resources are not resolved; Gradle files are not evaluated; dynamic values can remain unresolved; and same-file duplicate Gradle assignments use first-match extraction.

v0.4.0 does not inspect APK/AAB contents, validate signing, run emulators/devices, verify Digital Asset Links or domain ownership, check live Google Play policy, upload applications, or provide automatic fixes.

## Next phases

1. `v0.4.0`: Android validation MVP — implementation complete on the feature branch; pending pre-release readiness and release preparation.
2. `v0.4.1`: planned advanced Android checks, including cleartext/network security configuration, backup, debuggable configuration, redacted secret scanning, WebView/FileProvider/storage/logging/clipboard/Firebase review, and optional Android-specific tool evidence.
3. `v0.4.2`: planned Android-aware extension of the existing security audit adapter; it will not replace `security:validate`.
4. Manual pentest remains a human-led, post-v1 / version-TBD activity, not v0.4.x work.

See [COMMANDS.md](COMMANDS.md), [WORKFLOWS.md](WORKFLOWS.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [ROADMAP.md](ROADMAP.md).
