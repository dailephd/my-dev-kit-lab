# Current State

## Published baseline

The current published package baseline is `v0.3.4` (`package.json` version `0.3.4`). v0.4.0 is not published: this document makes no claim that it is on npm, on `main`, or in a GitHub Release.

## Active branch status

`release/v0.4.0` contains the completed v0.4.0 Android validation implementation, including the `security:validate --profile android` path and its focused CLI help correction. Status: **release-prepared; publication pending**.

## Implemented Android validation

- Canonical `android` security-validation profile.
- Static Android project detection/classification and target metadata.
- Independent manifest parsing and four initial audit families: permissions, exported components, intent filters, and deep links.
- Static Gradle wrapper/module metadata extraction and release-metadata summaries.
- Explicitly opt-in, five-operation Gradle validation allowlist.
- Android text/JSON reports in `reports/security/`, target mutation evidence, verdict reasons, and Play-readiness checklist placeholders.

## Current commands

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android
npm run security:validate -- --target "<android-project-path>" --profile android --android-gradle-operations wrapper-version,tasks
```

The first command is static-only and executes zero Gradle processes. `npm run security:validate -- --help` prints usage without validation or report writes.

## Planned and deferred

- `v0.4.1` advanced Android checks remain planned.
- `v0.4.2` Android audit-adapter extension remains planned; Android findings are not mapped into `AuditIssue` today.
- Manual pentest is deferred post-v1 / version TBD.
- Pre-release readiness and release preparation (version bump, release branch) are complete. The release PR, merge, tag, GitHub Release, and npm publication remain separate work.

## Limitations

Android validation is static evidence only. It does not merge manifests, resolve placeholders/resources, evaluate Gradle, validate signing, inspect APK/AAB files, test emulators/devices, validate live Google Play policy, or publish applications.
