import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExperimentRun } from "../../../src/experiments/index.js";
import {
  aggregateRetrievalPrecisionRecall,
  mapRetrievalPrecisionRecallToRun,
  retrievalPrecisionRecallMetadata,
  type RetrievalPrecisionRecallRun
} from "../../../src/experiments/plugins/retrievalPrecisionRecall/index.js";
import {
  buildPluginExperimentReport,
  buildRetrievalPrecisionRecallReport,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
  RETRIEVAL_PRECISION_RECALL_REPORT_SCHEMA_VERSION
} from "../../../src/report/experiments/index.js";
import { caseEvidenceFor, evidenceOf, failedCaseEvidence, makeEvaluationCase } from "../../experiments/retrievalPrecisionRecall/retrievalPrecisionRecallTestHelpers.js";

const target = {
  kind: "self" as const,
  targetRoot: "C:\\repo",
  toolRoot: "C:\\repo",
  packageName: "x",
  packageVersion: "0.0.0",
  hasPackageJson: true,
  hasLockfile: false,
  branch: null,
  commit: null,
  hasGit: false,
  isSelf: true
};

const manyFiles = Array.from({ length: 25 }, (_, index) => `src/file-${String(index).padStart(2, "0")}.ts`);
const bigCase = makeEvaluationCase({ id: "big", project: "p1", files: manyFiles, symbols: ["A", "B"] });
const evilCase = makeEvaluationCase({
  id: "case-<b>x</b>",
  project: "p2",
  files: ["src/a.ts", "src/<img src=x onerror=alert(1)>.ts"],
  symbols: ["<script>alert(1)</script>", "Quote\"&'Symbol"]
});
const emptyCase = makeEvaluationCase({ id: "empty", project: "p2" });
const failedCase = makeEvaluationCase({ id: "failed", project: "p3" });

function buildRun(overrides: (run: RetrievalPrecisionRecallRun) => void = () => undefined): RetrievalPrecisionRecallRun {
  const caseEvidence = [
    caseEvidenceFor(bigCase, evidenceOf(["src/file-00.ts", "src/noise.ts"], [{ name: "A", file: "src/file-00.ts" }]), 777),
    caseEvidenceFor(evilCase, evidenceOf(["src/a.ts", "src/unrelated.ts"], [{ name: "Other", file: "src/a.ts" }]), 0),
    caseEvidenceFor(emptyCase, evidenceOf([]), 42),
    failedCaseEvidence(failedCase)
  ];
  const run = mapRetrievalPrecisionRecallToRun({
    runId: "run-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    target,
    caseEvidence,
    aggregate: aggregateRetrievalPrecisionRecall(caseEvidence),
    artifactPath: NATIVE_ARTIFACT_PATH
  });
  overrides(run);
  return run;
}

// Report paths are native runtime paths, so the fixture must be native to the platform running the test (it need not exist).
const NATIVE_OUTPUT_ROOT = path.resolve("rpr-report-fixture-out");
const NATIVE_ARTIFACT_PATH = path.join(NATIVE_OUTPUT_ROOT, "retrieval-precision-recall-execution.json");
const reportFor = (run: ExperimentRun) => buildPluginExperimentReport({ run, plugin: retrievalPrecisionRecallMetadata, outputRoot: NATIVE_OUTPUT_ROOT, generatedAt: "2026-01-01T00:02:00.000Z" });

