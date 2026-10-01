import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEvaluationCases } from "../../../src/evaluation/readEvaluationCases.js";
import {
  STANDARD_CONTEXT_BUDGETS,
  contextWindowScalingMetadata,
  contextWindowScalingPlugin,
  type ContextWindowScalingRun,
} from "../../../src/experiments/plugins/contextWindowScaling/index.js";
import {
  CONTEXT_WINDOW_SCALING_INTERPRETATION,
  CONTEXT_WINDOW_SCALING_REPORT_SCHEMA_VERSION,
  MAX_REPORT_OMITTED_RELEVANT_FILES,
  buildContextWindowScalingReport,
  buildPluginExperimentReport,
  renderContextWindowScalingTextLines,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
  writePluginExperimentReports,
} from "../../../src/report/experiments/index.js";
import {
  formatContextWindowScalingPercent,
  formatContextWindowScalingScore,
} from "../../../src/report/experiments/renderContextWindowScalingText.js";
import { FAIL, PASS, caseEvidence, syntheticRun, target, treatmentEvidence } from "../../experiments/contextWindowScaling/evidenceFactory.js";

const B = [8192, 16384];
const manyExpected = Array.from({ length: 25 }, (_, i) => `src/module-${String(i).padStart(2, "0")}.ts`);

function mixedRun() {
  return syntheticRun(B, [
    caseEvidence("c1", [
      treatmentEvidence({ variantId: "raw-full-file", budgets: B, tokens: 9000, shared: PASS, expectedFiles: ["src/a.ts"], observedFiles: ["src/a.ts"] }),
      treatmentEvidence({ variantId: "my-dev-kit-guided", budgets: B, tokens: null, shared: null, expectedFiles: ["src/a.ts"] }),
    ]),
    caseEvidence("c2", [
      treatmentEvidence({ variantId: "raw-full-file", budgets: B, tokens: 100, shared: FAIL, expectedFiles: ["src/a.ts", "src/b.ts"], observedFiles: ["src/a.ts"] }),
      treatmentEvidence({ variantId: "my-dev-kit-guided", budgets: B, tokens: 50, shared: PASS, expectedFiles: [], observedFiles: [] }),
    ]),
    caseEvidence("c3", [
      treatmentEvidence({ variantId: "raw-full-file", budgets: B, tokens: 100, shared: PASS, expectedFiles: manyExpected, observedFiles: [] }),
      treatmentEvidence({ variantId: "my-dev-kit-guided", budgets: B, tokens: 12288, shared: PASS, expectedFiles: ["src/a.ts"], observedFiles: ["src/a.ts"] }),
    ]),
  ]);
}

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ctx-report-"));
  tempDirs.push(dir);
  return dir;
}

