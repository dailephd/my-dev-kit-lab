# Roadmap

This roadmap separates the current published baseline from active-branch implemented work, in-progress work, and planned work. A version listed here is not implemented unless its status says completed, current, or implemented on active branch.

`v0.3.0` is the current published baseline.

## Version sequence

```mermaid
flowchart LR
  A[v0.2.0<br/>plugin framework] --> B[v0.2.2<br/>security-validation fortification]
  B --> C[v0.3.0<br/>current published baseline]
  C --> D[v0.3.1<br/>language-aware code-rot substrate + TS/JS]
  D --> E[v0.3.2<br/>Python code-rot]
  E --> F[v0.3.3<br/>Java/Kotlin code-rot]
  F --> G[v0.3.4<br/>cross-language stability]
  G --> H[v0.4.0<br/>Android validation MVP]
  H --> I[v0.4.1<br/>advanced Android security]
  I --> J[v0.4.2<br/>optional Android audit bridge]
  J --> K[v1.0.0<br/>stable framework]
  K --> L[post-v1<br/>manual pentest / TBD]
```

## Completed Baselines

### v0.2.0 - generic experiment-plugin runtime

Status:
- completed

Purpose:
- Introduce the generic experiment-plugin runtime and route the existing raw-full-file versus my-dev-kit-guided experiment through the first plugin.

Scope:
- plugin registry and runner
- `context-strategy-comparison` as the first plugin
- target-aware experiment execution
- plugin-aware reports while preserving legacy experiment artifacts

Out of scope:
- audit framework
- language-aware code-rot detection
- Android validation

### v0.2.2 - automated security-validation fortification

Status:
- completed

Purpose:
- Harden the automated CLI/package security-validation framework and report model.

Scope:
- `security:validate` support for checks, profiles, formats, fail-on thresholds, and output directories
- attack-scenario framework and profile-aware defaults
- schema/report hardening and structured verdict reasoning

Out of scope:
- manual pentest
- generic audit framework
- Android validation

### v0.3.0 - generic audit framework and code-rot baseline

Status:
- current

Purpose:
- Add the generic audit framework and the first implemented audit family, code rot.

Scope:
- `npm run audit`
- shared audit target, config, registry, runner, issue, and report infrastructure
- project inventory and source-of-truth collection
- code-rot detector family
- text and JSON audit reports under `reports/audits/code-rot/`

Out of scope:
- language-aware source facts
- code quality audit type
- security audit integration
- project-wide combined audit defaults
- Android validation
- manual pentest

## v0.3.x Language-Aware Code-Rot Track

The `v0.3.x` goal is to complete language-aware code-rot support for TypeScript, JavaScript, Python, Java, and Kotlin.

Framework-aware code rot remains future/TBD after the language-aware track is stable. It is not part of `v0.3.x`.

### v0.3.1 - language-aware code-rot substrate + TypeScript/JavaScript support

Status:
- implemented on active branch; not published

Purpose:
- Add the reusable language-aware substrate for code-rot detectors and prove it with TypeScript and JavaScript support.

Scope:
- normalized language detection and file-role classification
- generated, vendor, and build-output exclusion where relevant
- language analyzer registry
- normalized source facts model
- TypeScript/JavaScript analyzer support
- deterministic TypeScript/JavaScript import, export, declaration, and reference facts where feasible
- source-facts report summary in text and JSON audit reports
- existing code-rot detectors consuming normalized source facts where relevant:
  - dead-code candidate reverse-reference checks merge parsed relative import/re-export basenames
  - duplicate implementation candidate checks add source-facts-derived duplicate exported declaration signals
  - test-rot checks use analyzer-recorded relative imports, including dynamic `import()`, for missing-target signals
- improved TypeScript/JavaScript code-rot candidate evidence while preserving `v0.3.0` command behavior and non-destructive report generation

Out of scope:
- Python support
- Java/Kotlin support
- framework-aware profiles
- Android security validation
- code quality detector family
- security audit integration
- project-wide audit default behavior
- TypeScript Program semantic analysis, type checking, full module resolution, `tsconfig` path alias resolution, coverage analysis, clone detection, or runtime reachability proof
- manual pentest

### v0.3.2 - Python code-rot support

Status:
- planned

Purpose:
- Add Python-aware code-rot detection using the language-aware substrate from `v0.3.1`.

Scope:
- Python file detection
- Python source facts for imports, functions, classes, top-level symbols, and module structure where deterministic and feasible
- Python package/project metadata detection from common Python project files
- pytest-style test mapping
- Python dead-code, duplicate implementation, test-rot, docs/code mismatch, and package/environment mismatch support
- safe degraded behavior when Python parsing is unavailable or incomplete

Out of scope:
- Java/Kotlin support
- Android validation
- framework-aware profiles
- code quality detector family
- security audit integration
- manual pentest

### v0.3.3 - Java/Kotlin code-rot support

Status:
- planned

Purpose:
- Add Java and Kotlin code-rot support in one version.

