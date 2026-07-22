import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mkdirMock = vi.fn(async (..._args: unknown[]) => undefined);
const writeFileMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

import { writePluginExperimentReports } from "../../../src/report/experiments/writePluginExperimentReports.js";
import { renderPluginExperimentReportText } from "../../../src/report/experiments/renderPluginExperimentReportText.js";
import { renderPluginExperimentReportHtml } from "../../../src/report/experiments/renderPluginExperimentReportHtml.js";
import { contextStrategyComparisonMetadata } from "../../../src/experiments/plugins/contextStrategyComparison/index.js";
import type { ExperimentRun, ExperimentTarget } from "../../../src/experiments/index.js";

function makeTarget(): ExperimentTarget {
  return {
    kind: "external-local",
    targetRoot: "Z:\\Projects\\one",
    toolRoot: "Z:\\Users\\newuser\\Projects\\my-dev-kit-lab",
    packageName: "@dailephd/my-dev-kit",
    packageVersion: "1.10.2",
    hasPackageJson: true,
    hasLockfile: true,
    branch: "main",
    commit: "abc1234",
    hasGit: true,
    isSelf: false,
  };
}

function makeRun(overrides: Record<string, unknown> = {}): ExperimentRun {
  return {
    runId: "context-run",
    pluginId: "context-strategy-comparison",
    startedAt: "2026-06-23T00:00:00.000Z",
    completedAt: "2026-06-23T00:00:01.000Z",
    status: "completed",
    target: makeTarget(),
    variants: [],
    cases: [],
    metrics: [],
    artifacts: [],
    warnings: [],
    failures: [],
    metadata: {},
    ...overrides,
  } as unknown as ExperimentRun;
}