describe("context-window-scaling report model", () => {
  it("builds one typed section from the run's aggregate and evidence without recomputation", () => {
    const run = mixedRun();
    const section = buildContextWindowScalingReport(run)!;
    expect(section.schemaVersion).toBe(CONTEXT_WINDOW_SCALING_REPORT_SCHEMA_VERSION);
    expect(section.budgets).toEqual(B);
    expect(section.treatments).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    expect(section.budgetTreatmentSummaries).toEqual(run.aggregate.budgetTreatmentSummaries);
    expect(section.runSummary).toEqual(run.aggregate.runSummary);
    expect(section.caseTreatmentContexts).toHaveLength(6);
    expect(section.caseBudgetCells).toHaveLength(12);
    expect(section.tokenCountMethod).toBe("estimated_chars_div_4");
    expect(section.interpretation).toEqual([...CONTEXT_WINDOW_SCALING_INTERPRETATION]);
  });

  it("returns null for other plugins and rejects a run without evidence", () => {
    const other = { ...mixedRun(), pluginId: "warm-index-reuse" };
    expect(buildContextWindowScalingReport(other)).toBeNull();
    const broken = { ...mixedRun() } as Partial<ContextWindowScalingRun>;
    delete broken.aggregate;
    expect(() => buildContextWindowScalingReport(broken as ContextWindowScalingRun)).toThrow("Invalid context-window-scaling report source");
  });

  it("is attached to the plugin report and trims duplicated bulk evidence from rawRun", () => {
    const report = buildPluginExperimentReport({ run: mixedRun(), plugin: contextWindowScalingMetadata, outputRoot: os.tmpdir() });
    expect(report.contextWindowScaling).not.toBeNull();
    expect(report.warmIndexReuse).toBeNull();
    expect(report.incrementalChangeStaleness).toBeNull();
    expect(report.rawRun).not.toHaveProperty("executionEvidence");
    expect(report.rawRun).not.toHaveProperty("aggregate");
    expect(report.interpretation.summary).toContain("not ranked");
  });

  it("bounds the displayed omitted-file list but keeps the full count", () => {
    const section = buildContextWindowScalingReport(mixedRun())!;
    const c3 = section.caseTreatmentContexts.find((c) => c.caseId === "c3" && c.variantId === "raw-full-file")!;
    expect(c3.omittedRelevantFileCount).toBe(25);
    expect(c3.omittedRelevantFiles).toMatchObject({ totalCount: 25, displayedCount: MAX_REPORT_OMITTED_RELEVANT_FILES, omittedCount: 5, truncated: true });
    expect(c3.omittedRelevantFiles.items).toEqual(manyExpected.slice(0, MAX_REPORT_OMITTED_RELEVANT_FILES));
  });
});

describe("rendering of the synthetic mixed run", () => {
  const report = buildPluginExperimentReport({ run: mixedRun(), plugin: contextWindowScalingMetadata, outputRoot: os.tmpdir(), generatedAt: "2026-01-01T00:00:00.000Z" });
  const text = renderPluginExperimentReportText(report);
  const html = renderPluginExperimentReportHtml(report);

  it("renders headings, required interpretation limitations, and no superiority language", () => {
    expect(text).toContain("Context Window Scaling");
    expect(text).toContain("Budget Summary (one row per budget and treatment):");
    expect(html).toContain("<h2>Context Window Scaling</h2>");
    for (const item of CONTEXT_WINDOW_SCALING_INTERPRETATION) {
      expect(text).toContain(item);
    }
    expect(text).toContain("context-independent");
    expect(text).toContain("unavailable correctness is not zero");
    expect(text).toContain("not full retrieval precision or recall");
    expect(html).toContain("context-independent");
    for (const banned of [/guided (wins|is better|is safer|is optimal)/i, /full-file is bad/i, /\bsuperior\b/i]) {
      expect(text).not.toMatch(banned);
      expect(html).not.toMatch(banned);
    }
  });

  it("shows context-too-large with unavailable (never zero) correctness", () => {
    const section = report.contextWindowScaling!;
    const tooLarge = section.caseBudgetCells.find((c) => c.caseId === "c1" && c.variantId === "raw-full-file" && c.contextBudgetTokens === 8192)!;
    expect(tooLarge).toMatchObject({ contextFitStatus: "context-too-large", correctness: { availability: "unavailable", score: null, pass: null } });
    expect(text).toContain(
      "- Case: c1 | Treatment: raw-full-file | Budget: 8192 | Estimated Context Tokens: 9000 | Fit: context-too-large | Utilization: 109.86% | Evaluation: not-evaluated-context-too-large | Correctness: unavailable | Correctness Score: unavailable | Correctness Pass: unavailable | Success Evidence: available | Success: false | Success Reason: context-too-large"
    );
    expect(html).toContain("<td>not-evaluated-context-too-large</td><td>unavailable</td><td>unavailable</td><td>unavailable</td><td>available</td><td>false</td><td>context-too-large</td>");
  });

  it("makes success-unavailable evidence and the excluded denominator visible", () => {
    const guided = report.contextWindowScaling!.budgetTreatmentSummaries.find((s) => s.contextBudgetTokens === 8192 && s.variantId === "my-dev-kit-guided")!;
    expect(guided).toMatchObject({ successEvidenceUnavailableCount: 1, successEvidenceAvailableCount: 2 });
    expect(text).toContain("Success Unavailable: 1");
    expect(text).toContain("- Case: c1 | Treatment: my-dev-kit-guided | Budget: 8192 | Estimated Context Tokens: unavailable | Fit: unavailable");
    expect(text).toContain("Success Reason: context-unavailable");
  });

  it("presents bounded omitted lists with counts and truncation in both text and HTML", () => {
    expect(text).toContain("c3 / raw-full-file: omitted 25; displayed 20 of 25; omitted from display 5; truncated yes");
    expect(text).toContain(`  - ${manyExpected[0]}`);
    expect(text).not.toContain(manyExpected[24]!);
    expect(html).toContain("omitted 25; displayed 20 of 25; omitted from display 5; truncated yes");
    expect(html).not.toContain(manyExpected[24]!);
    expect(text).toContain("Total Omitted: 25".replace("25", String(report.contextWindowScaling!.relevantFileSummary.totalOmittedRelevantFileCount)));
  });

  it("states the not-applicable section for other plugins", () => {
    const generic = buildPluginExperimentReport({
      run: { ...mixedRun(), pluginId: "some-other-plugin", cases: [] },
      plugin: { ...contextWindowScalingMetadata, id: "some-other-plugin" },
      outputRoot: os.tmpdir(),
    });
    expect(generic.contextWindowScaling).toBeNull();
    expect(renderPluginExperimentReportText(generic)).toContain("Context Window Scaling\nNot applicable to this plugin.");
    expect(renderPluginExperimentReportHtml(generic)).toContain("<h2>Context Window Scaling</h2>\n    <p>Not applicable to this plugin.</p>");
  });
});

