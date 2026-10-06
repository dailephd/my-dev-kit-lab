import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RETRIEVAL_QUERY_STRATEGY_IDS, type RetrievalQueryStrategyId } from "../../../src/evaluation/retrievalQueryStrategies.js";
import type { RetrievalQueryStrategyEvidenceV1 } from "../../../src/evaluation/retrievalQueryStrategyEvidence.js";
import type { ExperimentRun, ExperimentTarget } from "../../../src/experiments/index.js";
import {
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_METHODOLOGY,
  analyzeRetrievalQueryStrategyComparison,
  mapRetrievalQueryStrategyComparisonToRun,
  projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence as projectAnalysis,
  projectRetrievalQueryStrategyExecutionForExternalLocalPersistence,
  retrievalQueryStrategyComparisonMetadata,
  type RetrievalQueryStrategyComparisonAnalysisV1,
  type RetrievalQueryStrategyComparisonCaseEvidenceV1,
  type RetrievalQueryStrategyComparisonRun,
  type RetrievalQueryStrategyTreatmentEvidenceV1
} from "../../../src/experiments/plugins/retrievalQueryStrategyComparison/index.js";
import { projectExternalLocalTarget, projectRunForExternalLocalPersistence } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectPrivacy.js";
import {
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_LIMITATIONS,
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT_SCHEMA_VERSION,
  buildPluginExperimentReport,
  buildRetrievalQueryStrategyComparisonReport,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
  renderRetrievalQueryStrategyComparisonHtml,
  renderRetrievalQueryStrategyComparisonTextLines,
  writePluginExperimentReports,
  type RetrievalQueryStrategyComparisonReportV1
} from "../../../src/report/experiments/index.js";
import { makeEvaluationCase } from "../../experiments/retrievalPrecisionRecall/retrievalPrecisionRecallTestHelpers.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const selfTarget = (): ExperimentTarget => ({
  kind: "self",
  targetRoot: process.cwd(),
  toolRoot: process.cwd(),
  packageName: null,
  packageVersion: null,
  hasPackageJson: true,
  hasLockfile: true,
  branch: null,
  commit: null,
  hasGit: true,
  isSelf: true
});

function evidence(strategyId: RetrievalQueryStrategyId, files: string[], symbols: Array<{ name: string; file: string }>): RetrievalQueryStrategyEvidenceV1 {
  return {
    schemaVersion: "retrieval-query-strategy-evidence-v1",
    strategyId,
    availability: "available",
    availabilityReason: null,
    files: files.map((file) => ({ path: file })),
    symbols: symbols.map((symbol) => ({ name: symbol.name, nodeId: `node:${symbol.file}#${symbol.name}`, file: symbol.file })),
    steps: [{ kind: "search", succeeded: true, evidenceAvailable: true, reason: null }]
  };
}

function treatment(
  strategyId: RetrievalQueryStrategyId,
  files: string[],
  symbols: Array<{ name: string; file: string }>,
  tokens: number
): RetrievalQueryStrategyTreatmentEvidenceV1 {
  const data = evidence(strategyId, files, symbols);
  return {
    strategyId,
    status: "completed",
    retrieval: {
      skipped: false,
      durationMs: 1,
      totalEstimatedTokens: tokens,
      tokenCountMethod: "estimated_chars_div_4",
      warnings: ["raw warning WARNING_SENTINEL_77"],
      evidenceAvailability: "available",
      evidenceAvailabilityReason: null,
      retrievedFileCount: files.length,
      retrievedSymbolCount: symbols.length,
      steps: data.steps
    },
    evidence: data,
    errors: []
  };
}

