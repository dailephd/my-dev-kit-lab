// v0.4.4 Batch 3 section 22: one complete deterministic historical-fixture evaluation
// producing report.json/report.txt/report.html from the corrected full-bridge case, run
// through the real combined-bounded-stage-context strategy + run assurance + report
// pipeline (not a shortcut around it). repeatCount > 1 and target immutability are both
// configured.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runV043StageContextStrategyWithAssurance } from "../../../src/experiments/plugins/contextStrategyComparison/runV043StageContextStrategyWithAssurance.js";
import { buildContextStrategyComparisonV043Report } from "../../../src/report/experiments/buildContextStrategyComparisonV043Report.js";
import { buildPluginExperimentReport } from "../../../src/report/experiments/buildPluginExperimentReport.js";
import { renderPluginExperimentReportText } from "../../../src/report/experiments/renderPluginExperimentReportText.js";
import { renderContextStrategyComparisonV043Html } from "../../../src/report/experiments/renderContextStrategyComparisonV043Html.js";
import type { ExperimentRun } from "../../../src/experiments/index.js";
import { contextStrategyComparisonMetadata } from "../../../src/experiments/plugins/contextStrategyComparison/index.js";
import { buildValidSupplementalContextText } from "../../evaluation/upstreamArtifacts/supplementalContextFixtures.js";
import type { CombinedBoundedStageContextStrategyInputV1 } from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyInputContracts.js";

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const PACKET_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";
const EXPECTATIONS_FIXTURE_PATH = "tests/fixtures/stage-context-expectations/complete-v1.0.0.json";

const CANONICAL_IDENTITY = "Z:/fixture/project";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdkl-b3-bridge-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeSupplementalFixture(dir: string, name: string, kind: Parameters<typeof buildValidSupplementalContextText>[0]): string {
  const text = buildValidSupplementalContextText(kind, { metadata: { "Index identity": CANONICAL_IDENTITY } });
  const path = join(dir, name);
  writeFileSync(path, text, "utf8");
  return path;
}

