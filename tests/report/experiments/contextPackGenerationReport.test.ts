import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RetrievalQualityMetricsV1 } from "../../../src/evaluation/retrievalQuality/index.js";
import type { ExperimentPluginMetadata, ExperimentRun, ExperimentTarget } from "../../../src/experiments/index.js";
import type { ContextPackGenerationAnalysisV1 } from "../../../src/experiments/plugins/contextPackGeneration/analysisTypes.js";
import type { ContextPackGenerationCaseEvidenceV1 } from "../../../src/experiments/plugins/contextPackGeneration/executionTypes.js";
import { contextPackGenerationMetadata } from "../../../src/experiments/plugins/contextPackGeneration/metadata.js";
import { mapContextPackGenerationToRun } from "../../../src/experiments/plugins/contextPackGeneration/plugin.js";
import { CONTEXT_PACK_SCHEMA_VERSION, type ContextPack } from "../../../src/experiments/plugins/contextPackGeneration/types.js";
import {
  CONTEXT_PACK_GENERATION_REPORT_SCHEMA_VERSION,
  PACK_PREVIEW_MAX_CALL_RELATIONSHIPS,
  PACK_PREVIEW_MAX_EVIDENCE_NOTES,
  PACK_PREVIEW_MAX_FILES,
  PACK_PREVIEW_MAX_SOURCE_LINES_PER_SLICE,
  PACK_PREVIEW_MAX_SOURCE_SLICES,
  PACK_PREVIEW_MAX_SYMBOLS,
  PACK_PREVIEW_MAX_TESTS,
  buildContextPackGenerationReport,
  buildPluginExperimentReport,
  loadContextPackArtifacts,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
  writePluginExperimentReports
} from "../../../src/report/experiments/index.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const target: ExperimentTarget = {
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
};

const ratio = (value: number | null) =>
  value === null
    ? { availability: "unavailable" as const, numerator: null, denominator: null, value: null, reason: "missing-evidence" }
    : { availability: "available" as const, numerator: 1, denominator: 3, value, reason: null };

const quality = (coverage: number): RetrievalQualityMetricsV1 => ({
  schemaVersion: "retrieval-quality-metrics-v1",
  caseId: "case",
  evidence: { availability: "available", reason: null },
  expectations: { files: { availability: "available", reason: null }, symbols: { availability: "available", reason: null } },
  file: { relevantRetrievedFiles: [], irrelevantRetrievedFiles: [], missedFiles: [], missedFileCount: 0, precision: ratio(0.2), recall: ratio(0.3) },
  symbol: { relevantRetrievedSymbols: [], irrelevantRetrievedSymbols: [], missedSymbols: [], missedSymbolCount: 0, precision: ratio(0.4), recall: ratio(0.5) },
  fact: { coveredFactIds: [], uncoveredFactIds: [], uncoveredFactCount: 0, coverage: ratio(coverage) },
  irrelevantContextRatio: ratio(0.6),
  retrievedTokenCount: 1,
  tokenCountMethod: "chars-div-4"
});

const SECTION_IDS = ["task", "files", "symbols", "sourceSlices", "callRelationships", "tests", "evidenceNotes"] as const;

function treatmentEvidence(treatmentId: "raw-full-file" | "context-pack", caseId: string, hasPack: boolean): ContextPackGenerationCaseEvidenceV1["treatments"][number] {
  return {
    treatmentId,
    status: "completed",
    availability: "available",
    availabilityReason: null,
    size: { totalChars: 10, totalEstimatedTokens: 3, tokenCountMethod: "chars-div-4" },
    identityEvidence: null,
    includedFiles: [],
    steps: [],
    sections:
      treatmentId === "context-pack"
        ? SECTION_IDS.map((id, index) => ({ id, availability: "available" as const, reason: null, itemCount: index + 1, estimatedTokens: 10 * (index + 1) }))
        : null,
    evidenceNotes: [],
    packArtifactPath: treatmentId === "context-pack" && hasPack ? `packs/${caseId}.context-pack.json` : null,
    errors: []
  };
}

