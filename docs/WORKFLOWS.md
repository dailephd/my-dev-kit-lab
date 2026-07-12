# Workflows

## Default Android workflow

Resolve target/profile, detect Android, collect shared evidence, run the original eight checks, append eleven internal advanced checks in fixed order, aggregate SecurityFinding and CandidateEvidence, derive the verdict, and write text/JSON reports. The default runs nineteen checks and starts zero Gradle, external-tool, or network processes.

## Optional Gradle workflow

Only requested fixed operation IDs run. Environment gaps are visible, generated output and unexpected mutations are reported, and cleanup is never attempted.

## Optional external-tool workflow

Closed tool selection is followed by network-policy validation, version probing, minimal environment construction, fixed bounded arguments, contained artifacts, tool-specific parsing, finding normalization, failure isolation, and text/JSON presentation. Missing requested tools are skipped or inconclusive. Unrequested tools have no verdict effect.

Internal checks always run for Android. Optional Gradle/tools run only when requested. Equivalent Android Lint execution is deduplicated, and external failure cannot erase internal results.

Read SecurityFinding as confirmed conservative evidence, CandidateEvidence as review evidence, check status as execution outcome, verdict as aggregate evidence state, artifacts as contained supporting files, and mutation evidence as target-change accounting. Play-readiness items and static/runtime limitations still require human review.

`security:validate` remains distinct from `npm run audit`. Android AuditIssue mapping remains v0.4.2 work. v0.4.1 is released.