describe("producer-readiness bridge: complete historical fixture-to-report run", () => {
  it("runs combined-bounded-stage-context with all producer-readiness bridge inputs and produces report.json/report.txt/report.html", async () => {
    const dir = makeTempDir();
    const implementationContextPacketPath = writeSupplementalFixture(dir, "implementation-context-packet.txt", "implementation-context-packet");
    const implementationContextRetrievalReportPath = writeSupplementalFixture(
      dir,
      "implementation-context-retrieval-report.txt",
      "implementation-context-retrieval-report"
    );

    const input: CombinedBoundedStageContextStrategyInputV1 = {
      strategyId: "combined-bounded-stage-context",
      expectationsPath: EXPECTATIONS_FIXTURE_PATH,
      // Note: the tracked capsule/audit fixture pair intentionally differ on
      // request.requestedOutputPath (pre-existing v0.4.3 fixture data, unrelated to
      // Batch 3), which the existing checkMyDevKitContextArtifactConsistency check
      // correctly flags. This bridge test exercises the capsule alone to avoid that
      // pre-existing inconsistency; consistency checking itself is already covered by
      // existing v0.4.3 tests and is not part of Batch 3's scope.
      contextArtifacts: [{ role: "implementation", contextCapsulePath: CAPSULE_FIXTURE_PATH }],
      workflowInstructionPacketPath: PACKET_FIXTURE_PATH,
      implementationContextPacketPath,
      implementationContextRetrievalReportPath,
      readiness: {
        schemaVersion: "1.0.0",
        kind: "implementation",
        role: "implementation",
        decision: "ready",
        classification: "ready",
        stageId: "stage.feature.implementation",
        packetPath: implementationContextPacketPath,
        reportPath: implementationContextRetrievalReportPath,
        issues: [],
        warnings: [],
        blockingIssueCodes: [],
        affectedResponsibilityIds: [],
        evaluatedFreshness: "fresh",
        evaluatedAdequacy: "sufficient",
        requiredEvidenceTruncated: "no",
        readyWithAssumptions: false,
        provenanceSummary: "resolved from populated packet/report pair",
        indexIdentity: CANONICAL_IDENTITY
      }
    };

    const assurance = await runV043StageContextStrategyWithAssurance(input, {
      repeatCount: 3,
      targetImmutability: { targetRootPath: dir, relativeFilePaths: ["implementation-context-packet.txt"] }
    });

    // TST-B3-007..012 style structural assertions on the executed strategy input/output.
    expect(assurance.strategyId).toBe("combined-bounded-stage-context");
    expect(assurance.primaryExecution.status).toBe("completed");
    expect(assurance.primaryProducerReadinessBridge?.status).toBe("evaluated");

    // TST-B3-036 corrected case: no owner/allocation contradictions, readiness agrees.
    const bridge = assurance.primaryProducerReadinessBridge!;
    expect(bridge.implementation?.packetAgreement?.contradictions).toEqual([]);
    expect(bridge.implementation?.reportAgreement?.contradictions).toEqual([]);

    // TST-B3-064 configured unchanged target -> available zero mutations.
    expect(assurance.runRecords[0].targetImmutability.availability).toBe("available");
    if (assurance.runRecords[0].targetImmutability.availability === "available") {
      expect(assurance.runRecords[0].targetImmutability.comparison.status).toBe("unchanged");
    }

    // TST-B3-059 three repeated runs produce identical canonical digests.
    expect(assurance.determinism.availability).toBe("available");
    expect(assurance.determinism.deterministic).toBe(true);
    expect(assurance.determinism.runDigests.map((d) => d.sha256)).toEqual([
      assurance.determinism.baselineSha256,
      assurance.determinism.baselineSha256,
      assurance.determinism.baselineSha256
    ]);

    const run = {
      runId: "b3-fixture-run",
      pluginId: "context-strategy-comparison",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      status: "completed",
      target: { id: "fixture-target", label: "fixture", kind: "local-directory" },
      variants: [],
      cases: [],
      metrics: [],
      artifacts: [],
      warnings: [],
      failures: [],
      v043StageContextExecutions: [assurance.primaryExecution],
      v043StageContextEvaluations: [assurance.primaryEvaluation],
      v043StageContextRunAssurance: [assurance],
      metadata: {}
    } as unknown as ExperimentRun;

    const report = buildContextStrategyComparisonV043Report(run);
    expect(report).not.toBeNull();
    // TST-B3-037 JSON model includes the producer-readiness sections.
    expect(report!.strategies[0].producerReadinessBridge?.status).toBe("evaluated");

    const pluginReport = buildPluginExperimentReport({
      run,
      plugin: contextStrategyComparisonMetadata,
      generatedAt: "2026-01-01T00:00:02.000Z"
    });

    // TST-B3-043 no undefined/NaN/Infinity in the serialized JSON.
    const jsonText = JSON.stringify(pluginReport, null, 2);
    expect(jsonText).not.toContain("undefined");
    expect(jsonText).not.toContain("NaN");
    expect(jsonText).not.toContain("Infinity");
    // No absolute upstream repository paths leak into the report.
    expect(jsonText).not.toContain("my-dev-kit-v1");
    expect(jsonText).not.toContain("my-dev-kit-orchestrator\\dist");

    const reportJsonPath = join(dir, "report.json");
    writeFileSync(reportJsonPath, jsonText, "utf8");
    const reparsed = JSON.parse(jsonText);
    expect(reparsed.contextStrategyComparisonV043.strategies[0].strategyId).toBe("combined-bounded-stage-context");

    const textReport = renderPluginExperimentReportText(pluginReport);
    const reportTxtPath = join(dir, "report.txt");
    writeFileSync(reportTxtPath, textReport, "utf8");
    expect(textReport.length).toBeGreaterThan(0);
    expect(textReport).toContain("Producer-Readiness Bridge");
    expect(textReport).toContain("Owner False Positives");
    expect(textReport).toContain("Truncation Classification");

    const htmlReport = renderContextStrategyComparisonV043Html(report);
    const reportHtmlPath = join(dir, "report.html");
    writeFileSync(reportHtmlPath, htmlReport, "utf8");
    expect(htmlReport.length).toBeGreaterThan(0);
    expect(htmlReport).toContain("Producer-Readiness Bridge");

    // TST-B3-052 / TST-B3-058: no composite score, rank, or winner field/value anywhere.
    // ("ranking"/"winning" legitimately appear only inside the existing neutral
    // disclaimer text, e.g. "no composite ranking or winning strategy is calculated" --
    // checked for as a field/value name, not banned as a substring of that sentence.)
    for (const forbidden of ["compositeScore", "overallScore", "aggregateScore", "readinessVerdict", "\"winner\"", "\"grade\"", "\"rank\""]) {
      expect(jsonText.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(textReport.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(htmlReport.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