/** Distinctive values that no formula over the other fixture values would produce. */
function fixture(caseIds: string[] = ["case-a", "case-b"], hasPack = true): { caseEvidence: ContextPackGenerationCaseEvidenceV1[]; analysis: ContextPackGenerationAnalysisV1 } {
  const caseEvidence = caseIds.map((caseId) => ({
    caseId,
    caseName: `Title of ${caseId}`,
    benchmarkProject: "proj",
    taskLocality: "localized" as const,
    treatments: [treatmentEvidence("raw-full-file", caseId, hasPack), treatmentEvidence("context-pack", caseId, hasPack)]
  }));
  const analysis: ContextPackGenerationAnalysisV1 = {
    cases: caseIds.map((caseId) => ({
      caseId,
      benchmarkProject: "proj",
      taskLocality: "localized",
      treatments: [
        { treatmentId: "raw-full-file", executionStatus: "completed", availability: "available", quality: quality(0.111), fileF1: ratio(0.123), symbolF1: ratio(0.234), estimatedTokens: 9999, tokenCountMethod: "chars-div-4" },
        { treatmentId: "context-pack", executionStatus: "completed", availability: "available", quality: quality(0.777), fileF1: ratio(0.345), symbolF1: ratio(null), estimatedTokens: 1234, tokenCountMethod: "chars-div-4" }
      ],
      comparison: { fileF1Delta: 0.4242, symbolF1Delta: null, factCoverageDelta: 0.6666, estimatedTokenDelta: -7777, tokensSaved: 7777, percentSaved: 31.3131 }
    })),
    scopes: (["overall", "localized", "cross-module", "broad-change"] as const).map((scopeId) => ({
      scopeId,
      caseCount: scopeId === "overall" || scopeId === "localized" ? caseIds.length : 0,
      includedCaseCount: scopeId === "overall" ? 1 : 0,
      excludedCaseCount: scopeId === "overall" ? caseIds.length - 1 : 0,
      includedCaseIds: scopeId === "overall" ? [caseIds[0]] : [],
      excludedCaseIds: scopeId === "overall" ? caseIds.slice(1) : [],
      treatmentSummaries: (["raw-full-file", "context-pack"] as const).map((treatmentId) => ({
        treatmentId,
        completedCaseCount: caseIds.length,
        partialCaseCount: 0,
        failedCaseCount: 0,
        objectives: scopeId === "overall" ? { meanFileF1: 0.5551, meanSymbolF1: 0.5552, meanFactCoverage: 0.5553, meanEstimatedTokenCount: 4242 } : null
      })),
      pairedDeltas: scopeId === "overall" ? { meanFileF1Delta: 0.9991, meanSymbolF1Delta: 0.9992, meanFactCoverageDelta: 0.9993, meanEstimatedTokenDelta: -5151 } : null,
      tokenSavings: scopeId === "overall" ? { meanTokensSaved: 5151, percentSavedOfMeans: 61.6161 } : null
    }))
  };
  return { caseEvidence, analysis };
}

function makeRun(caseIds?: string[], hasPack = true): ExperimentRun {
  const { caseEvidence, analysis } = fixture(caseIds, hasPack);
  return mapContextPackGenerationToRun({
    runId: "run-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    target,
    caseEvidence,
    analysis,
    executionArtifactPath: path.join(process.cwd(), "out", "context-pack-generation-execution.json"),
    analysisArtifactPath: path.join(process.cwd(), "out", "context-pack-generation-analysis.json"),
    packArtifactPaths: hasPack ? caseEvidence.map((entry) => ({ caseId: entry.caseId, path: `packs/${entry.caseId}.context-pack.json` })) : []
  });
}

const provenance = [{ command: "search" as const, nodeId: null, rank: 1 }];