describe("fixed-corpus report files and cross-format consistency", () => {
  let run: ContextWindowScalingRun;
  let outputRoot: string;
  let json: { report: { contextWindowScaling: ReturnType<typeof buildContextWindowScalingReport> } };
  let text: string;
  let html: string;

  beforeAll(async () => {
    const cases = await readEvaluationCases(path.join(process.cwd(), "benchmarks", "contracts", "context-window-scaling-cases.json"), process.cwd());
    outputRoot = await tempDir();
    run = await contextWindowScalingPlugin.run({
      runId: "fixed-report",
      startedAt: new Date(),
      toolRoot: process.cwd(),
      target,
      outputRoot,
      config: { contextBudgets: [...STANDARD_CONTEXT_BUDGETS], kitCommand: `node ${path.join(process.cwd(), "tests", "fixtures", "fake-context-scaling-kit-cli.js")}` },
      inputs: { cases },
    });
    const written = await writePluginExperimentReports({ run, plugin: contextWindowScalingMetadata, outputRoot });
    json = JSON.parse(await readFile(written.outputPaths.jsonPath, "utf8"));
    text = await readFile(written.outputPaths.textPath, "utf8");
    html = await readFile(written.outputPaths.htmlPath, "utf8");
  }, 120_000);

  it("writes report.json, report.txt, report.html beside the execution artifact", async () => {
    for (const file of ["report.json", "report.txt", "report.html", "context-window-scaling-execution.json"]) {
      expect((await readFile(path.join(outputRoot, file), "utf8")).length).toBeGreaterThan(0);
    }
  });

  it("preserves exact unrounded aggregate values in JSON", () => {
    const section = json.report.contextWindowScaling!;
    expect(section.budgetTreatmentSummaries).toEqual(run.aggregate.budgetTreatmentSummaries);
    const raw8k = section.budgetTreatmentSummaries[0]!;
    expect(raw8k.meanContextBudgetUtilizationPercent).toBe(run.aggregate.budgetTreatmentSummaries[0]!.meanContextBudgetUtilizationPercent);
    expect(String(raw8k.meanContextBudgetUtilizationPercent).length).toBeGreaterThan(formatContextWindowScalingPercent(raw8k.meanContextBudgetUtilizationPercent).length - 1);
    expect(raw8k.successRatePercent).toBe(0);
  });

  it("agrees across JSON, text, and HTML for every budget-treatment row and cell", () => {
    const section = json.report.contextWindowScaling!;
    for (const s of section.budgetTreatmentSummaries) {
      const prefix = `- Budget: ${s.contextBudgetTokens} | Treatment: ${s.variantId} | Cells: ${s.totalCellCount} | Fits: ${s.fitCount} | Too Large: ${s.contextTooLargeCount} | Context Unavailable: ${s.contextUnavailableCount} | Success: ${s.successfulCellCount} | Not Successful: ${s.notSuccessfulCellCount} | Success Unavailable: ${s.successEvidenceUnavailableCount} | Success Rate: ${formatContextWindowScalingPercent(s.successRatePercent)} | Correctness Available: ${s.correctnessAvailableCount} | Mean Correctness: ${formatContextWindowScalingScore(s.meanCorrectnessScore)} | Mean Utilization: ${formatContextWindowScalingPercent(s.meanContextBudgetUtilizationPercent)}`;
      expect(text).toContain(prefix);
      const htmlRow = `<td>${s.contextBudgetTokens}</td><td>${s.variantId}</td><td>${s.totalCellCount}</td><td>${s.fitCount}</td><td>${s.contextTooLargeCount}</td><td>${s.contextUnavailableCount}</td><td>${s.successfulCellCount}</td><td>${s.notSuccessfulCellCount}</td><td>${s.successEvidenceUnavailableCount}</td><td>${formatContextWindowScalingPercent(s.successRatePercent)}</td><td>${s.correctnessAvailableCount}</td><td>${formatContextWindowScalingScore(s.meanCorrectnessScore)}</td><td>${formatContextWindowScalingPercent(s.meanContextBudgetUtilizationPercent)}</td>`;
      expect(html).toContain(htmlRow);
    }
    for (const c of section.caseTreatmentContexts) {
      expect(text).toContain(`- Case: ${c.caseId} | Treatment: ${c.variantId} | Context: ${c.contextStatus} | Characters: ${c.characterCount} | Estimated Tokens: ${c.estimatedTokens} | Token Method: estimated_chars_div_4 | Observed Files: ${c.observedFileCount}`);
      expect(html).toContain(`<td>${c.caseId}</td><td>${c.variantId}</td><td>${c.contextStatus}</td><td>${c.characterCount}</td><td>${c.estimatedTokens}</td>`);
    }
    expect(section.caseBudgetCells).toHaveLength(32);
    for (const cell of section.caseBudgetCells) {
      expect(text).toContain(`- Case: ${cell.caseId} | Treatment: ${cell.variantId} | Budget: ${cell.contextBudgetTokens} | Estimated Context Tokens: ${cell.contextEstimatedTokens} | Fit: ${cell.contextFitStatus}`);
    }
  });

  it("renders the same section lines through the direct renderer as in the shared report", () => {
    const lines = renderContextWindowScalingTextLines(json.report.contextWindowScaling!);
    expect(text).toContain(lines.join("\n"));
  });

  it("reports the expected fixed-corpus raw and guided rates from the model", () => {
    const rate = (variant: string) =>
      json.report.contextWindowScaling!.budgetTreatmentSummaries.filter((s) => s.variantId === variant).map((s) => s.successRatePercent);
    expect(rate("raw-full-file")).toEqual([0, 25, 50, 75]);
    expect(rate("my-dev-kit-guided")).toEqual([100, 100, 100, 100]);
    expect(text).toContain("Success Rate: 25.00%");
  });
});
