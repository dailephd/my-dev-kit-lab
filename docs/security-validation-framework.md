# Security Validation Framework

my-dev-kit-lab provides local CLI/package validation and Android static evidence. `v0.4.1` is published; `v0.4.0` is the previous published baseline.

The Android profile runs nineteen default checks and writes deterministic text/JSON reports. Eleven internal advanced checks always run. Gradle operations and four external adapters are closed, explicit opt-ins; default execution starts zero processes and denies network.

AndroidCheckResult, SecurityFinding, CandidateEvidence, verdict reasons, artifacts, and target-mutation evidence remain distinct. Missing requested tools never become clean passes. Static evidence does not prove runtime behavior, Play compliance, remote Firebase state, APK/AAB contents, signing, or pentest results.

`security:validate` remains separate from `npm run audit`; Android SecurityFinding-to-AuditIssue mapping remains planned for v0.4.2.