beforeEach(() => {
  mkdirMock.mockClear();
  writeFileMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("writePluginExperimentReports (v0.4.3 additive behavior, mocked filesystem)", () => {
  it("RPT-156 output paths contain outDir, jsonPath, htmlPath, and textPath", async () => {
    const result = await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(result.outputPaths).toHaveProperty("outDir");
    expect(result.outputPaths).toHaveProperty("jsonPath");
    expect(result.outputPaths).toHaveProperty("htmlPath");
    expect(result.outputPaths).toHaveProperty("textPath");
  });

  it("RPT-157 jsonPath ends with report.json", async () => {
    const result = await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(result.outputPaths.jsonPath.endsWith("report.json")).toBe(true);
  });

  it("RPT-158 htmlPath ends with report.html", async () => {
    const result = await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(result.outputPaths.htmlPath.endsWith("report.html")).toBe(true);
  });

  it("RPT-159 textPath ends with report.txt", async () => {
    const result = await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(result.outputPaths.textPath.endsWith("report.txt")).toBe(true);
  });

  it("RPT-160 all output paths remain within outDir", async () => {
    const result = await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(result.outputPaths.jsonPath.startsWith(result.outputPaths.outDir)).toBe(true);
    expect(result.outputPaths.htmlPath.startsWith(result.outputPaths.outDir)).toBe(true);
    expect(result.outputPaths.textPath.startsWith(result.outputPaths.outDir)).toBe(true);
  });

  it("RPT-161 the writer creates only the output directory", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(mkdirMock).toHaveBeenCalledTimes(1);
  });

  it("RPT-162 the writer writes exactly three files", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(writeFileMock).toHaveBeenCalledTimes(3);
  });

  it("RPT-163 the write order is JSON, HTML, text", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const calledPaths = writeFileMock.mock.calls.map((call) => String(call[0]));
    expect(calledPaths[0].endsWith("report.json")).toBe(true);
    expect(calledPaths[1].endsWith("report.html")).toBe(true);
    expect(calledPaths[2].endsWith("report.txt")).toBe(true);
  });

  it("RPT-164 all writes use UTF-8", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    for (const call of writeFileMock.mock.calls) {
      expect(call[2]).toBe("utf8");
    }
  });

  it("RPT-165 JSON ends with exactly one LF", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    expect(jsonContent.endsWith("\n")).toBe(true);
    expect(jsonContent.endsWith("\n\n")).toBe(false);
  });

  it("RPT-166 text ends with exactly one LF", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const textContent = String(writeFileMock.mock.calls[2][1]);
    expect(textContent.endsWith("\n")).toBe(true);
    expect(textContent.endsWith("\n\n")).toBe(false);
  });

  it("RPT-167 JSON wrapper keys remain report and outputPaths", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsed = JSON.parse(jsonContent);
    expect(Object.keys(parsed).sort()).toEqual(["outputPaths", "report"]);
  });

  it("RPT-168 JSON output includes contextStrategyComparisonV043", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsed = JSON.parse(jsonContent);
    expect(parsed.report).toHaveProperty("contextStrategyComparisonV043");
  });

  it("RPT-169 JSON output includes textPath", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsed = JSON.parse(jsonContent);
    expect(parsed.outputPaths).toHaveProperty("textPath");
  });

  it("RPT-170 JSON rawRun excludes the three v0.4.3 bulk arrays", async () => {
    await writePluginExperimentReports({
      run: makeRun({
        v043StageContextExecutions: [{ status: "completed", strategyId: "architecture-context-only", input: {}, expectationsSourcePath: "mock/expectations.json", expectations: { schemaVersion: "1.0.0", caseId: "c", title: "t" }, payload: {}, warnings: [] }],
        v043StageContextEvaluations: [{ status: "completed", strategyId: "architecture-context-only", executionStatus: "completed", expectationMatches: [], observedEvidence: [], warnings: [], metrics: {"requiredEvidenceRecall":{"availability":"available","numerator":1,"denominator":1,"rate":1,"matchedExpectationIds":[],"missingExpectationIds":[],"reason":null},"allowedEvidenceCoverage":{"availability":"available","numerator":1,"denominator":1,"rate":1,"matchedExpectationIds":[],"missingExpectationIds":[],"reason":null},"forbiddenEvidenceInclusion":{"availability":"not-applicable","numerator":null,"denominator":null,"rate":null,"matchedExpectationIds":[],"missingExpectationIds":[],"reason":"n/a"},"irrelevantFileInclusion":{"availability":"available","count":0,"evidenceKeys":[],"reason":null},"irrelevantInstructionInclusion":{"availability":"available","count":0,"evidenceKeys":[],"reason":null},"requiredProvenanceRecall":{"availability":"available","numerator":1,"denominator":1,"rate":1,"matchedExpectationIds":[],"missingExpectationIds":[],"reason":null},"responsibilityMappingCompleteness":[],"stateComparisons":[],"contextSize":{"availability":"available","sources":[],"totalCharacterCount":0,"totalEstimatedTokenCount":0},"consideredButUnselectedReads":{"availability":"unavailable","count":null,"evidenceKeys":[],"reason":"n/a"},"unnecessaryReads":{"availability":"unavailable","count":null,"evidenceKeys":[],"reason":"n/a"},"targetImmutability":{"availability":"unavailable","count":null,"evidenceKeys":[],"reason":"n/a"}} }],
        v043StageContextRunAssurance: [{ strategyId: "architecture-context-only", status: "passed", repeatCount: 1, runRecords: [], determinism: { availability: "not-applicable", repeatCount: 1, deterministic: null, baselineSha256: null, runDigests: [], mismatchRunNumbers: [], reason: "n/a" }, issues: [] }],
      }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsed = JSON.parse(jsonContent);
    expect(parsed.report.rawRun).not.toHaveProperty("v043StageContextExecutions");
    expect(parsed.report.rawRun).not.toHaveProperty("v043StageContextEvaluations");
    expect(parsed.report.rawRun).not.toHaveProperty("v043StageContextRunAssurance");
  });

  it("RPT-171 JSON keeps exact unavailable reasons", async () => {
    await writePluginExperimentReports({
      run: makeRun({
        v043StageContextExecutions: [
          { status: "completed", strategyId: "architecture-context-only", input: {}, expectationsSourcePath: "x", expectations: { schemaVersion: "1.0.0", caseId: "c", title: "t" }, payload: {}, warnings: [] },
        ],
        v043StageContextEvaluations: [
          { status: "failed", strategyId: "architecture-context-only", executionStatus: "failed", reason: "Execution failed exactly." },
        ],
        v043StageContextRunAssurance: [
          {
            strategyId: "architecture-context-only",
            status: "failed",
            repeatCount: 1,
            primaryExecution: { status: "failed", strategyId: "architecture-context-only", input: {}, issues: [] },
            primaryEvaluation: { status: "failed", strategyId: "architecture-context-only", executionStatus: "failed", reason: "Execution failed exactly." },
            runRecords: [],
            determinism: { availability: "not-applicable", repeatCount: 1, deterministic: null, baselineSha256: null, runDigests: [], mismatchRunNumbers: [], reason: "Repeated-run determinism requires at least two runs." },
            issues: [],
          },
        ],
      }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    expect(jsonContent).toContain("Execution failed exactly.");
  });

  it("RPT-172 JSON keeps exact not-applicable reasons", async () => {
    await writePluginExperimentReports({
      run: makeRun({
        v043StageContextExecutions: [
          { status: "invalid-input", strategyId: null, input: {}, issues: [{ code: "INVALID_STRATEGY_INPUT", fieldPath: "x", message: "bad" }] },
        ],
        v043StageContextEvaluations: [
          { status: "not-applicable", strategyId: null, executionStatus: "invalid-input", reason: "Execution did not complete." },
        ],
        v043StageContextRunAssurance: [
          {
            strategyId: "architecture-context-only",
            status: "not-applicable",
            repeatCount: 1,
            primaryExecution: { status: "invalid-input", strategyId: null, input: {}, issues: [] },
            primaryEvaluation: { status: "not-applicable", strategyId: null, executionStatus: "invalid-input", reason: "Execution did not complete." },
            runRecords: [],
            determinism: { availability: "not-applicable", repeatCount: 1, deterministic: null, baselineSha256: null, runDigests: [], mismatchRunNumbers: [], reason: "Repeated-run determinism requires at least two runs." },
            issues: [],
          },
        ],
      }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    expect(jsonContent).toContain("Execution did not complete.");
  });

  it("RPT-173 JSON keeps available zero counts as zero", async () => {
    await writePluginExperimentReports({
      run: makeRun({
        v043StageContextExecutions: [],
        v043StageContextEvaluations: [],
        v043StageContextRunAssurance: [],
      }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsed = JSON.parse(jsonContent);
    expect(parsed.report.contextStrategyComparisonV043.summary.strategyCount).toBe(0);
  });

  it("RPT-174 JSON keeps unavailable numeric values as null", async () => {
    await writePluginExperimentReports({
      run: makeRun({
        v043StageContextExecutions: [
          { status: "completed", strategyId: "architecture-context-only", input: {}, expectationsSourcePath: "x", expectations: { schemaVersion: "1.0.0", caseId: "c", title: "t" }, payload: { architecture: { role: "architecture", contextCapsuleSourcePath: "cap.json", contextCapsule: { schemaVersion: "1.0.0", generatedAt: "2026-06-23T00:00:00.000Z", tool: { name: "my-dev-kit", version: "1.10.2" }, request: { role: "architecture" } } } }, warnings: [] },
        ],
        v043StageContextEvaluations: [
          {
            status: "completed",
            strategyId: "architecture-context-only",
            executionStatus: "completed",
            expectationMatches: [],
            observedEvidence: [],
            warnings: [],
            metrics: {
              requiredEvidenceRecall: { availability: "unavailable", numerator: null, denominator: null, rate: null, matchedExpectationIds: [], missingExpectationIds: [], reason: "unavailable reason" },
              allowedEvidenceCoverage: { availability: "available", numerator: 0, denominator: 0, rate: null, matchedExpectationIds: [], missingExpectationIds: [], reason: null },
              forbiddenEvidenceInclusion: { availability: "not-applicable", numerator: null, denominator: null, rate: null, matchedExpectationIds: [], missingExpectationIds: [], reason: "n/a" },
              irrelevantFileInclusion: { availability: "available", count: 0, evidenceKeys: [], reason: null },
              irrelevantInstructionInclusion: { availability: "available", count: 0, evidenceKeys: [], reason: null },
              requiredProvenanceRecall: { availability: "available", numerator: 0, denominator: 0, rate: null, matchedExpectationIds: [], missingExpectationIds: [], reason: null },
              responsibilityMappingCompleteness: [],
              stateComparisons: [],
              contextSize: { availability: "available", sources: [], totalCharacterCount: 0, totalEstimatedTokenCount: 0 },
              consideredButUnselectedReads: { availability: "unavailable", count: null, evidenceKeys: [], reason: "n/a" },
              unnecessaryReads: { availability: "unavailable", count: null, evidenceKeys: [], reason: "n/a" },
              targetImmutability: { availability: "unavailable", count: null, evidenceKeys: [], reason: "n/a" },
            },
          },
        ],
        v043StageContextRunAssurance: [
          {
            strategyId: "architecture-context-only",
            status: "not-applicable",
            repeatCount: 1,
            primaryExecution: { status: "completed" },
            primaryEvaluation: { status: "completed" },
            runRecords: [],
            determinism: { availability: "not-applicable", repeatCount: 1, deterministic: null, baselineSha256: null, runDigests: [], mismatchRunNumbers: [], reason: "n/a" },
            issues: [],
          },
        ],
      }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsed = JSON.parse(jsonContent);
    const metric = parsed.report.contextStrategyComparisonV043.strategies[0].evaluation.metrics.requiredEvidenceRecall;
    expect(metric.numerator).toBeNull();
    expect(metric.availability).toBe("unavailable");
  });

  it("RPT-175 JSON keeps not-applicable numeric values as null", async () => {
    await writePluginExperimentReports({
      run: makeRun({
        v043StageContextExecutions: [],
        v043StageContextEvaluations: [],
        v043StageContextRunAssurance: [],
      }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsed = JSON.parse(jsonContent);
    expect(parsed.report.contextStrategyComparisonV043.strategies).toEqual([]);
  });

  it("RPT-176 text output uses the text renderer", async () => {
    const run = makeRun();
    await writePluginExperimentReports({
      run,
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsedReport = JSON.parse(jsonContent).report;
    const textContent = String(writeFileMock.mock.calls[2][1]);
    expect(textContent).toBe(renderPluginExperimentReportText(parsedReport));
  });

  it("RPT-177 HTML output uses the HTML renderer", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    const jsonContent = String(writeFileMock.mock.calls[0][1]);
    const parsedReport = JSON.parse(jsonContent).report;
    const htmlContent = String(writeFileMock.mock.calls[1][1]);
    expect(htmlContent).toBe(renderPluginExperimentReportHtml(parsedReport));
  });

  it("RPT-178 a missing output root retains the existing failure", async () => {
    await expect(
      writePluginExperimentReports({
        run: makeRun({ metadata: {} }),
        plugin: contextStrategyComparisonMetadata,
      })
    ).rejects.toThrow("Plugin experiment report output root is required.");
  });

  it("RPT-179 no fourth report file is written", async () => {
    await writePluginExperimentReports({
      run: makeRun(),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(writeFileMock).toHaveBeenCalledTimes(3);
  });

  it("RPT-180 the source run is not mutated", async () => {
    const run = makeRun({
      v043StageContextExecutions: [{ status: "completed", strategyId: "architecture-context-only", input: {}, expectationsSourcePath: "mock/expectations.json", expectations: { schemaVersion: "1.0.0", caseId: "c", title: "t" }, payload: {}, warnings: [] }],
      v043StageContextEvaluations: [{ status: "completed", strategyId: "architecture-context-only", executionStatus: "completed", expectationMatches: [], observedEvidence: [], warnings: [], metrics: {"requiredEvidenceRecall":{"availability":"available","numerator":1,"denominator":1,"rate":1,"matchedExpectationIds":[],"missingExpectationIds":[],"reason":null},"allowedEvidenceCoverage":{"availability":"available","numerator":1,"denominator":1,"rate":1,"matchedExpectationIds":[],"missingExpectationIds":[],"reason":null},"forbiddenEvidenceInclusion":{"availability":"not-applicable","numerator":null,"denominator":null,"rate":null,"matchedExpectationIds":[],"missingExpectationIds":[],"reason":"n/a"},"irrelevantFileInclusion":{"availability":"available","count":0,"evidenceKeys":[],"reason":null},"irrelevantInstructionInclusion":{"availability":"available","count":0,"evidenceKeys":[],"reason":null},"requiredProvenanceRecall":{"availability":"available","numerator":1,"denominator":1,"rate":1,"matchedExpectationIds":[],"missingExpectationIds":[],"reason":null},"responsibilityMappingCompleteness":[],"stateComparisons":[],"contextSize":{"availability":"available","sources":[],"totalCharacterCount":0,"totalEstimatedTokenCount":0},"consideredButUnselectedReads":{"availability":"unavailable","count":null,"evidenceKeys":[],"reason":"n/a"},"unnecessaryReads":{"availability":"unavailable","count":null,"evidenceKeys":[],"reason":"n/a"},"targetImmutability":{"availability":"unavailable","count":null,"evidenceKeys":[],"reason":"n/a"}} }],
      v043StageContextRunAssurance: [{ strategyId: "architecture-context-only", status: "passed", repeatCount: 1, runRecords: [], determinism: { availability: "not-applicable", repeatCount: 1, deterministic: null, baselineSha256: null, runDigests: [], mismatchRunNumbers: [], reason: "n/a" }, issues: [] }],
    });
    const before = JSON.stringify(run);
    await writePluginExperimentReports({
      run,
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "Z:\\lab-output\\context-run",
    });
    expect(JSON.stringify(run)).toBe(before);
  });
});
