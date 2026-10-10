import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExperimentRun } from "../../../src/experiments/index.js";
import { agentSuccessRateMetadata, type AgentSuccessRateRun } from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import {
  buildAgentSuccessRateReport,
  buildPluginExperimentReport,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
  safeAgentSuccessArtifactReference,
  writePluginExperimentReports,
  type PluginExperimentReport
} from "../../../src/report/experiments/index.js";
import { useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { makeTask, makeToolRoot, runAgentSuccess } from "../../experiments/agentSuccessRate/agentSuccessRateTestHelpers.js";
import { DECOY_REFERENCE_PATCH, GOOD_ANSWER, NOOP_ANSWER, makeScriptedProvider, runRepair } from "../../experiments/agentSuccessRate/repairTestHelpers.js";

useSandboxTestCleanup();

const HOSTILE_TITLE = `<script>alert("x")</script> & 'quoted'`;
const taskNamed = (id: string, overrides: Record<string, unknown> = {}) => makeTask({ id, ...overrides }, DECOY_REFERENCE_PATCH);

let realRun: AgentSuccessRateRun;
let realOutDir: string;
let deterministicRun: AgentSuccessRateRun;

beforeAll(async () => {
  const provider = makeScriptedProvider(({ caseId, attempt }) => {
    if (caseId === "case-a") return { answer: GOOD_ANSWER };
    if (caseId === "case-b") return attempt === 1 ? { answer: NOOP_ANSWER } : { answer: GOOD_ANSWER, tokens: 150 };
    return { outcome: "unavailable" };
  });
  const real = await runRepair({ tasks: [taskNamed("case-a"), taskNamed("case-b", { title: HOSTILE_TITLE }), taskNamed("case-e")], provider, repairAttempts: 2 });
  realRun = real.run;
  realOutDir = real.outDir;
  const deterministic = await runAgentSuccess({ toolRoot: makeToolRoot(), tasks: [makeTask()] });
  deterministicRun = deterministic.run;
}, 600_000);

const build = (run: ExperimentRun): PluginExperimentReport => buildPluginExperimentReport({ run, plugin: agentSuccessRateMetadata, generatedAt: "2026-01-01T00:00:00.000Z" });

describe("RPR agent-success-rate typed report section", () => {
  it("RPR-040: the report carries a typed section built from the calculated analysis only", () => {
    const report = build(realRun);
    const section = report.agentSuccessRate!;
    expect(section).toMatchObject({
      schemaVersion: "my-dev-kit-lab-agent-success-rate-report-v1",
      identity: { executionMode: "real-agent", providerId: "codex", repairAttempts: 2, maxAttemptsPerTreatment: 3, timeoutMs: 30000, caseCount: 3, treatmentOutcomeCount: 6 }
    });
    expect(section.treatments.map((treatment) => treatment.treatmentId)).toEqual(["raw-full-file", "context-pack"]);
    expect(section.cases.map((entry) => entry.caseId)).toEqual(["case-a", "case-b", "case-e"]);
    // values are the plugin's own: initial and final success are separate measurements
    const rawAggregate = realRun.analysis.aggregates[0]!;
    expect(section.treatments[0]!.initialSuccessRate.value).toBe(rawAggregate.repair!.initialAttemptSuccessRate.value);
    expect(section.treatments[0]!.finalSuccessRate.value).toBe(rawAggregate.repair!.finalTaskSuccessRate.value);
    expect(section.treatments[0]).toMatchObject({ evaluableCases: 2, initialSuccessfulCases: 1, finalSuccessfulCases: 2 });
    expect(section.treatments[0]!.repair).toMatchObject({ repairEligibleCases: 1, repairAttemptedCases: 1, repairedCases: 1, repairAttempts: 1 });
    // the bulk evidence stays in the dedicated artifacts, not in the raw run embedded in the report
    expect((report.rawRun as Record<string, unknown>).caseExecutionEvidence).toBeUndefined();
    expect((report.rawRun as Record<string, unknown>).analysis).toBeUndefined();
    expect(report.interpretation.summary).toContain("descriptive matched comparison");
  });

  it("RPR-048: other plugins get no agent-success-rate section and their rendering is unchanged", () => {
    const other: ExperimentRun = { ...deterministicRun, pluginId: "context-strategy-comparison" };
    delete (other as Record<string, unknown>).analysis;
    delete (other as Record<string, unknown>).caseExecutionEvidence;
    expect(buildAgentSuccessRateReport(other)).toBeNull();
    const report = buildPluginExperimentReport({ run: other, plugin: { ...agentSuccessRateMetadata, id: "context-strategy-comparison" } });
    expect(report.agentSuccessRate).toBeNull();
    expect(renderPluginExperimentReportHtml(report)).not.toContain('id="agent-success-rate"');
    expect(renderPluginExperimentReportText(report)).not.toContain("AGENT SUCCESS RATE");
    // a missing section object (older report literals) renders as before
    const legacy = { ...report } as Record<string, unknown>;
    delete legacy.agentSuccessRate;
    expect(renderPluginExperimentReportHtml(legacy as unknown as PluginExperimentReport)).not.toContain("agent-success-rate-cases");
  });

  it("RPR-041: the HTML report shows initial and final success separately and keeps the failed first attempt visible", () => {
    const html = renderPluginExperimentReportHtml(build(realRun));
    expect(html).toContain("Initial task success");
    expect(html).toContain("Final task success");
    expect(html).toContain("Initial success rate");
    expect(html).toContain("Final success rate");
    const row = /<tr>(?:(?!<\/tr>).)*case-b(?:(?!<\/tr>).)*raw-full-file(?:(?!<\/tr>).)*<\/tr>/s.exec(html.slice(html.indexOf("agent-success-rate-cases")));
    expect(row, "case-b raw-full-file row").not.toBeNull();
    const cells = [...row![0].matchAll(/<td>(.*?)<\/td>/gs)].map((match) => match[1]);
    expect(cells[5]).toBe("no"); // initial
    expect(cells[6]).toBe("yes"); // final
    expect(cells[7]).toBe("2"); // attempts
  });

  it("RPR-042: the text report contains the per-attempt repair history for executed attempts only", () => {
    const text = renderPluginExperimentReportText(build(realRun));
    const history = text.slice(text.indexOf("G. Per-attempt repair history"), text.indexOf("H. Edit-quality"));
    expect(history).toContain("Case case-b / raw-full-file: 2 attempt(s)");
    expect(history).toContain("attempt 1: provider=completed; patch=success; verification=available; task success=no; outcome=task-check-failed (repair-eligible)");
    expect(history).toContain("attempt 2: provider=completed; patch=success; verification=available; task success=yes; outcome=none");
    expect(history).not.toContain("attempt 3");
    expect(history).toContain("Case case-a / raw-full-file: 1 attempt(s)");
    expect(history).toContain("diffs/fixture/case-b/raw-full-file/attempt-1-proposed.patch");
    expect(history).toContain("diffs/fixture/case-b/raw-full-file/attempt-2-applied.patch");
    // section order follows the documented hierarchy
    const order = ["A. Experiment identity", "B. Execution mode and provider", "C. Scientific limitations", "D. Overall result availability", "E. Treatment comparison", "F. Per-case results", "G. Per-attempt repair history", "H. Edit-quality", "I. Duration and token evidence", "J. Warnings, failures and artifact references"];
    const positions = order.map((heading) => text.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("RPR-043: missing values are labelled and never rendered as zero", () => {
    const report = build(realRun);
    const unavailableCase = report.agentSuccessRate!.cases.find((entry) => entry.caseId === "case-e")!.treatments[0]!;
    for (const metric of [unavailableCase.initialTaskSuccess, unavailableCase.finalTaskSuccess, unavailableCase.taskCheckPassRate, unavailableCase.totalChurn, unavailableCase.finalAttemptProviderTokens]) {
      expect(metric.availability).toBe("unavailable");
      expect(metric.value).toBeNull();
      expect(metric.reason).toBeTruthy();
    }
    expect(unavailableCase.repairSucceeded.availability).toBe("not-applicable");
    const text = renderPluginExperimentReportText(report);
    const caseE = text.slice(text.indexOf("Case case-e"), text.indexOf("G. Per-attempt repair history"));
    expect(caseE).toContain("initial task success: unavailable (");
    expect(caseE).toContain("final task success: unavailable (");
    expect(caseE).not.toMatch(/task success: (0|no)\b/);
    expect(caseE).not.toMatch(/pass rate: 0(\.0+)?\b/);
    const h = text.slice(text.indexOf("H. Edit-quality"), text.indexOf("I. Duration"));
    expect(h).toMatch(/case-e \/ raw-full-file: expected-edit coverage=unavailable \(/);
    // the totals say how many cases contributed
    expect(text).toContain("contributing cases=3, measured=2, unmeasured=1");
    expect(text).toContain("(not a complete total)");
  });

  it("RPR-044/045: no winner or significance claim; the scientific limitation matches the execution mode", () => {
    const realText = renderPluginExperimentReportText(build(realRun));
    const realHtml = renderPluginExperimentReportHtml(build(realRun));
    for (const output of [realText, realHtml, JSON.stringify(build(realRun).agentSuccessRate)]) {
      expect(output).not.toMatch(/\b(is the winner|winning treatment|outperform|superior|statistically significant|p-value)\b/i);
      expect(output).not.toMatch(/"(winner|ranking|pValue|significance|compositeScore|weightedScore|best)"/);
    }
    expect(realText).toContain("The observed outcomes are a descriptive matched comparison of two source-context treatments under the selected provider.");
    expect(realText).toContain("statistical or causal effect: not-assessed (no significance or causal claim is made)");
    expect(realText).toContain("observed outcome difference between treatments: not-observed");
    expect(realText).toContain("comparison evaluable: yes");
    expect(realText).toContain("no weighted composite score and no automatic best treatment");
    expect(realHtml).toContain("Matched comparison (descriptive; no winner is declared)");

    const statement = "The fixture validates the patch evaluation pipeline and benchmark corpus. It does not measure a coding agent or the effect of context selection.";
    const detReport = build(deterministicRun);
    expect(detReport.agentSuccessRate!.scientificStatement).toBe(statement);
    expect(renderPluginExperimentReportText(detReport)).toContain(statement);
    expect(renderPluginExperimentReportHtml(detReport)).toContain(statement);
    expect(detReport.agentSuccessRate!.comparison).toBeNull();
    expect(detReport.agentSuccessRate!.repairHistory).toEqual([]);
    expect(detReport.agentSuccessRate!.treatments.every((treatment) => treatment.repair === null)).toBe(true);
  });

  it("RPR-046: reports embed no prompt, source or patch bodies and no raw command output", () => {
    const report = build(realRun);
    const outputs = [JSON.stringify(report), renderPluginExperimentReportHtml(report), renderPluginExperimentReportText(report)];
    for (const output of outputs) {
      for (const body of ["harmless comment", "module.exports.add", "Here is the fix", "Implementation Benchmark", "BEGIN_SUPPLIED_CONTEXT", "REFERENCE_PATCH_MARKER", "diff --git", "add failed"]) {
        expect(output, body).not.toContain(body);
      }
    }
  });

  it("RPR-047: dynamic values are HTML-escaped and artifact references stay inside the output directory", () => {
    const html = renderPluginExperimentReportHtml(build(realRun));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;");
    // artifact references are plain text, never links or embedded files
    expect(html.slice(html.indexOf('id="agent-success-rate"'))).not.toMatch(/<(a|img|iframe|link|script)[^>]*>/i);

    for (const unsafe of ["../outside.patch", "diffs/../../x", "/etc/passwd", "C:\\Windows\\x", "C:/Windows/x", "https://example.com/x", "file:///x", "diffs\\a.patch", "diffs//a.patch", "", "./a", "a/./b"]) {
      expect(safeAgentSuccessArtifactReference(unsafe), unsafe).toBeNull();
    }
    expect(safeAgentSuccessArtifactReference("diffs/p/c/t/attempt-2-applied.patch")).toBe("diffs/p/c/t/attempt-2-applied.patch");
    const tampered: AgentSuccessRateRun = structuredClone(realRun);
    tampered.artifacts = tampered.artifacts.map((artifact, index) => (index === 0 ? { ...artifact, path: "../../secret.json" } : artifact));
    const section = buildAgentSuccessRateReport(tampered)!;
    expect(section.artifacts[0]!.path).toBeNull();
    expect(renderPluginExperimentReportText(buildPluginExperimentReport({ run: tampered, plugin: agentSuccessRateMetadata }))).toContain("[reference withheld]");
  });

  it("writes report.json, report.html and report.txt through the existing generic writer", async () => {
    const written = await writePluginExperimentReports({ run: realRun, plugin: agentSuccessRateMetadata, outputRoot: realOutDir });
    for (const file of [written.outputPaths.jsonPath, written.outputPaths.htmlPath, written.outputPaths.textPath]) expect(existsSync(file)).toBe(true);
    const json = JSON.parse(readFileSync(written.outputPaths.jsonPath, "utf8"));
    expect(json.report.agentSuccessRate.identity.providerId).toBe("codex");
    expect(readFileSync(written.outputPaths.textPath, "utf8")).toContain("G. Per-attempt repair history");
    // the scientific artifacts stay separate files that the report only references
    const references = json.report.agentSuccessRate.artifacts.map((artifact: { path: string | null }) => artifact.path);
    expect(references).toEqual(expect.arrayContaining(["agent-success-rate-execution.json", "agent-success-rate-analysis.json"]));
  });
});