describe("retrieval-precision-recall report", () => {
  it("TST-B3-027 carries a typed specialized section and leaves other plugins null", () => {
    const report = reportFor(buildRun());
    expect(report.retrievalPrecisionRecall).toMatchObject({
      schemaVersion: RETRIEVAL_PRECISION_RECALL_REPORT_SCHEMA_VERSION,
      tokenCountMethod: "estimated_chars_div_4",
      runSummary: { caseCount: 4, completedCaseCount: 3, failedCaseCount: 1 }
    });
    expect(Object.keys(report.retrievalPrecisionRecall!.ratioSummaries)).toEqual(["filePrecision", "fileRecall", "symbolPrecision", "symbolRecall", "factCoverage", "irrelevantContextRatio"]);
    expect(report.retrievalPrecisionRecall!.cases.map((entry) => entry.caseId)).toEqual(["big", "case-<b>x</b>", "empty", "failed"]);
    expect(buildRetrievalPrecisionRecallReport({ ...buildRun(), pluginId: "warm-index-reuse" })).toBeNull();
    expect(() => buildRetrievalPrecisionRecallReport({ ...buildRun(), caseExecutionEvidence: undefined } as unknown as ExperimentRun)).toThrow(/execution evidence and aggregate are required/);
    // A run that failed before producing evidence has no specialized section but still reports its failure.
    const failedRun = { ...buildRun(), status: "failed", caseExecutionEvidence: undefined, aggregate: undefined } as unknown as ExperimentRun;
    expect(buildRetrievalPrecisionRecallReport(failedRun)).toBeNull();
    expect(reportFor(failedRun).retrievalPrecisionRecall).toBeNull();
  });

  it("TST-B3-028 exposes bounded per-case missed and irrelevant identities", () => {
    const section = reportFor(buildRun()).retrievalPrecisionRecall!;
    const evil = section.cases.find((entry) => entry.caseId === "case-<b>x</b>")!;
    expect(evil.irrelevantRetrievedFiles).toEqual({ totalCount: 1, displayed: ["src/unrelated.ts"], displayedCount: 1, omittedCount: 0 });
    expect(evil.missedFiles?.displayed).toEqual(["src/<img src=x onerror=alert(1)>.ts"]);
    expect(evil.missedSymbols?.displayed).toEqual(["<script>alert(1)</script>", "Quote\"&'Symbol"].sort());
    expect(evil.irrelevantRetrievedSymbols?.displayed).toEqual(["Other"]);
    // Neither fact target symbol was retrieved, so both facts are uncovered.
    expect(evil.uncoveredFactIds?.totalCount).toBe(2);
    const failed = section.cases.find((entry) => entry.caseId === "failed")!;
    // Unavailable evidence is null, never an empty list that would read as "nothing missed".
    expect(failed).toMatchObject({ missedFiles: null, irrelevantRetrievedFiles: null, missedSymbols: null, irrelevantRetrievedSymbols: null, uncoveredFactIds: null, evidenceAvailability: null });
    expect(failed.errors).toEqual(["project-index-failed: my-dev-kit index command was unavailable or failed."]);
  });

  it("TST-B3-029 bounds long identity lists at 20 with explicit truncation metadata", () => {
    const big = reportFor(buildRun()).retrievalPrecisionRecall!.cases[0];
    expect(big.missedFiles).toEqual({
      totalCount: 24,
      displayed: manyFiles.slice(1, 21),
      displayedCount: 20,
      omittedCount: 4
    });
  });

  it("TST-B3-030 renders unavailable and not-applicable explicitly and never as numeric zero", () => {
    const run = buildRun();
    const html = renderPluginExperimentReportHtml(reportFor(run));
    const text = renderPluginExperimentReportText(reportFor(run));
    const caseLine = (name: string) => text.split("\n").find((line) => line.startsWith(`- Case: ${name} `))!;

    const empty = caseLine("empty");
    expect(empty).toContain("File precision: not-applicable (no-retrieved-files)");
    expect(empty).toContain("Irrelevant context ratio: not-applicable (no-retrieved-files)");
    expect(empty).toContain("File recall: 0.0000 (0/2)"); // a real zero is shown as a number
    const failed = caseLine("failed");
    expect(failed).toContain("File precision: unavailable (no-retrieval-measurement)");
    expect(failed).toContain("Retrieved Tokens: unavailable");
    expect(failed).not.toMatch(/: 0\.0000/);
    expect(html).toContain("not-applicable (no-retrieved-files)");
    expect(html).toContain("unavailable (no-retrieval-measurement)");
  });

  it("TST-B3-031 carries the same scientific content in HTML and text", () => {
    const report = reportFor(buildRun());
    const html = renderPluginExperimentReportHtml(report);
    const text = renderPluginExperimentReportText(report);
    const section = report.retrievalPrecisionRecall!;
    const shared = [
      "Macro Averages",
      "Retrieved Token Summary",
      "Missed And Irrelevant Occurrence Totals",
      "Per-Case Results",
      "Interpretation Limits",
      "big",
      "src/file-01.ts",
      "src/unrelated.ts",
      "src/noise.ts",
      "Other",
      "empty",
      "failed",
      "estimated_chars_div_4",
      section.ratioSummaries.filePrecision.meanValue!.toFixed(4),
      String(section.tokenSummary.totalTokens),
      "set-based measures, not ranked metrics"
    ];
    for (const needle of shared) {
      expect(html, `html: ${needle}`).toContain(needle);
      expect(text, `text: ${needle}`).toContain(needle);
    }
    for (const label of ["File precision", "File recall", "Symbol precision", "Symbol recall", "Fact coverage", "Irrelevant context ratio"]) {
      expect(html).toContain(label);
      expect(text).toContain(label);
    }
  });

  it("TST-B3-032 escapes adversarial identities in HTML and keeps text single-line", () => {
    const html = renderPluginExperimentReportHtml(reportFor(buildRun()));
    for (const raw of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "<b>x</b>"]) {
      expect(html, raw).not.toContain(raw);
    }
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Quote&quot;&amp;&#39;Symbol");

    const run = buildRun((entry) => {
      entry.caseExecutionEvidence[1].caseName = "line1\nline2\u0007";
    });
    const text = renderPluginExperimentReportText(reportFor(run));
    expect(text).not.toContain("\u0007");
  });

  it("TST-B3-033 uses neutral language and no ranking, winner or threshold interpretation", () => {
    const report = reportFor(buildRun());
    const interpretation = `${report.interpretation.summary} ${report.interpretation.recommendedNextStep}`;
    expect(interpretation).toBe(
      "Retrieval quality was measured over 4 cases (3 completed, 0 partial, 1 failed). Available case-level file, symbol and fact metrics are summarized without ranking strategies. Unavailable and not-applicable evidence is excluded from macro means rather than treated as zero. Review per-case missed and irrelevant context together with availability before drawing conclusions."
    );
    const everything = [interpretation, renderPluginExperimentReportText(report), renderPluginExperimentReportHtml(report)].join("\n").toLowerCase();
    for (const forbidden of ["winner", "best strategy", "superior", "passes", "fails quality", "pass threshold", "composite score", "overall score"]) {
      expect(everything, forbidden).not.toContain(forbidden);
    }
  });

  it("TST-B3-034 strips plugin bulk fields from rawRun while keeping the generic run fields", () => {
    const run = buildRun();
    const report = reportFor(run);
    expect(report.retrievalPrecisionRecall).not.toBeNull();
    expect("caseExecutionEvidence" in report.rawRun).toBe(false);
    expect("aggregate" in report.rawRun).toBe(false);
    expect(report.rawRun.cases).toHaveLength(4);
    expect(report.rawRun.metrics.length).toBeGreaterThan(10);
    expect(report.rawRun.artifacts).toEqual([expect.objectContaining({ id: "retrieval-precision-recall-execution", path: "retrieval-precision-recall-execution.json" })]);
    expect(report.rawRun.summary).toBeDefined();
    expect(JSON.stringify(report.rawRun)).not.toContain("missedFiles");
    // The input run is not mutated by report construction.
    expect("caseExecutionEvidence" in run).toBe(true);
  });

  it("TST-B3-026 presents the precomputed results and aggregate without recalculating them", () => {
    const run = buildRun((entry) => {
      entry.aggregate.ratios.filePrecision.meanValue = 0.123456;
      entry.aggregate.tokens.totalTokens = 987654;
      entry.aggregate.occurrences.totalMissedFileOccurrences = 4242;
      entry.caseExecutionEvidence[0].quality!.file.precision.value = 0.987654;
      entry.caseExecutionEvidence[0].quality!.file.missedFiles = ["src/only-in-the-evidence.ts"];
    });
    const section = reportFor(run).retrievalPrecisionRecall!;
    expect(section.ratioSummaries.filePrecision.meanValue).toBe(0.123456);
    expect(section.tokenSummary.totalTokens).toBe(987654);
    expect(section.occurrenceSummary.totalMissedFileOccurrences).toBe(4242);
    expect(section.cases[0].metrics.filePrecision.value).toBe(0.987654);
    expect(section.cases[0].missedFiles?.displayed).toEqual(["src/only-in-the-evidence.ts"]);
    expect(renderPluginExperimentReportText(reportFor(run))).toContain("0.1235");
  });

  it("rejects an aggregate that disagrees with the case evidence instead of presenting it", () => {
    const run = buildRun((entry) => {
      entry.aggregate.runSummary.caseCount = 99;
    });
    expect(() => reportFor(run)).toThrow(/aggregate and case execution evidence are inconsistent/);
  });
});
