// v0.4.5 context-integrity evaluation: report smoke script. Loads the frozen failed-run and
// corrected-replay fixtures, evaluates them through the existing producer-readiness bridge,
// and writes JSON/text/HTML reports for manual inspection. Not part of any release-readiness
// gate; a developer convenience for inspecting ContextIntegrityReportV1 output.
import { mkdirSync, writeFileSync } from "node:fs";
import { loadContextIntegrityFixture } from "../src/evaluation/ecosystemFixtures/loadContextIntegrityFixture.js";
import { evaluateProducerReadinessBridge } from "../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import { calculateStageContextDeterminism } from "../src/evaluation/stageContextDeterminism/calculateStageContextDeterminism.js";
import { buildContextIntegrityReport } from "../src/report/experiments/buildContextIntegrityReport.js";
import { renderContextIntegrityJsonReport } from "../src/report/experiments/renderContextIntegrityJsonReport.js";
import { renderContextIntegrityText } from "../src/report/experiments/renderContextIntegrityText.js";
import { renderContextIntegrityHtml } from "../src/report/experiments/renderContextIntegrityHtml.js";
import type { ContextIntegrityFixtureKind } from "../src/report/experiments/contextIntegrityReportModel.js";

const CASES: { kind: ContextIntegrityFixtureKind; root: string; manifest: string }[] = [
  {
    kind: "failed-run",
    root: "tests/fixtures/ecosystem/context-integrity/v0.4.5/failed-run",
    manifest: "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/failed-run-manifest.json"
  },
  {
    kind: "corrected-replay",
    root: "tests/fixtures/ecosystem/context-integrity/v0.4.5/corrected-replay",
    manifest: "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/corrected-replay-manifest.json"
  }
];

async function main() {
  const outDir = "lab-output/context-integrity-report-smoke";
  mkdirSync(outDir, { recursive: true });

  for (const c of CASES) {
    const fixture = await loadContextIntegrityFixture(c.root, c.manifest);
    if (!fixture.ok) {
      console.error(`Fixture load failed for ${c.kind}:`, fixture.issues);
      process.exitCode = 1;
      continue;
    }
    const bridgeResult = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: fixture.implementationCapsule!, retrievalAuditRecord: fixture.implementationAudit! },
      readiness: fixture.runIntegrityEvidence?.gate.implementationContext,
      runIntegrityEvidence: fixture.runIntegrityEvidence!,
      expectations: {
        schemaVersion: "1.0.0",
        caseId: "CASE-SMOKE",
        title: "smoke",
        description: "smoke",
        expectedEvidence: [],
        expectedStates: {},
        warnings: [],
        producerReadinessExpectations: {}
      }
    });
    const determinism = calculateStageContextDeterminism([
      { runNumber: 1, value: bridgeResult },
      { runNumber: 2, value: bridgeResult }
    ]);
    const report = buildContextIntegrityReport({
      fixtureKind: c.kind,
      manifest: fixture.manifest!,
      hashVerification: fixture.hashVerification!,
      capsule: fixture.implementationCapsule,
      audit: fixture.implementationAudit,
      bridgeResult,
      determinism,
      fixtureSelfImmutable: true
    });

    writeFileSync(`${outDir}/${c.kind}.report.json`, renderContextIntegrityJsonReport(report), "utf8");
    writeFileSync(`${outDir}/${c.kind}.report.txt`, renderContextIntegrityText(report), "utf8");
    writeFileSync(`${outDir}/${c.kind}.report.html`, renderContextIntegrityHtml(report), "utf8");
    console.log(`Wrote ${c.kind} reports. endToEnd=${report.endToEnd?.category}`);
  }
}

main();
