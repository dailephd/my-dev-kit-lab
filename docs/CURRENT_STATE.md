# Current State

`v0.4.1` is the published baseline. The advanced Android implementation is released; package metadata is `0.4.1`. `v0.4.0` is the previous published baseline.

The Android profile runs nineteen default checks: eight baseline checks plus eleven internal advanced checks. Gradle operations and the optional `semgrep`, `osv`, `android-lint`, and `dependency-check` adapters require explicit requests. Default execution starts zero external processes and permits no network.

Reports preserve SecurityFinding separately from CandidateEvidence and add advanced, external-tool, candidate, artifact, mutation, verdict, and limitation sections. Selected local resources resolve conservatively; full manifest/resource merging and runtime behavior do not.

`v0.4.2` AuditIssue integration remains future work.