/** Three cases: localized, cross-module, and one with unknown locality; keyword-search is cheapest so it dominates. */
function fixtureRun(options: { target?: ExperimentTarget } = {}) {
  const cases = [
    makeEvaluationCase({ id: "loc-1", locality: "localized" }),
    makeEvaluationCase({ id: "xm-1", locality: "cross-module" }),
    { ...makeEvaluationCase({ id: "nul-1" }), taskLocality: undefined }
  ];
  const execution: RetrievalQueryStrategyComparisonCaseEvidenceV1[] = cases.map((evaluationCase) => ({
    caseId: evaluationCase.id,
    caseName: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    taskLocality: evaluationCase.taskLocality ?? null,
    treatments: RETRIEVAL_QUERY_STRATEGY_IDS.map((strategyId, index) =>
      treatment(
        strategyId,
        ["src/a.ts", "src/b.ts"],
        [
          { name: "A", file: "src/a.ts" },
          { name: "B", file: "src/b.ts" }
        ],
        100 + index
      )
    )
  }));
  const analysis = analyzeRetrievalQueryStrategyComparison(cases, execution);
  const run = mapRetrievalQueryStrategyComparisonToRun({
    runId: "run-report",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    target: options.target ?? selfTarget(),
    caseEvidence: execution,
    analysis,
    executionArtifactPath: "retrieval-query-strategy-comparison-execution.json",
    analysisArtifactPath: "retrieval-query-strategy-comparison-analysis.json"
  });
  return { cases, execution, analysis, run };
}

const reportOf = (run: ExperimentRun): RetrievalQueryStrategyComparisonReportV1 => {
  const report = buildRetrievalQueryStrategyComparisonReport(run);
  if (report === null) throw new Error("expected a specialized report");
  return report;
};

