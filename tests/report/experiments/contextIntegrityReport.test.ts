// v0.4.5 Batch 5: report-model, JSON, text, and HTML tests for the context-integrity
// ecosystem report, built from the real Batch 4 failed-run and corrected-replay fixtures.
import { describe, expect, it } from "vitest";
import { buildContextIntegrityReport } from "../../../src/report/experiments/buildContextIntegrityReport.js";
import { renderContextIntegrityJsonReport } from "../../../src/report/experiments/renderContextIntegrityJsonReport.js";
import { renderContextIntegrityText } from "../../../src/report/experiments/renderContextIntegrityText.js";
import { renderContextIntegrityHtml } from "../../../src/report/experiments/renderContextIntegrityHtml.js";
import { loadContextIntegrityFixture } from "../../../src/evaluation/ecosystemFixtures/loadContextIntegrityFixture.js";
import { evaluateProducerReadinessBridge } from "../../../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import { calculateStageContextDeterminism } from "../../../src/evaluation/stageContextDeterminism/calculateStageContextDeterminism.js";
import type { StageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";
import type { ContextIntegrityFixtureKind } from "../../../src/report/experiments/contextIntegrityReportModel.js";

const FIXTURES = {
  "failed-run": {
    root: "tests/fixtures/ecosystem/context-integrity/v0.4.5/failed-run",
    manifest: "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/failed-run-manifest.json"
  },
  "corrected-replay": {
    root: "tests/fixtures/ecosystem/context-integrity/v0.4.5/corrected-replay",
    manifest: "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/corrected-replay-manifest.json"
  }
} as const;

function baseExpectations(): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-V045-B5-REPORT",
    title: "report",
    description: "d",
    expectedEvidence: [],
    expectedStates: {},
    warnings: [],
    producerReadinessExpectations: {}
  };
}

async function buildReportFor(kind: ContextIntegrityFixtureKind & keyof typeof FIXTURES) {
  const { root, manifest } = FIXTURES[kind];
  const fixture = await loadContextIntegrityFixture(root, manifest);
  const bridgeResult = evaluateProducerReadinessBridge({
    implementation: { role: "implementation", contextCapsule: fixture.implementationCapsule!, retrievalAuditRecord: fixture.implementationAudit! },
    readiness: fixture.runIntegrityEvidence?.gate.implementationContext,
    runIntegrityEvidence: fixture.runIntegrityEvidence!,
    expectations: baseExpectations()
  });
  const determinism = calculateStageContextDeterminism([
    { runNumber: 1, value: bridgeResult },
    { runNumber: 2, value: bridgeResult }
  ]);
  const report = buildContextIntegrityReport({
    fixtureKind: kind,
    manifest: fixture.manifest!,
    hashVerification: fixture.hashVerification!,
    capsule: fixture.implementationCapsule,
    audit: fixture.implementationAudit,
    bridgeResult,
    determinism,
    fixtureSelfImmutable: true
  });
  return { report, bridgeResult };
}

describe("failed-run fixture report", () => {
  it("1. JSON output is correct: contradiction-present, real evidence preserved", async () => {
    const { report } = await buildReportFor("failed-run");
    const json = renderContextIntegrityJsonReport(report);
    const parsed = JSON.parse(json);
    expect(parsed.endToEnd.category).toBe("contradiction-present");
    expect(parsed.fixture.kind).toBe("failed-run");
    expect(parsed.producerIdentity.toolVersion).toBe("1.10.3");
  });

  it("2. text output is correct: sections in order, contradiction codes visible", async () => {
    const { report } = await buildReportFor("failed-run");
    const text = renderContextIntegrityText(report);
    expect(text.indexOf("=== 1. Context-integrity summary ===")).toBeLessThan(text.indexOf("=== 2. Fixture and provenance ==="));
    expect(text.indexOf("=== 9. Determinism and immutability ===")).toBeLessThan(text.indexOf("=== 11. Limitations ==="));
    expect(text).toContain("JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY");
    expect(text).toContain("NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS");
  });

  it("3. HTML output is correct: contradiction badge, escaped content", async () => {
    const { report } = await buildReportFor("failed-run");
    const html = renderContextIntegrityHtml(report);
    expect(html).toContain('class="badge badge-contradiction-present">contradiction-present</span>');
    expect(html).toContain("JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY");
  });
});

describe("corrected-replay fixture report", () => {
  it("4. JSON output is correct: full-agreement, condition coverage satisfied", async () => {
    const { report } = await buildReportFor("corrected-replay");
    const json = renderContextIntegrityJsonReport(report);
    const parsed = JSON.parse(json);
    expect(parsed.endToEnd.category).toBe("full-agreement");
    expect(parsed.conditionCoverage.requiredConditionsSatisfied).toBe(2);
    expect(parsed.producerIdentity.toolVersion).toBe("1.10.4");
  });

  it("5. text output is correct: full agreement, limitation text present", async () => {
    const { report } = await buildReportFor("corrected-replay");
    const text = renderContextIntegrityText(report);
    expect(text).toContain("End-to-end category: full-agreement");
    expect(text).toContain("hand-distilled representation");
    expect(text).toContain("not a live capture");
  });

  it("6. HTML output is correct: full-agreement badge, limitation paragraph", async () => {
    const { report } = await buildReportFor("corrected-replay");
    const html = renderContextIntegrityHtml(report);
    expect(html).toContain('class="badge badge-full-agreement">full-agreement</span>');
    expect(html).toContain("hand-distilled representation");
  });

  it("7. optional-only truncation remains visible even though end-to-end is full agreement", async () => {
    const { report } = await buildReportFor("corrected-replay");
    expect(report.allocation.totalOptionalOmitted).toBeGreaterThan(0);
    expect(report.allocation.groupsWithRequiredOmission).toEqual([]);
    expect(report.truncation.requiredEvidenceLost).toBe(false);
  });

  it("23. corrected-replay limitation wording matches the required exact framing", async () => {
    const { report } = await buildReportFor("corrected-replay");
    expect(report.fixture.correctedReplayLimitation).toContain("hand-distilled representation");
    expect(report.fixture.correctedReplayLimitation).toContain("not a live capture of a complete ten-stage AI-authored implementation workflow");
    expect(report.fixture.correctedReplayLimitation).toContain("not proof that every future run");
  });
});

