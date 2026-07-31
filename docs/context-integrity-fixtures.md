# Context-integrity ecosystem fixtures (v0.4.5, implemented, unreleased)

This document is the canonical provenance reference for the frozen regression fixture pair used by the v0.4.5 context-integrity evaluation. It is derived entirely from the tracked fixture manifests (`tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/*.json`), which remain the authoritative, machine-readable source of truth. See [ARCHITECTURE.md](ARCHITECTURE.md) for how these fixtures are loaded and evaluated, and [METRICS.md](METRICS.md) for what the resulting metrics mean.

## What is frozen, and why

The fixture pair exists to give the context-integrity evaluation a deterministic, real-evidence-grounded regression case, without requiring a live my-dev-kit or my-dev-kit-orchestrator checkout at test time.

- **`failed-run`** — a byte-exact freeze of a real historical `my-dev-kit` `v1.11.0` Batch 1 orchestrator run (`runId 20260730T113740-implement-my-dev-kit-v1-11-0-b`) that actually failed: a pre-`v1.10.4` producer false negative (`roleAdequacy` insufficient, `requiredEvidenceLost: true` from bounded-allocation overflow, no `roleConditionCoverage`) combined with an authored judge `PASS` that contradicts the canonical `NEED_CONTEXT` expectation, followed by a final report and a `complete` lifecycle resolution that the current (`v1.2.3`) gate-aware resolver would force to blocked/ineligible. This is real evidence, not synthesized.
- **`corrected-replay`** — a hand-distilled representation of the exact validated local `my-dev-kit` `v1.10.4` and `my-dev-kit-orchestrator` `v1.2.3` contracts, applied to the **same** run identity, target repository, active index, and request shape as `failed-run`. It is derived from the real failed-run producer capsule/audit (same owners, same retained contract witnesses, same real evidence-group data) with the exact `v1.10.4` condition-aware corrections applied on top: `roleConditionCoverage` added, `requiredOmittedCount` corrected to `0` for the previously affected groups (reclassified as optional-only omissions matching the real retained/available counts), and `roleAdequacy`/`truncation` updated to the resulting `sufficient with assumptions` / `requiredEvidenceLost: false` state.

**The `corrected-replay` fixture is not:**
- a live capture of a complete ten-stage AI-authored implementation workflow;
- a byte-exact generated upstream run;
- an independently rerun ten-stage implementation; or
- proof that every future run against these contracts will behave identically.

It follows the same hand-distillation convention already used by `my-dev-kit-orchestrator`'s own `tests/fixtures/v123-batch4/corrected-run` fixture (commit `2cb82f0`), rather than a live ten-stage AI-authored replay, since redoing the actual Android feature implementation the original run performed was outside safe, bounded batch scope.

## Frozen upstream identity

Both fixtures are pinned to the same frozen, non-negotiable upstream commits used throughout v0.4.5 implementation:

| Repository | Branch | Commit | Package version |
|---|---|---|---|
| `my-dev-kit` | `fix/v1.10.4-context-adequacy-semantics` | `d09068fc8190ba8bde3fcc7b045ca62a3ce18876` | `1.10.3` |
| `my-dev-kit-orchestrator` | `fix/v1.2.3-run-integrity` | `2cb82f09ed423be8defd8277f28608c8a17eae3e` | `1.2.2` |

Both fixtures share `runId 20260730T113740-implement-my-dev-kit-v1-11-0-b`, `targetRepositoryIdentity` `Z:/Users/newuser/Projects/my-dev-kit-v1`, and `activeIndexIdentity` `Z:/Users/newuser/Projects/my-dev-kit-v1/.my-dev-kit-context/v1.11.0-batch-1-compose-artifact-foundation/implementation` — the same request/target/index identity, by construction.

## Tracked fixture inventory

The tracked fixture tree (`tests/fixtures/ecosystem/context-integrity/v0.4.5/`) contains 31 files and approximately 1.17 MB (1,223,394 bytes) total, bounded well within a normal test-fixture footprint:

- `failed-run/` — 26 tracked files per the manifest's `artifacts` list: 25 byte-exact copies of real run artifacts (run metadata, producer requests/capsules/audits, supplemental packets and retrieval reports, judge/final/implementation/verification reports, tool-version files) plus 1 lab-derived file (`derived/run-integrity-evidence.json`, assembled from the judge report, final report, and specific capsule fields — never itself a byte-exact upstream artifact).
- `corrected-replay/` — 3 tracked files, all lab-derived: `producer/implementation-capsule.json`, `producer/implementation-audit.json`, and `derived/run-integrity-evidence.json`. None of the corrected-replay fixture's tracked files are byte-exact copies of an upstream artifact; every one carries `derived: true` in its manifest entry, with explicit `derivationSources`.
- `manifests/` — 2 manifest files (`failed-run-manifest.json`, `corrected-replay-manifest.json`), each `manifestSchemaVersion: "1.0.0"`.

## Exclusions

The `failed-run` manifest records 13 excluded-artifact entries (kept in the manifest for hash provenance, not copied into the tracked fixture tree), each with an explicit `exclusionReason`. Categories:

- **Oversized artifacts** (e.g. `test-capsule.json` at 6.2 MB, `test-audit.json` at 5.75 MB) — excluded to keep the tracked fixture bounded; the excluded role (`test-implementation`) reported `roleAdequacy: sufficient with assumptions`, i.e. was not the failure driver, so its exclusion does not remove evidence needed to evaluate the failure chain.
- **Out-of-gate artifacts** (e.g. `architecture-capsule.json`) — the orchestrator's `RunIntegrityGate` only gates the `implementation`/`test-implementation` stages, not `architecture`.
- **Investigation-only duplicates and diagnostics** (narrow-probe variants, diff artifacts, index manifests, trace-checker output, `--help` output, prior hash inventories, prompt/instruction-packet sidecars) — not consumed by any Batch 1-3/Batch 1-5 reader.

No excluded artifact removes evidence that the implemented readers, metrics, or agreement calculators actually consume; every exclusion is justified against what those readers read.

## No secrets found

The tracked fixture bytes are source-control-safe evaluation evidence — file paths, capsule/audit JSON, and orchestrator report text drawn from a local development run against the `my-dev-kit-v1` and `my-dev-kit-orchestrator` repositories. No credential, token, API key, or other secret material was identified in the tracked fixture files during batch implementation. This is evidence review at fixture-authoring time, not an automated secret-scanning guarantee; see [security-validation-framework.md](security-validation-framework.md) for the repository's automated secret-leakage checks, which apply to generated lab artifacts generally.

## Hash verification and no upstream repository required

`src/evaluation/ecosystemFixtures/verifyFixtureHashes.ts` recomputes SHA-256 over each tracked fixture file and compares it against the manifest's recorded `copiedSha256`. Normal `npm run test`/`npm run test:evaluation`/`npm run test:experiments`/`npm run test:report` runs load and hash-verify only the tracked fixture files under `tests/fixtures/ecosystem/context-integrity/v0.4.5/` — they do not require a checked-out `my-dev-kit` or `my-dev-kit-orchestrator` repository at any commit. The frozen upstream commits recorded above are provenance metadata, not a runtime dependency.
