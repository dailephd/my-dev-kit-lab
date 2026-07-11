# Workflows

## Android security validation

### Static default workflow

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android
```

1. The CLI resolves the local target and captures read-only target-state evidence.
2. Android detection classifies the project/modules/UI evidence.
3. Discovered manifests are parsed independently; permissions, exported components, intent filters, and deep links are audited.
4. Gradle metadata is statically extracted without evaluating Groovy or Kotlin DSL.
5. Result assembly adds release metadata, Play-readiness placeholders, findings, check statuses, mutation evidence, verdict reasons, and text/JSON reports.

The default performs no Gradle execution. Reports stay under `reports/security/` unless `--out` is supplied. The target is not edited.

### Optional Gradle workflow

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android --android-gradle-operations wrapper-version,tasks
```

Only `wrapper-version`, `tasks`, `assemble-debug`, `unit-test-debug`, and `lint-debug` may be requested. The wrapper receives fixed arguments; arbitrary tasks are rejected. Environment limitations may yield skipped or inconclusive evidence. The tool records target mutation evidence and does not clean generated output.

### Reading the result

- `ready-for-release-preparation`: required static evidence completed without blockers. It is not a publication or Google Play compliance claim.
- `ready-except-optional-manual-checks`: advisory findings, optional skips, or manual Play-readiness work remain.
- `inconclusive-audit-environment-incomplete`: required Android evidence is incomplete; partial and non-Android profile mismatches exit `2`.
- `not-ready-security-blocker-remains`: a security blocker remains; exit `1`.

Play-readiness items are local-evidence placeholders. Privacy policy, Data Safety, permission declarations, store listing, release notes, content rating, account/testing requirements, and current policy review require human follow-up. Library targets mark app-specific checklist items not applicable.

## Relationship to the general audit

`security:validate` and `npm run audit` are not the same command. The existing general security adapter remains available through `npm run audit -- --types security`; v0.4.0 does not map Android findings into `AuditIssue`. That adapter extension is planned for v0.4.2.

## Release workflow boundary

v0.4.0 implementation and documentation are on the feature branch. Pre-release readiness, release preparation, version bump, release branch/PR, merge, tag, GitHub Release, and npm publication are separate work. Manual pentest is deferred post-v1 / version TBD.
