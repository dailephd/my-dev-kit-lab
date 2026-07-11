# my-dev-kit-lab

my-dev-kit-lab is the experiment, evidence, reporting, visualization, and security-validation companion for my-dev-kit. It provides controlled raw-full-file versus graph-guided retrieval experiments, deterministic fake-agent demonstrations, reports, plots, gallery artifacts, generic audits, and local security-validation workflows.

The current published baseline is `v0.3.4`. The v0.4.0 Android validation implementation is complete on `feature/v0.4.0-android-validation-mvp`, validated on that branch, and pending pre-release readiness and release preparation. It is not published and package metadata remains `0.3.4`.

## Current capabilities

- Controlled experiment plugins, reports, plots, screenshots, and gallery artifacts.
- Generic code-rot and general security audit types through `npm run audit`.
- Standalone CLI/package security validation through `npm run security:validate`.
- Android security validation through the canonical `android` profile on the v0.4.0 feature branch.

## Android validation

Run static Android validation with:

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android
```

This default path executes **no Gradle commands**. It detects/classifies Android projects and UI evidence, parses discovered manifests independently, audits permissions/exported components/intent filters/deep links, extracts static Gradle metadata, assembles release metadata and Play-readiness placeholders, calculates an Android verdict, and writes bounded text and JSON reports.

Reports use the existing `reports/security/` root unless `--out` is supplied. Android report files use the `<prefix>-android-security-validation.txt` and `.json` convention.

Optional Gradle validation is explicit:

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android --android-gradle-operations wrapper-version,tasks
```

The only allowed operation IDs are:

- `wrapper-version`
- `tasks`
- `assemble-debug`
- `unit-test-debug`
- `lint-debug`

Unknown or empty lists, arbitrary tasks, and use with a non-Android profile are rejected. Optional operations can require Java, Android SDK components, wrapper distributions, and cached dependencies; environment gaps can produce skipped or inconclusive evidence.

### Verdicts

- `not-ready-security-blocker-remains`: a blocker remains.
- `inconclusive-audit-environment-incomplete`: required evidence/environment is incomplete.
- `ready-except-optional-manual-checks`: advisory or manual follow-up remains.
- `ready-for-release-preparation`: required static evidence passed.

These are validation-evidence states, not claims that an app is published, Play-ready, Play-compliant, runtime-secure, or signing-valid.

### Important Android limitations

- Static analysis does not prove runtime behavior.
- Manifests are not merged; placeholders and resource references are not resolved.
- Gradle scripts are not evaluated; dynamic metadata can stay unresolved; same-file duplicate assignment extraction uses the first match.
- Optional Gradle execution is disabled by default and environment-dependent.
- APK/AAB contents, signing, emulator/device behavior, Digital Asset Links, domain ownership, and live Google Play policy are not validated.
- Play Console items such as privacy policy, Data Safety, permissions declarations, store listing, release notes, content rating, and policy review remain manual placeholders.

## Development

```powershell
npm run typecheck
npm run build
npm run test
npm run verify
```

Use `npm run security:validate -- --help` for command usage. Help does not run validation or write reports.

## Roadmap status

- `v0.4.0`: Android validation MVP — implementation complete on the feature branch; pending pre-release readiness and release preparation.
- `v0.4.1`: planned advanced Android security checks.
- `v0.4.2`: planned Android extension of the existing security audit adapter; it will not replace `security:validate`.
- Manual pentest: deferred post-v1 / version TBD; not part of v0.4.x.

See [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md), [docs/COMMANDS.md](docs/COMMANDS.md), [docs/WORKFLOWS.md](docs/WORKFLOWS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