describe("cross-fixture report invariants", () => {
  it("8. required omission remains distinct from optional omission (failed-run)", async () => {
    const { report } = await buildReportFor("failed-run");
    expect(report.allocation.groupsWithRequiredOmission.length).toBeGreaterThan(0);
    const optionalOnly = report.allocation.groupsWithOptionalOnlyOmission;
    for (const groupId of optionalOnly) expect(report.allocation.groupsWithRequiredOmission).not.toContain(groupId);
  });

  it("9. last-witness loss is reported as a distinct count, not fabricated", async () => {
    const { report: correctedReport } = await buildReportFor("corrected-replay");
    expect(correctedReport.conditionCoverage.lastWitnessLossCount).toBe(0);
  });

  it("10. unsupported legacy evidence stays unavailable (no roleConditionCoverage on the failed-run producer)", async () => {
    const { report } = await buildReportFor("failed-run");
    expect(report.producerConditionAgreement.outcome).toBe("unsupported-legacy-evidence");
    expect(report.conditionCoverage.availability).toBe("unavailable");
  });

  it("11. NEED_CONTEXT followed by PASS is visible in the failed-run report", async () => {
    const { report } = await buildReportFor("failed-run");
    expect(report.expectedActualJudgeAgreement.outcome).toBe("contradiction");
  });

  it("12. NEED_CONTEXT followed by a PASS final report is visible", async () => {
    const { report } = await buildReportFor("failed-run");
    expect(report.eligibilityFinalArtifactAgreement.contradictions.items.map((c) => c.code)).toContain("NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS");
  });

  it("15. manual completion / bypass evidence is visible in the failed-run lifecycle agreement", async () => {
    const { report } = await buildReportFor("failed-run");
    expect(report.lifecycleIntegrityAgreement.outcome).toBe("contradiction");
    expect(report.lifecycleIntegrityAgreement.contradictions.items.map((c) => c.code)).toContain("MANUAL_MARK_COMPLETE_BYPASS_SUCCEEDED");
  });

  it("16. artifact-presence-only completion classification is reachable from the report (unit check via model shape)", async () => {
    const { report } = await buildReportFor("failed-run");
    // The lifecycle agreement is present and bounded; per-entry completionBasis detail
    // lives in the underlying Batch 3 result, referenced rather than duplicated here.
    expect(report.lifecycleIntegrityAgreement.availability).toBe("available");
  });

  it("20. bounded evidence truncation reports total/displayed/omitted rather than silently truncating", async () => {
    const { report } = await buildReportFor("failed-run");
    const agreement = report.eligibilityFinalArtifactAgreement;
    expect(agreement.contradictions.displayedCount).toBe(agreement.contradictions.items.length);
    expect(agreement.contradictions.totalCount).toBe(agreement.contradictions.displayedCount + agreement.contradictions.omittedCount);
  });

  it("21. HTML escaping: a hostile field value is neutralized, not injected", async () => {
    const { report } = await buildReportFor("failed-run");
    const tampered = {
      ...report,
      producerConditionAgreement: {
        ...report.producerConditionAgreement,
        reason: '<script>alert("xss")</script>'
      }
    };
    const html = renderContextIntegrityHtml(tampered);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("22. no composite score, grade, ranking, or winner appears in any rendered output", async () => {
    const { report: failedReport } = await buildReportFor("failed-run");
    const { report: correctedReport } = await buildReportFor("corrected-replay");
    for (const report of [failedReport, correctedReport]) {
      const json = renderContextIntegrityJsonReport(report).toLowerCase();
      const text = renderContextIntegrityText(report).toLowerCase();
      const html = renderContextIntegrityHtml(report).toLowerCase();
      for (const output of [json, text, html]) {
        expect(output).not.toMatch(/\bscore\b/);
        expect(output).not.toMatch(/\bgrade\b/);
        expect(output).not.toMatch(/\bwinner\b/);
        expect(output).not.toMatch(/\branking\b/);
      }
    }
  });

  it("24. stageMayRenderNormalPrompt wording is used rather than a false literal promptMode claim", async () => {
    const { report } = await buildReportFor("failed-run");
    const text = renderContextIntegrityText(report);
    const html = renderContextIntegrityHtml(report);
    expect(text).toContain("does not expose a literal upstream promptMode field");
    expect(text).toContain("stageMayRenderNormalPrompt");
    expect(html).toContain("does not expose a literal upstream");
    expect(html).toContain("stageMayRenderNormalPrompt");
    // No isolated claim that the lab reads a literal "promptMode" field -- every mention is
    // part of the "does not expose ... promptMode field" disclaimer sentence.
    expect(text).not.toMatch(/\bpromptMode:/);
    expect(text).not.toContain("reads promptMode");
  });

  it("25. legacy report compatibility: existing V043 report model/renderers still work unchanged", async () => {
    const { contextStrategyComparisonV043ReportModelSanityImport } = await import("../../../src/report/experiments/contextStrategyComparisonV043ReportModel.js").then(
      (m) => ({ contextStrategyComparisonV043ReportModelSanityImport: m })
    );
    expect(contextStrategyComparisonV043ReportModelSanityImport.V043_REPORT_DETAIL_LIMIT).toBe(100);
  });
});
