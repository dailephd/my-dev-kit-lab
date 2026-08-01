// v0.4.5 Batch 4 (sections 23-24): repeated deterministic evaluation and fixture
// self-immutability for both frozen ecosystem fixtures, reusing the existing
// stage-context-determinism infrastructure rather than a second implementation.
import { describe, expect, it } from "vitest";
import { loadContextIntegrityFixture } from "../../../src/evaluation/ecosystemFixtures/loadContextIntegrityFixture.js";
import { verifyFixtureHashes } from "../../../src/evaluation/ecosystemFixtures/verifyFixtureHashes.js";
import { validateEcosystemFixtureManifest } from "../../../src/evaluation/ecosystemFixtures/validateManifest.js";
import { evaluateProducerReadinessBridge } from "../../../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import { calculateStageContextDeterminism } from "../../../src/evaluation/stageContextDeterminism/calculateStageContextDeterminism.js";
import type { StageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";
import { readFile } from "node:fs/promises";

const CASES = [
  {
    name: "failed-run",
    fixtureRoot: "tests/fixtures/ecosystem/context-integrity/v0.4.5/failed-run",
    manifestPath: "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/failed-run-manifest.json"
  },
  {
    name: "corrected-replay",
    fixtureRoot: "tests/fixtures/ecosystem/context-integrity/v0.4.5/corrected-replay",
    manifestPath: "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/corrected-replay-manifest.json"
  }
];

function baseExpectations(): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-V045-B4-DETERMINISM",
    title: "determinism",
    description: "d",
    expectedEvidence: [],
    expectedStates: {},
    warnings: [],
    producerReadinessExpectations: {}
  };
}

describe.each(CASES)("$name: repeated deterministic evaluation (section 23)", ({ fixtureRoot, manifestPath }) => {
  it("three repeated evaluations produce identical canonical digests", async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const fixture = await loadContextIntegrityFixture(fixtureRoot, manifestPath);
      const result = evaluateProducerReadinessBridge({
        implementation: { role: "implementation", contextCapsule: fixture.implementationCapsule!, retrievalAuditRecord: fixture.implementationAudit! },
        readiness: fixture.runIntegrityEvidence?.gate.implementationContext,
        runIntegrityEvidence: fixture.runIntegrityEvidence!,
        expectations: baseExpectations()
      });
      runs.push(result);
    }

    const determinism = calculateStageContextDeterminism(runs.map((value, index) => ({ runNumber: index + 1, value })));
    expect(determinism.availability).toBe("available");
    expect(determinism.deterministic).toBe(true);
    expect(determinism.mismatchRunNumbers).toEqual([]);
    // Bounded evidence, not just a verdict string: every run digest is recorded.
    expect(determinism.runDigests).toHaveLength(3);
    expect(new Set(determinism.runDigests.map((d) => d.sha256)).size).toBe(1);
  });
});

describe.each(CASES)("$name: fixture self-immutability (section 24)", ({ fixtureRoot, manifestPath }) => {
  it("evaluation does not modify fixture files; hashes remain unchanged before and after", async () => {
    const manifestRaw = JSON.parse(await readFile(manifestPath, "utf8"));
    const manifestResult = validateEcosystemFixtureManifest(manifestRaw);
    expect(manifestResult.ok).toBe(true);
    if (!manifestResult.ok) return;

    const before = await verifyFixtureHashes(manifestResult.manifest, fixtureRoot);
    expect(before.ok).toBe(true);

    const fixture = await loadContextIntegrityFixture(fixtureRoot, manifestPath);
    evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: fixture.implementationCapsule!, retrievalAuditRecord: fixture.implementationAudit! },
      readiness: fixture.runIntegrityEvidence?.gate.implementationContext,
      runIntegrityEvidence: fixture.runIntegrityEvidence!,
      expectations: baseExpectations()
    });

    const after = await verifyFixtureHashes(manifestResult.manifest, fixtureRoot);
    expect(after.ok).toBe(true);
    expect(after).toEqual(before);
  });
});