function makePack(caseId: string, overrides: Partial<ContextPack> = {}): ContextPack {
  const many = (n: number) => Array.from({ length: n }, (_, i) => i);
  const sourceSlices = many(5).map((i) => ({
    file: `src/f${i}.ts`,
    nodeId: null,
    symbolName: `sym${i}`,
    startLine: 1,
    endLine: 20,
    lineCount: 20,
    text: many(20).map((line) => `line ${i}.${line} <b>&"'`).join("\n"),
    boundaryKnown: i !== 1,
    truncated: i === 0,
    continuationAvailable: false,
    provenance
  }));
  return {
    schemaVersion: CONTEXT_PACK_SCHEMA_VERSION,
    caseId,
    benchmarkProject: "proj",
    taskLocality: "localized",
    task: { title: `Title <script>alert(1)</script> ${caseId}`, summary: "Find <img src=x onerror=1> thing" },
    selectionPolicy: {} as never,
    files: many(8).map((i) => ({ path: `src/file${i}.ts`, rank: i + 1, reason: "search-candidate" as const, provenance })),
    symbols: many(7).map((i) => ({ name: `symbol${i}`, nodeId: `symbol:src/file${i}.ts#symbol${i}`, file: `src/file${i}.ts`, rank: i + 1, line: i + 1, provenance })),
    sourceSlices,
    callRelationships: many(9).map((i) => ({ fromNodeId: `symbol:a${i}`, toNodeId: `symbol:b${i}`, kind: "calls" as const, provenance })),
    tests: many(8).map((i) => ({ path: `tests/t${i}<x>.test.ts`, rank: i, how: "graph-neighbor" as const, provenance })),
    evidenceNotes: [
      "symbol-end-unknown",
      "source-slice-cap-reached",
      "total-source-line-cap-reached",
      "source-slice-count-cap-reached",
      "seed-cap-reached",
      "file-cap-reached",
      "symbol-cap-reached"
    ],
    sections: [],
    size: { totalChars: 111, totalEstimatedTokens: 28, tokenCountMethod: "chars-div-4" },
    availability: "available",
    reason: null,
    renderedText: "rendered",
    ...overrides
  };
}

const packsFor = (...caseIds: string[]) => new Map(caseIds.map((id) => [id, makePack(id)]));

