# Commands

## Installation and validation

For local development, use the repository scripts:

```powershell
npm run typecheck
npm run build
npm run test
npm run verify
```

## Android security validation

The canonical Android command is:

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android
```

It performs static Android detection, manifest parsing, permission/exported-component/intent-filter/deep-link audits, static Gradle metadata extraction, verdict calculation, Play-readiness placeholders, and text/JSON report writing. Default execution runs **zero Gradle processes**.

Optional Gradle validation is explicit:

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android --android-gradle-operations wrapper-version,tasks
```

Allowed operation IDs are:

- `wrapper-version`
- `tasks`
- `assemble-debug`
- `unit-test-debug`
- `lint-debug`

Unknown or empty operation lists are rejected. Arbitrary Gradle tasks are not accepted, and `--android-gradle-operations` requires `--profile android`. Optional operations may require Java, Android SDK components, wrapper distributions, and cached dependencies; unavailable environment evidence can produce skipped or inconclusive results.

Use `npm run security:validate -- --help` for the complete command syntax. Help exits `0` and does not resolve a target, validate, or write reports. Unknown top-level options are usage errors with exit code `2`.

## Reports and exit codes

Reports use the existing `reports/security/` root unless `--out` is supplied. Android runs write `<prefix>-android-security-validation.txt` and `.json`.

- Exit `0`: no Android security blocker and no required-evidence gap.
- Exit `1`: security blocker remains.
- Exit `2`: Android environment/evidence is incomplete, including partial or non-Android targets used with the Android profile.
- Exit `3`/`4`: command/runtime or report-writing failure.

Android verdicts are evidence states, not claims of publication, runtime security, or Google Play compliance.

## Other implemented commands

`npm run audit` remains distinct from `security:validate`. `code-rot` and the general `security` audit types are implemented; Android-specific audit-adapter integration is planned for `v0.4.2` and no Android profile passthrough exists on `audit`.
