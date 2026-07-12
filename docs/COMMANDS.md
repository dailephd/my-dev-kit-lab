# Commands

Default Android validation runs nineteen internal checks with zero Gradle processes, zero external tools, and zero network operations:

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android
```

Optional Gradle operations are comma-separated: `wrapper-version`, `tasks`, `assemble-debug`, `unit-test-debug`, `lint-debug`.

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android --android-gradle-operations wrapper-version,tasks
```

Optional tools are `semgrep`, `osv`, `android-lint`, and `dependency-check`:

```powershell
npm run security:validate -- --target "<android-project-path>" --profile android --android-external-tools semgrep,android-lint
npm run security:validate -- --target "<android-project-path>" --profile android --android-external-tools osv --android-external-network allow-requested
```

Network policy values are `deny` (default) and `allow-requested`. Authorization is limited to requested supported tools and does not permit installers, updates, or arbitrary endpoints. Combined Gradle/tool runs are allowed; equivalent Android Lint requests are deduplicated.

`npm run security:validate -- --help` exits 0 without validation or reports. Unknown tools and invalid Android-only options exit 2 with allowed values.

Reports default to `reports/security/<prefix>-android-security-validation.{txt,json}` and include advanced security checks, external tool results, CandidateEvidence, verdicts, mutation evidence, and relative artifact paths. Normalized reports do not embed raw tool stdout/stderr.