Scope:
- Java and Kotlin file detection
- JVM/Gradle/Maven project shape detection needed for source/test mapping
- Java source facts for packages, imports, classes, interfaces, methods, and public declarations where deterministic and feasible
- Kotlin source facts for packages, imports, classes, objects, functions, top-level declarations, and public declarations where deterministic and feasible
- Gradle/Maven source-set detection for test mapping
- Java/Kotlin dead-code, duplicate implementation, test-rot, and docs/code mismatch support
- conservative findings with confidence and false-positive labels

Out of scope:
- Android security validation
- full Android mobile validation
- framework-aware profiles
- compiler-level semantic analysis
- Gradle build success claims
- runtime behavior claims
- code quality detector family
- manual pentest

### v0.3.4 - cross-language code-rot fixture and stability pass

Status:
- planned

Purpose:
- Stabilize language-aware code-rot detection across the required languages.

Scope:
- fixture coverage for TypeScript, JavaScript, Python, Java, Kotlin, and mixed-language cases where appropriate
- JSON and text report stability for implemented language-aware behavior
- detector error isolation and skipped/degraded detector reporting
- cross-platform path behavior
- generated, vendor, and build-output exclusion coverage
- false-positive, confidence, and severity calibration
- implementation-completeness validation for the `v0.3.x` code-rot track

Out of scope:
- standalone documentation release
- framework-aware profiles
- Android validation
- manual pentest

## v0.4.x Android Automated Security Validation Track

### v0.4.0 - Android validation MVP

Status:
- planned

Purpose:
- Add the first complete automated Android validation path through `security:validate`.

Scope:
- Android/mobile validation substrate
- Android project detection and Android Compose classification
- Android profile model and target metadata capture
- Android report model foundation
- planned Android profile support for `security:validate`
- AndroidManifest parsing and manifest summary
- permission, exported component, intent-filter, and deep-link audits
- initial Android security verdict policy
- Gradle wrapper and metadata checks
- safe optional Gradle task validation where the environment supports it
- manifest release metadata summary and Play-readiness checklist placeholders

Out of scope:
- generating or scaffolding Android apps
- signing, publishing, or uploading to Google Play
- editing Gradle files, updating dependencies, or modifying target source files
- WebView unsafe settings
- FileProvider path exposure
- sensitive storage, logging, or clipboard checks
- Firebase / Google services risk review
- advanced supply-chain checks
- manual pentest
- full audit bridge
- automatic fixes

### v0.4.1 - advanced Android security checks

Status:
- planned

Purpose:
- Add deeper static Android security checks after the Android validation MVP exists.

Scope:
- cleartext traffic and Network Security Config audits
- backup/data extraction and debuggable/release build configuration audits
- hardcoded secret scanning with redacted previews only
- signing config leak detection
- WebView unsafe settings and FileProvider path exposure audits
- sensitive local storage, logging, and clipboard pattern audits
- Firebase / Google services risk review
- optional Android-specific Semgrep, OSV/dependency, Android Lint, and Gradle dependency-check evidence where available
- report stability for the fields introduced by this version

Out of scope:
- manual pentest
- Google Play publishing
- signing
- automatic fixes
- non-Android mobile platform expansion unless explicitly planned later

### v0.4.2 - optional Android security audit bridge

Status:
- planned

Purpose:
- Let `npm run audit` summarize Android security validation findings without replacing `security:validate`.

Scope:
- Android security report reader
- mapping Android validation findings into the shared audit issue model
- linked references to original Android security reports
- correct representation of skipped checks
- audit summary for Android validation status
- planned Android security audit command direction after the bridge exists

Out of scope:
- manual pentest
- project-wide combined audit default behavior unless separately planned
- automatic fixes
- replacing `security:validate`

## Stable And Post-Stable Releases

### v1.0.0 - stable framework release

Status:
- planned

Purpose:
- Release my-dev-kit-lab as a stable experiment, audit, automated security-validation, Android-validation, reporting, and evidence framework after the prerequisite `v0.x` work.

Scope:
- stable experiment plugin framework
- stable `context-strategy-comparison` plugin
- stable automated security validation
- stable generic audit framework with completed language-aware code-rot support
- Android automated security validation
- stable artifact schemas and report outputs
- deterministic fake demos and structured real-agent partial outcomes

Out of scope:
- manual pentest requirement for `v1.0.0`
- future audit-family expansion beyond the agreed prerequisite scope
- additional mobile-platform expansion beyond Android

### Post-v1 / version TBD - manual pentest and later expansion

Status:
- planned

Purpose:
- Hold post-stable work that is intentionally outside the `v0.x` and `v1.0.0` requirements.

Scope:
- manual pentest workflow
- future framework-aware code-rot profiles
- future audit-family expansion such as code quality, broader security-audit integration, and project-wide combined audit behavior
- additional mobile-platform expansion after Android is stable

Out of scope:
- treating manual pentest as required for automated Android security validation
- backfilling these items into the `v0.3.x` language-aware code-rot track

Manual pentest is deferred until after `v1.0.0`. It is a human-led workflow and is not required for automated Android security validation.