describe("typed report model", () => {
  it("uses the exact schema, treatment order, case order and scope order", () => {
    const section = buildContextPackGenerationReport(makeRun(["case-a", "case-b"]), packsFor("case-a", "case-b"))!;
    expect(section.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-report-v1");
    expect(CONTEXT_PACK_GENERATION_REPORT_SCHEMA_VERSION).toBe(section.schemaVersion);
    expect(section.treatmentOrder).toEqual(["raw-full-file", "context-pack"]);
    expect(section.cases.map((entry) => entry.caseId)).toEqual(["case-a", "case-b"]);
    for (const entry of section.cases) expect(entry.treatments.map((t) => t.treatmentId)).toEqual(["raw-full-file", "context-pack"]);
    expect(section.scopes.map((scope) => scope.scopeId)).toEqual(["overall", "localized", "cross-module", "broad-change"]);
    expect(section.previews.map((preview) => preview.caseId)).toEqual(["case-a", "case-b"]);
    // Structured result fields never carry a winner, ranking, composite score or Pareto front.
    const { limitations: _limitations, ...structured } = section;
    for (const forbidden of ["winner", "bestTreatment", "compositeScore", "pareto"]) expect(JSON.stringify(structured).toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it("is non-null only for context-pack-generation; every other plugin receives null", () => {
    const run = makeRun();
    const plugin = contextPackGenerationMetadata as ExperimentPluginMetadata;
    expect(buildPluginExperimentReport({ run, plugin, generatedAt: "t" }).contextPackGeneration).not.toBeNull();
    for (const pluginId of [
      "context-strategy-comparison",
      "warm-index-reuse",
      "incremental-change-staleness",
      "context-window-scaling",
      "retrieval-precision-recall",
      "retrieval-query-strategy-comparison"
    ]) {
      const other: ExperimentRun = { ...run, pluginId, metadata: undefined };
      expect(buildContextPackGenerationReport(other)).toBeNull();
      // Other plugins' builders require their own evidence; their reports are covered by their own suites.
      if (pluginId !== "context-strategy-comparison") continue;
      const report = buildPluginExperimentReport({ run: { ...other, cases: [], metrics: [], artifacts: [] }, plugin: { ...plugin, id: pluginId }, generatedAt: "t" });
      expect(report.contextPackGeneration).toBeNull();
    }
  });

  it("returns null for a failed run with no analysis and throws for a malformed non-failed run", () => {
    const run = makeRun();
    const stripped = { ...run } as Record<string, unknown>;
    delete stripped.analysis;
    expect(buildContextPackGenerationReport({ ...(stripped as ExperimentRun), status: "failed" })).toBeNull();
    expect(() => buildContextPackGenerationReport(stripped as ExperimentRun)).toThrow(/context-pack-generation report source/);
  });

  it("removes the bulk evidence from rawRun the way sibling sections do", () => {
    const report = buildPluginExperimentReport({ run: makeRun(), plugin: contextPackGenerationMetadata, generatedAt: "t" });
    expect(report.rawRun).not.toHaveProperty("caseExecutionEvidence");
    expect(report.rawRun).not.toHaveProperty("analysis");
  });
});

describe("no recalculation: persisted values are copied", () => {
  it("copies distinctive quality, token, comparison and scope values exactly", () => {
    const section = buildContextPackGenerationReport(makeRun(["case-a", "case-b"]), packsFor("case-a"))!;
    const first = section.cases[0];
    expect(first.treatments[0].fileF1.value).toBe(0.123);
    expect(first.treatments[0].factCoverage.value).toBe(0.111);
    expect(first.treatments[0].estimatedTokens).toBe(9999);
    expect(first.treatments[1].factCoverage.value).toBe(0.777);
    expect(first.treatments[1].estimatedTokens).toBe(1234);
    // 9999 - 1234 is not 7777 and 0.345 - 0.123 is not 0.4242: the report must carry the persisted delta, not a recomputation.
    expect(first.comparison).toEqual({ fileF1Delta: 0.4242, symbolF1Delta: null, factCoverageDelta: 0.6666, estimatedTokenDelta: -7777, tokensSaved: 7777, percentSaved: 31.3131 });
    const overall = section.scopes[0];
    expect(overall.includedCaseIds).toEqual(["case-a"]);
    expect(overall.excludedCaseIds).toEqual(["case-b"]);
    expect(overall.treatmentSummaries[0].objectives).toEqual({ meanFileF1: 0.5551, meanSymbolF1: 0.5552, meanFactCoverage: 0.5553, meanEstimatedTokenCount: 4242 });
    expect(overall.pairedDeltas).toEqual({ meanFileF1Delta: 0.9991, meanSymbolF1Delta: 0.9992, meanFactCoverageDelta: 0.9993, meanEstimatedTokenDelta: -5151 });
    expect(overall.tokenSavings).toEqual({ meanTokensSaved: 5151, percentSavedOfMeans: 61.6161 });
  });

  it("keeps unavailable as unavailable, never zero", () => {
    const section = buildContextPackGenerationReport(makeRun(["case-a"]))!;
    const symbolF1 = section.cases[0].treatments[1].symbolF1;
    expect(symbolF1).toMatchObject({ availability: "unavailable", value: null, reason: "missing-evidence" });
    expect(section.cases[0].comparison.symbolF1Delta).toBeNull();
    expect(section.scopes[1].treatmentSummaries[0].objectives).toBeNull();
    expect(section.scopes[1].pairedDeltas).toBeNull();
  });

  it("does not mutate the run evidence", () => {
    const run = makeRun();
    const before = JSON.stringify(run);
    buildContextPackGenerationReport(run, packsFor("case-a", "case-b"));
    expect(JSON.stringify(run)).toBe(before);
  });
});

describe("bounded pack preview", () => {
  const preview = () => buildContextPackGenerationReport(makeRun(["case-a"]), packsFor("case-a"))!.previews[0];

  it("applies each frozen bound with correct omitted counts and keeps pack order", () => {
    expect([PACK_PREVIEW_MAX_FILES, PACK_PREVIEW_MAX_SYMBOLS, PACK_PREVIEW_MAX_SOURCE_SLICES, PACK_PREVIEW_MAX_SOURCE_LINES_PER_SLICE, PACK_PREVIEW_MAX_CALL_RELATIONSHIPS, PACK_PREVIEW_MAX_TESTS, PACK_PREVIEW_MAX_EVIDENCE_NOTES]).toEqual([5, 5, 3, 12, 5, 5, 5]);
    const p = preview();
    expect(p.status).toBe("available");
    expect(p.files).toMatchObject({ totalCount: 8, omittedCount: 3 });
    expect(p.files!.items.map((f) => f.path)).toEqual(["src/file0.ts", "src/file1.ts", "src/file2.ts", "src/file3.ts", "src/file4.ts"]);
    expect(p.symbols).toMatchObject({ totalCount: 7, omittedCount: 2 });
    expect(p.symbols!.items.map((s) => s.name)).toEqual(["symbol0", "symbol1", "symbol2", "symbol3", "symbol4"]);
    expect(p.sourceSlices).toMatchObject({ totalCount: 5, omittedCount: 2 });
    expect(p.sourceSlices!.items.map((s) => s.file)).toEqual(["src/f0.ts", "src/f1.ts", "src/f2.ts"]);
    expect(p.callRelationships).toMatchObject({ totalCount: 9, omittedCount: 4 });
    expect(p.callRelationships!.items).toHaveLength(5);
    expect(p.tests).toMatchObject({ totalCount: 8, omittedCount: 3 });
    expect(p.tests!.items).toHaveLength(5);
    expect(p.evidenceNotes).toMatchObject({ totalCount: 7, omittedCount: 2 });
    expect(p.evidenceNotes!.items).toEqual(["symbol-end-unknown", "source-slice-cap-reached", "total-source-line-cap-reached", "source-slice-count-cap-reached", "seed-cap-reached"]);
  });

  it("keeps the section summaries in roadmap order from persisted evidence", () => {
    const p = preview();
    expect(p.sections.map((s) => s.id)).toEqual(["task", "files", "symbols", "sourceSlices", "callRelationships", "tests", "evidenceNotes"]);
    expect(p.sections.map((s) => s.itemCount)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(p.sections.map((s) => s.estimatedTokens)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it("limits previewed source to 12 lines and keeps policy truncation distinct from preview truncation", () => {
    const slices = preview().sourceSlices!.items;
    for (const slice of slices) {
      expect(slice.previewText.split("\n")).toHaveLength(12);
      expect(slice.previewLineCount).toBe(12);
      expect(slice.previewTruncated).toBe(true);
      expect(slice.lineCount).toBe(20);
    }
    expect(slices.map((s) => s.truncated)).toEqual([true, false, false]);
    expect(slices.map((s) => s.boundaryKnown)).toEqual([true, false, true]);
    const short = makePack("case-a", { sourceSlices: [{ ...makePack("x").sourceSlices[0], text: "one\ntwo", lineCount: 2, truncated: true }] });
    const shown = buildContextPackGenerationReport(makeRun(["case-a"]), new Map([["case-a", short]]))!.previews[0].sourceSlices!.items[0];
    expect(shown.previewTruncated).toBe(false);
    expect(shown.truncated).toBe(true);
  });

  it("does not alter the pack, the run size evidence or any measured value", () => {
    const pack = makePack("case-a");
    const before = JSON.stringify(pack);
    const run = makeRun(["case-a"]);
    const sizeBefore = JSON.stringify((run as never as { caseExecutionEvidence: unknown }).caseExecutionEvidence);
    const section = buildContextPackGenerationReport(run, new Map([["case-a", pack]]))!;
    expect(JSON.stringify(pack)).toBe(before);
    expect(JSON.stringify((run as never as { caseExecutionEvidence: unknown }).caseExecutionEvidence)).toBe(sizeBefore);
    expect(section.cases[0].treatments[1].estimatedTokens).toBe(1234);
  });

  it("only previews calls relationships and reports unavailability instead of empty lists when no pack is loaded", () => {
    const missing = buildContextPackGenerationReport(makeRun(["case-a"]))!.previews[0];
    expect(missing).toMatchObject({ status: "pack-artifact-unavailable", task: null, files: null, sourceSlices: null });
    expect(missing.sections).toHaveLength(7);
    const none = buildContextPackGenerationReport(makeRun(["case-a"], false))!.previews[0];
    expect(none.status).toBe("no-pack-produced");
  });

  it("contains no absolute machine path", () => {
    const text = JSON.stringify(buildContextPackGenerationReport(makeRun(), packsFor("case-a", "case-b")));
    expect(text).not.toContain(process.cwd());
    expect(text).not.toMatch(/[A-Za-z]:\\\\/);
  });
});

describe("text and HTML presentation", () => {
  const report = () => buildPluginExperimentReport({ run: makeRun(["case-a", "case-b"]), plugin: contextPackGenerationMetadata, generatedAt: "t", contextPacks: packsFor("case-a", "case-b") });

  it("renders the text section with coverage, size, scopes, preview and limitations", () => {
    const text = renderPluginExperimentReportText(report());
    expect(text).toContain("Context Pack Generation");
    expect(text).toContain("treatment=raw-full-file");
    expect(text).toContain("treatment=context-pack");
    expect(text).toContain("factCoverage=0.7770");
    expect(text).toContain("estimatedTokens=1234");
    expect(text).toContain("tokensSaved=7777");
    expect(text).toContain("Scope broad-change");
    expect(text).toContain("meanTokensSaved=5151");
    expect(text).toContain("shown=5 total=8 omitted=3");
    expect(text).toContain("policyTruncated=true previewTruncated=true");
    expect(text).toContain("not a coding-agent success evaluation");
    expect(text).toContain("not provider billing telemetry");
    expect(text).toContain("not the production my-dev-kit context API");
    expect(text).not.toMatch(/winner|pareto|best strategy/i);
    expect(text).not.toContain("line 0.12 ");
  });

  it("renders the HTML section, escapes every pack-derived string, and bounds source", () => {
    const html = renderPluginExperimentReportHtml(report());
    expect(html).toContain("<h2>Context Pack Generation</h2>");
    expect(html).toContain("<pre>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
    expect(html).toContain("tests/t0&lt;x&gt;.test.ts");
    expect(html).toContain("line 0.0 &lt;b&gt;&amp;&quot;&#39;");
    expect(html).not.toContain("<b>&");
    expect(html).not.toContain("line 0.12 ");
    // The generic report header carries the target root; the typed section itself must not.
    const start = html.indexOf("<h2>Context Pack Generation</h2>");
    const typedSection = html.slice(start, html.indexOf("</section>", start));
    expect(typedSection).not.toContain(process.cwd());
  });

  it("leaves other plugins' text and HTML without the new section", () => {
    const base = buildPluginExperimentReport({ run: makeRun(), plugin: contextPackGenerationMetadata, generatedAt: "t" });
    const other = { ...base, contextPackGeneration: null };
    expect(renderPluginExperimentReportText(other)).not.toContain("Context Pack Preview");
    expect(renderPluginExperimentReportHtml(other)).not.toContain("Context Pack Preview");
  });

  it("uses neutral wording in the generic interpretation", () => {
    const interpretation = report().interpretation;
    expect(interpretation.summary).toContain("5151");
    expect(`${interpretation.summary} ${interpretation.recommendedNextStep}`).not.toMatch(/winner|best|rank/i);
  });
});

describe("persisted pack loading and the generic writer", () => {
  it("loads valid persisted packs, skips missing or invalid ones, and never reads outside the root", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cpg-report-"));
    tempDirs.push(root);
    mkdirSync(path.join(root, "packs"));
    writeFileSync(path.join(root, "packs", "case-a.context-pack.json"), JSON.stringify(makePack("case-a")));
    writeFileSync(path.join(root, "packs", "case-b.context-pack.json"), "{not json");
    const packs = await loadContextPackArtifacts(makeRun(["case-a", "case-b", "case-c"]), root);
    expect([...packs.keys()]).toEqual(["case-a"]);
    expect((await loadContextPackArtifacts({ ...makeRun(), pluginId: "warm-index-reuse" }, root)).size).toBe(0);
  });

  it("writes the typed section into report.json, report.txt and report.html from the persisted packs", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cpg-report-"));
    tempDirs.push(root);
    mkdirSync(path.join(root, "packs"));
    writeFileSync(path.join(root, "packs", "case-a.context-pack.json"), JSON.stringify(makePack("case-a")));
    const run = makeRun(["case-a"]);
    const before = JSON.stringify(run);
    const { outputPaths } = await writePluginExperimentReports({ run, plugin: contextPackGenerationMetadata, outputRoot: root, generatedAt: "t" });
    expect(JSON.stringify(run)).toBe(before);
    const json = JSON.parse(readFileSync(outputPaths.jsonPath, "utf8")).report;
    expect(json.contextPackGeneration.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-report-v1");
    expect(json.contextPackGeneration.previews[0].status).toBe("available");
    expect(json.contextPackGeneration.previews[0].files.items).toHaveLength(5);
    expect(json.contextPackGeneration.artifacts.map((a: { path: string }) => a.path)).toContain("context-pack-generation-analysis.json");
    expect(JSON.stringify(json.contextPackGeneration)).not.toContain(root.replaceAll("\\", "\\\\"));
    expect(readFileSync(outputPaths.textPath, "utf8")).toContain("Context Pack Generation");
    expect(readFileSync(outputPaths.htmlPath, "utf8")).toContain("<h2>Context Pack Generation</h2>");
  });
});
