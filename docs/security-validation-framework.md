# Security Validation Framework

## Scope

my-dev-kit-lab provides automated, local CLI/package and Android static-validation evidence. It is not a hosted-web scanner or a manual pentest framework.

The current published baseline is `v0.3.4`; Android validation is implemented on the v0.4.0 feature branch and pending pre-release readiness and release preparation.

## Android profile

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android
```

The Android path uses the same command and report root as the existing security framework. It performs Android detection, independent manifest parsing, four initial audit families, static Gradle metadata extraction, release-metadata assembly, Play-readiness placeholders, verdict calculation, and text/JSON reporting.

The default is static-only: no Gradle command runs. To opt in:

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android --android-gradle-operations wrapper-version,tasks
```

Only `wrapper-version`, `tasks`, `assemble-debug`, `unit-test-debug`, and `lint-debug` are accepted. Arbitrary Gradle tasks are never passed through.

## Reports and verdicts

Reports remain under `reports/security/` by default and are written outside the target. Android reports include target metadata, classification, manifest/component/permission/intent-filter/deep-link summaries, Gradle metadata, optional operation results, release metadata, Play-readiness placeholders, findings, check statuses, mutation evidence, verdict reasons, recommendations, and limitations.

The existing verdict vocabulary is reused. `ready-for-release-preparation` means required validation evidence is complete; it does not mean ready to publish or compliant with current Google Play policy.

## Target safety and limitations

The static path does not modify the target. Optional wrapper operations record expected output and unexpected mutations; no cleanup is attempted.

Manifests are not merged. Placeholders/resources are not resolved. Gradle is not evaluated, dynamic values may remain unresolved, and duplicate same-file Gradle assignments use first-match extraction. The framework does not validate signing, inspect APK/AABs, execute devices/emulators, verify Digital Asset Links or domain ownership, or perform live Play policy/Console checks.

## Audit relationship and roadmap

`security:validate` remains standalone. The existing general `npm run audit -- --types security` adapter is separate; v0.4.0 does not map Android findings into `AuditIssue`. That Android adapter extension is planned for v0.4.2. v0.4.1 advanced checks and a post-v1/manual-pentest workflow remain future work.