describe("specialized report section", () => {
  it("TST-081-101 builds the typed section with schema, order, scopes and cases", () => {
    const { run } = fixtureRun();
    const report = reportOf(run);
    expect(report.schemaVersion).toBe("my-dev-kit-lab-retrieval-query-strategy-comparison-report-v1");
    expect(report.schemaVersion).toBe(RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT_SCHEMA_VERSION);
    expect(report.strategyOrder).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
    expect(report.scopes.map((scope) => scope.scopeId)).toEqual(["overall", "localized", "cross-module", "broad-change"]);
    expect(report.cases.map((entry) => entry.caseId)).toEqual(["loc-1", "xm-1", "nul-1"]);
    for (const entry of report.cases) expect(entry.treatments.map((t) => t.strategyId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
    expect(report.methodology).toEqual(RETRIEVAL_QUERY_STRATEGY_COMPARISON_METHODOLOGY);
    expect(report.methodology).not.toBe(RETRIEVAL_QUERY_STRATEGY_COMPARISON_METHODOLOGY);
    expect(report.limitations).toEqual([...RETRIEVAL_QUERY_STRATEGY_COMPARISON_LIMITATIONS]);
    expect(report.identityRedaction).toBeNull();
    expect(report.cases[0].treatments[0]).toMatchObject({
      executionStatus: "completed",
      evidenceAvailability: "available",
      retrievedTokenCount: 100,
      tokenCountMethod: "estimated_chars_div_4"
    });
    expect(report.cases[0].treatments[0].fileF1).toEqual({ availability: "available", numerator: 4, denominator: 4, value: 1, reason: null });
  });

  it("returns null for other plugins and failed runs without analysis, and rejects broken sources", () => {
    const { run, analysis } = fixtureRun();
    expect(buildRetrievalQueryStrategyComparisonReport({ ...run, pluginId: "retrieval-precision-recall" })).toBeNull();
    const failedNoAnalysis = { ...run, status: "failed" } as Record<string, unknown>;
    delete failedNoAnalysis.analysis;
    delete failedNoAnalysis.caseExecutionEvidence;
    expect(buildRetrievalQueryStrategyComparisonReport(failedNoAnalysis as unknown as ExperimentRun)).toBeNull();
    const missing = { ...run } as Record<string, unknown>;
    delete missing.analysis;
    expect(() => buildRetrievalQueryStrategyComparisonReport(missing as unknown as ExperimentRun)).toThrow(
      "Invalid retrieval-query-strategy-comparison report source: execution evidence and analysis are required."
    );
    const reordered = { ...run, analysis: { ...analysis, cases: [...analysis.cases].reverse() } } as ExperimentRun;
    expect(() => buildRetrievalQueryStrategyComparisonReport(reordered)).toThrow(
      "Invalid retrieval-query-strategy-comparison report source: execution evidence and analysis are inconsistent."
    );
    const swapped = structuredClone(run) as RetrievalQueryStrategyComparisonRun;
    swapped.analysis.cases[0].treatments.reverse();
    expect(() => buildRetrievalQueryStrategyComparisonReport(swapped)).toThrow("inconsistent");
  });

  it("TST-081-102 presents precomputed analysis values and never recalculates them", () => {
    const { run } = fixtureRun();
    const mutated = structuredClone(run) as RetrievalQueryStrategyComparisonRun;
    // Distinctive values that no recalculation from the evidence could produce.
    const overall = mutated.analysis.scopes[0];
    overall.strategySummaries[2].objectives = { meanFileF1: 0.123456, meanSymbolF1: 0.654321, meanFactCoverage: 0.111111, meanRetrievedTokenCount: 4242.5 };
    overall.bestStrategyId = "graph-neighborhood";
    overall.paretoFrontStrategyIds = ["graph-neighborhood"];
    overall.interpretation = "unique-best";
    mutated.analysis.cases[0].treatments[3].fileF1 = { availability: "available", numerator: 7, denominator: 9, value: 0.987654, reason: null };
    const report = reportOf(mutated);
    expect(report.scopes[0]).toEqual(mutated.analysis.scopes[0]);
    expect(report.scopes[0].strategySummaries[2].objectives).toEqual({ meanFileF1: 0.123456, meanSymbolF1: 0.654321, meanFactCoverage: 0.111111, meanRetrievedTokenCount: 4242.5 });
    expect(report.cases[0].treatments[3].fileF1).toEqual({ availability: "available", numerator: 7, denominator: 9, value: 0.987654, reason: null });

    // Changing only the execution identities leaves every scientific value untouched.
    const before = reportOf(run);
    const changed = structuredClone(run) as RetrievalQueryStrategyComparisonRun;
    for (const entry of changed.caseExecutionEvidence) {
      for (const item of entry.treatments) {
        if (item.evidence) item.evidence.files = [{ path: "src/zzz.ts" }];
      }
    }
    const after = reportOf(changed);
    expect(after.scopes).toEqual(before.scopes);
    expect(after.cases).toEqual(before.cases);
  });

  it("TST-081-103 preserves unique-best, tradeoff and unavailable scopes without tie breaking", () => {
    const { run } = fixtureRun();
    const mutated = structuredClone(run) as RetrievalQueryStrategyComparisonRun;
    const [, localized, crossModule, broad] = mutated.analysis.scopes;
    localized.interpretation = "unique-best";
    localized.bestStrategyId = "source-slice";
    localized.paretoFrontStrategyIds = ["source-slice"];
    crossModule.interpretation = "tradeoff";
    crossModule.bestStrategyId = null;
    crossModule.paretoFrontStrategyIds = ["symbol-lookup", "combined-graph-guided"];
    broad.interpretation = "unavailable";
    broad.bestStrategyId = null;
    broad.paretoFrontStrategyIds = [];
    const scopes = reportOf(mutated).scopes;
    expect(scopes[1]).toMatchObject({ scopeId: "localized", interpretation: "unique-best", bestStrategyId: "source-slice", paretoFrontStrategyIds: ["source-slice"] });
    expect(scopes[2]).toMatchObject({ scopeId: "cross-module", interpretation: "tradeoff", bestStrategyId: null, paretoFrontStrategyIds: ["symbol-lookup", "combined-graph-guided"] });
    expect(scopes[3]).toMatchObject({ scopeId: "broad-change", interpretation: "unavailable", bestStrategyId: null, paretoFrontStrategyIds: [] });
    // The overall interpretation sentence follows the overall scope only.
    const overallTradeoff = structuredClone(mutated) as RetrievalQueryStrategyComparisonRun;
    overallTradeoff.analysis.scopes[0].interpretation = "tradeoff";
    overallTradeoff.analysis.scopes[0].bestStrategyId = null;
    overallTradeoff.analysis.scopes[0].paretoFrontStrategyIds = ["keyword-search", "symbol-lookup"];
    const plugin = retrievalQueryStrategyComparisonMetadata;
    expect(buildPluginExperimentReport({ run: overallTradeoff, plugin }).interpretation.summary).toBe(
      "Overall matched comparison has no single best strategy across 3 matched case(s); the Pareto front is keyword-search, symbol-lookup. Task-type results are reported separately for localized, cross-module, and broad-change cases."
    );
    expect(buildPluginExperimentReport({ run: mutated, plugin }).interpretation.summary).toBe(
      "Overall matched comparison: keyword-search is the unique nondominated strategy across 3 matched case(s). Task-type results are reported separately for localized, cross-module, and broad-change cases."
    );
    const unavailable = structuredClone(mutated) as RetrievalQueryStrategyComparisonRun;
    unavailable.analysis.scopes[0].interpretation = "unavailable";
    const interpretation = buildPluginExperimentReport({ run: unavailable, plugin }).interpretation;
    expect(interpretation.summary).toBe(
      "No matched complete-case retrieval-strategy comparison was available for the overall scope. Review treatment availability and excluded cases before drawing conclusions."
    );
    expect(interpretation.recommendedNextStep).toBe(
      "Review the task-type scope table, Pareto fronts, and per-case treatment metrics; do not treat Pareto-front order as a ranking."
    );
  });
});

describe("HTML and text rendering", () => {
  const tradeoffRun = () => {
    const run = structuredClone(fixtureRun().run) as RetrievalQueryStrategyComparisonRun;
    run.analysis.scopes[0].interpretation = "tradeoff";
    run.analysis.scopes[0].bestStrategyId = null;
    run.analysis.scopes[0].paretoFrontStrategyIds = ["keyword-search", "symbol-lookup"];
    return run;
  };

  it("TST-081-104 both renderers carry the heading, scopes, methodology, Pareto and tradeoff wording", () => {
    const run = tradeoffRun();
    const report = buildPluginExperimentReport({ run, plugin: retrievalQueryStrategyComparisonMetadata });
    const html = renderPluginExperimentReportHtml(report);
    const text = renderPluginExperimentReportText(report);
    for (const output of [html, text]) {
      for (const expected of [
        "Retrieval Query Strategy Comparison",
        "Task-Type Comparison",
        "overall",
        "localized",
        "cross-module",
        "broad-change",
        "Pareto",
        "balanced-f1",
        "matched-complete-case-macro-mean",
        "No Single Best",
        "unique-best"
      ]) {
        expect(output, expected).toContain(expected);
      }
      expect(output).not.toMatch(/top-ranked|second-best|winner score/i);
    }
    expect(html).toContain("<th>Best Strategy</th>");
    expect(html).toContain("<th>Pareto Front</th>");
    // Placement: after Retrieval Precision/Recall and before the warnings section.
    const htmlHeading = html.indexOf("<h2>Retrieval Query Strategy Comparison</h2>");
    expect(htmlHeading).toBeGreaterThan(html.indexOf("Retrieval Precision/Recall") - 1);
    expect(htmlHeading).toBeLessThan(html.indexOf("Warnings, Skips, And Failures"));
    const textHeading = text.lastIndexOf("Retrieval Query Strategy Comparison");
    expect(textHeading).toBeGreaterThan(text.indexOf("Retrieval Precision/Recall"));
    expect(textHeading).toBeLessThan(text.indexOf("Warnings, Skips, And Failures"));
  });

  it("renders nothing for a null section in HTML and Not-applicable text for other plugins", () => {
    expect(renderRetrievalQueryStrategyComparisonHtml(null)).toBe("");
    const other = fixtureRun().run;
    const report = buildPluginExperimentReport({ run: { ...other, pluginId: "warm-index-reuse" }, plugin: { ...retrievalQueryStrategyComparisonMetadata, id: "warm-index-reuse" } });
    expect(report.retrievalQueryStrategyComparison).toBeNull();
    expect(renderPluginExperimentReportText(report)).toContain("Not applicable to this plugin.");
  });

  it("TST-081-105 renders unavailable values with their reason and real zero as 0.0000", () => {
    const section = structuredClone(reportOf(fixtureRun().run));
    const zero = { availability: "available" as const, numerator: 0, denominator: 3, value: 0, reason: null };
    const unavailable = { availability: "unavailable" as const, numerator: null, denominator: null, value: null, reason: "fact-context-mapping-unavailable" };
    section.cases[0].treatments[0].factCoverage = unavailable;
    section.cases[0].treatments[0].fileRecall = zero;
    const html = renderRetrievalQueryStrategyComparisonHtml(section);
    const text = renderRetrievalQueryStrategyComparisonTextLines(section).join("\n");
    for (const output of [html, text]) {
      expect(output).toContain("unavailable (fact-context-mapping-unavailable)");
      expect(output).toContain("0.0000");
    }
    expect(text).toContain("factCoverage=unavailable (fact-context-mapping-unavailable)");
    expect(text).toContain("fileRecall=0.0000");
    expect(text).not.toContain("factCoverage=0.0000");
    expect(html).toContain("<td>unavailable (fact-context-mapping-unavailable)</td>");
  });

  it("renders unavailable objective vectors as unavailable and keeps canonical order", () => {
    const section = structuredClone(reportOf(fixtureRun().run));
    section.scopes[3].strategySummaries.forEach((summary) => expect(summary.objectives).toBeNull());
    const html = renderRetrievalQueryStrategyComparisonHtml(section);
    expect(html).toContain("<td>unavailable</td>");
    const keyword = html.indexOf("keyword-search");
    const combined = html.indexOf("combined-graph-guided");
    expect(keyword).toBeLessThan(combined);
  });
});

describe("external-local report privacy", () => {
  const PRIVATE = { title: "PRIVATE TITLE SENTINEL", file: "private-dir/SecretFile.ts", symbol: "SecretSymbolSentinel", node: "node:private-dir/SecretFile.ts#SecretSymbolSentinel", warning: "WARNING_SENTINEL_77", fact: "secret-fact-sentinel", root: "C:\\Users\\private\\repo root" };

  function projectedRun() {
    const cases = [{ ...makeEvaluationCase({ id: "ext-1", locality: "localized", files: [PRIVATE.file, "private-dir/Other.ts"], symbols: [PRIVATE.symbol, "OtherSecret"] }), title: PRIVATE.title }];
    const answerKeyFacts = cases[0].answerKey as { expectedFacts: Array<{ id: string }>; expectedContextTargets: Array<{ factIds: string[] }> };
    answerKeyFacts.expectedFacts[0].id = PRIVATE.fact;
    answerKeyFacts.expectedContextTargets[0].factIds = [PRIVATE.fact];
    const execution: RetrievalQueryStrategyComparisonCaseEvidenceV1[] = [
      {
        caseId: "ext-1",
        caseName: PRIVATE.title,
        benchmarkProject: "subject-x",
        taskLocality: "localized",
        treatments: RETRIEVAL_QUERY_STRATEGY_IDS.map((strategyId, index) =>
          treatment(strategyId, [PRIVATE.file, "private-dir/Other.ts"], [{ name: PRIVATE.symbol, file: PRIVATE.file }, { name: "OtherSecret", file: "private-dir/Other.ts" }], 50 + index)
        )
      }
    ];
    execution[0].treatments[0].retrieval!.warnings = [`raw ${PRIVATE.warning}`];
    execution[0].treatments[0].evidence!.symbols[0].nodeId = PRIVATE.node;
    const analysis: RetrievalQueryStrategyComparisonAnalysisV1 = analyzeRetrievalQueryStrategyComparison(cases, execution);
    const projectedExecution = projectRetrievalQueryStrategyExecutionForExternalLocalPersistence(execution);
    const projectedAnalysis = projectAnalysis(analysis);
    const manifest = { logicalTargetRoot: "local-repository:subject-x", repository: { branch: "main", commit: "abc123" } };
    const target = projectExternalLocalTarget(manifest as never);
    const run = mapRetrievalQueryStrategyComparisonToRun({
      runId: "ext",
      startedAt: "s",
      completedAt: "c",
      target,
      caseEvidence: projectedExecution,
      analysis: projectedAnalysis,
      executionArtifactPath: "retrieval-query-strategy-comparison-execution.json",
      analysisArtifactPath: "retrieval-query-strategy-comparison-analysis.json"
    });
    return { run, analysis };
  }

  it("TST-081-106 the specialized report carries the redaction flag, numbers and Pareto IDs but no identities", () => {
    const { run, analysis } = projectedRun();
    const report = reportOf(run);
    expect(report.identityRedaction).toBe("external-local-redacted");
    expect(report.cases[0].caseName).toBe("<redacted case title>");
    expect(report.cases[0].treatments[0].fileF1.value).toBe(analysis.cases[0].treatments[0].fileF1.value);
    expect(report.scopes[0].paretoFrontStrategyIds).toEqual(analysis.scopes[0].paretoFrontStrategyIds);
    expect(report.scopes[0].bestStrategyId).toBe(analysis.scopes[0].bestStrategyId);
    const html = renderRetrievalQueryStrategyComparisonHtml(report);
    const text = renderRetrievalQueryStrategyComparisonTextLines(report).join("\n");
    expect(html).toContain("External-local report: private file, symbol, fact, semantic-node, warning, and case-title identities are withheld; numeric scientific results and strategy interpretations are preserved.");
    expect(text).toContain("External-local report:");
    const serialized = JSON.stringify(report) + html + text;
    for (const value of [PRIVATE.title, PRIVATE.file, PRIVATE.symbol, PRIVATE.node, PRIVATE.warning, PRIVATE.fact, PRIVATE.root, "SecretFile", "private-dir"]) {
      expect(serialized, value).not.toContain(value);
    }
  });

  it("TST-081-107 omits the bulk evidence and analysis from the report rawRun without touching the source run", () => {
    const { run } = fixtureRun();
    const before = JSON.stringify(run);
    const report = buildPluginExperimentReport({ run, plugin: retrievalQueryStrategyComparisonMetadata });
    expect(Object.keys(report.rawRun)).not.toContain("caseExecutionEvidence");
    expect(Object.keys(report.rawRun)).not.toContain("analysis");
    expect(report.retrievalQueryStrategyComparison).not.toBeNull();
    expect(JSON.stringify(run)).toBe(before);
    expect(Object.keys(run)).toContain("caseExecutionEvidence");
    expect(Object.keys(run)).toContain("analysis");
  });

  it("TST-081-114 the generic writer produces report.json, report.html and report.txt for the plugin", async () => {
    expect(retrievalQueryStrategyComparisonMetadata.supportedOutputs).toEqual(["json", "html", "text", "artifact"]);
    const out = mkdtempSync(path.join(os.tmpdir(), "rqs-report-"));
    tempDirs.push(out);
    const { run } = fixtureRun();
    const written = await writePluginExperimentReports({ run, plugin: retrievalQueryStrategyComparisonMetadata, outputRoot: out });
    const json = JSON.parse(readFileSync(written.outputPaths.jsonPath, "utf8"));
    expect(json.report.retrievalQueryStrategyComparison.schemaVersion).toBe(RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT_SCHEMA_VERSION);
    expect(readFileSync(written.outputPaths.htmlPath, "utf8")).toContain("Retrieval Query Strategy Comparison");
    expect(readFileSync(written.outputPaths.textPath, "utf8")).toContain("Task-Type Comparison");
  });

  it("TST-081-115 redactOutputRoot serializes no physical path and the analysis artifact path is a basename", async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "rqs-report-redact-"));
    tempDirs.push(out);
    const { run } = fixtureRun();
    const physical = { ...run, metadata: { ...run.metadata, outputRoot: out, analysisArtifactPath: path.join(out, "retrieval-query-strategy-comparison-analysis.json"), executionArtifactPath: path.join(out, "retrieval-query-strategy-comparison-execution.json") } };
    const projected = projectRunForExternalLocalPersistence(physical, projectExternalLocalTarget({ logicalTargetRoot: "local-repository:x", repository: { branch: null, commit: null } } as never));
    expect(projected.metadata?.analysisArtifactPath).toBe("retrieval-query-strategy-comparison-analysis.json");
    expect(projected.metadata?.executionArtifactPath).toBe("retrieval-query-strategy-comparison-execution.json");
    expect(projected.metadata?.outputRoot).toBe("[redacted]");
    const written = await writePluginExperimentReports({ run: projected, plugin: retrievalQueryStrategyComparisonMetadata, outputRoot: out, redactOutputRoot: true });
    const serializedJson = JSON.parse(readFileSync(path.join(out, "report.json"), "utf8"));
    expect(serializedJson.outputPaths).toEqual({ outDir: "[redacted]", jsonPath: "report.json", htmlPath: "report.html", textPath: "report.txt" });
    expect(serializedJson.report.metadata.outputRoot).toBe("[redacted]");
    expect(written.report.metadata.outputRoot).toBe("[redacted]");
    const files = ["report.json", "report.html", "report.txt"].map((name) => readFileSync(path.join(out, name), "utf8")).join("\n");
    expect(files).not.toContain(out);
    expect(files).not.toContain(out.replace(/\\/g, "/"));
  });
});
