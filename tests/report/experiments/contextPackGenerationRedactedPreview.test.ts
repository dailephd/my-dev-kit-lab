import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ExperimentRun, ExperimentTarget } from "../../../src/experiments/index.js";
import {
  analyzeContextPackGeneration,
  CONTEXT_PACK_IDENTITY_REDACTION,
  executeContextPackGeneration,
  mapContextPackGenerationToRun,
  projectContextPackAnalysisForExternalLocalPersistence,
  projectContextPackExecutionForExternalLocalPersistence,
  contextPackGenerationMetadata,
  type ContextPackGenerationAnalysisV1,
  type ContextPackGenerationCaseResult
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import {
  buildContextPackGenerationReport,
  buildPluginExperimentReport,
  loadContextPackArtifacts,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText
} from "../../../src/report/experiments/index.js";
import { makeEvaluationCase, makeHarness, SOURCE_TEXT_SENTINEL, standardWorld, STANDARD_SYMBOL_INDEX } from "../../experiments/contextPackGeneration/contextPackGenerationTestHelpers.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const externalTarget: ExperimentTarget = {
  kind: "external-local",
  targetRoot: "local-repository:subject",
  toolRoot: "[redacted]",
  packageName: null,
  packageVersion: null,
  hasPackageJson: false,
  hasLockfile: false,
  branch: null,
  commit: null,
  hasGit: true,
  isSelf: false,
  privacyProjection: "external-local-redacted"
};

let results: ContextPackGenerationCaseResult[];
const cases = [makeEvaluationCase({ id: "case-a", locality: "localized" }), makeEvaluationCase({ id: "case-b", locality: "cross-module" })];

beforeAll(async () => {
  const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
  results = await executeContextPackGeneration({ cases, kitCommand: "fake-kit", outputRoot: path.resolve("unused-output"), dependencies: harness.dependencies });
});

function externalRun(): ExperimentRun {
  const evidence = results.map((result) => result.evidence);
  const analysis = analyzeContextPackGeneration(cases, evidence);
  return mapContextPackGenerationToRun({
    runId: "run-ext",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    target: externalTarget,
    caseEvidence: projectContextPackExecutionForExternalLocalPersistence(results),
    analysis: projectContextPackAnalysisForExternalLocalPersistence(analysis),
    executionArtifactPath: "context-pack-generation-execution.json",
    analysisArtifactPath: "context-pack-generation-analysis.json",
    packArtifactPaths: []
  });
}

function bundledRun(): ExperimentRun {
  const evidence = results.map((result) => result.evidence);
  return mapContextPackGenerationToRun({
    runId: "run-bundled",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    target: { ...externalTarget, kind: "self", isSelf: true, targetRoot: process.cwd(), toolRoot: process.cwd(), privacyProjection: undefined },
    caseEvidence: evidence,
    analysis: analyzeContextPackGeneration(cases, evidence),
    executionArtifactPath: "context-pack-generation-execution.json",
    analysisArtifactPath: "context-pack-generation-analysis.json",
    packArtifactPaths: results.map((result) => ({ caseId: result.evidence.caseId, path: result.evidence.treatments[1].packArtifactPath as string }))
  });
}

describe("redacted external-local preview", () => {
  it("is a distinct discriminated variant: counts, availability and redaction state only, never a missing-pack error", () => {
    const section = buildContextPackGenerationReport(externalRun())!;
    expect(section.previews).toHaveLength(2);
    section.previews.forEach((preview, index) => {
      const pack = results[index].pack!;
      expect(preview.status).toBe("redacted-external-local");
      expect(preview.status).not.toBe("pack-artifact-unavailable");
      expect(preview.status).not.toBe("no-pack-produced");
      expect(preview.packArtifactPath).toBeNull();
      expect(preview.packAvailability).toBe(pack.availability);
      for (const key of ["task", "files", "symbols", "sourceSlices", "callRelationships", "tests", "evidenceNotes"] as const) expect(preview[key]).toBeNull();
      expect((preview as { redaction: unknown }).redaction).toEqual(CONTEXT_PACK_IDENTITY_REDACTION);
      expect(preview.sections.map((entry) => [entry.id, entry.itemCount, entry.estimatedTokens])).toEqual(pack.sections.map((entry) => [entry.id, entry.itemCount, entry.estimatedTokens]));
      const slices = preview.sections.find((entry) => entry.id === "sourceSlices") as unknown as { truncatedCount: number | null };
      expect(slices.truncatedCount).toBe(pack.sourceSlices.filter((slice) => slice.truncated).length);
    });
  });

  it("ignores any pack body offered to it: the external preview never shows identities or source", () => {
    const packs = new Map(results.map((result) => [result.evidence.caseId, result.pack!]));
    const section = buildContextPackGenerationReport(externalRun(), packs)!;
    const serialized = JSON.stringify(section.previews);
    for (const secret of ["src/a.ts", "src/b.ts", SOURCE_TEXT_SENTINEL, "symbol:src", "tests/a.test.ts", "Title of case-a", "query for case-a"]) expect(serialized).not.toContain(secret);
    expect(section.previews.every((preview) => preview.status === "redacted-external-local")).toBe(true);
  });

  it("renders literal fixed placeholders derived from the persisted counts in text and HTML", () => {
    const run = externalRun();
    const report = buildPluginExperimentReport({ run, plugin: contextPackGenerationMetadata, generatedAt: "t" });
    const pack = results[0].pack!;
    const truncated = pack.sourceSlices.filter((slice) => slice.truncated).length;
    const lines = [
      "Task: title and summary redacted",
      `Relevant files: ${pack.files.length} ${pack.files.length === 1 ? "item" : "items"} — identities redacted`,
      `Relevant symbols: ${pack.symbols.length} ${pack.symbols.length === 1 ? "item" : "items"} — identities redacted`,
      `Source slices: ${pack.sourceSlices.length} ${pack.sourceSlices.length === 1 ? "item" : "items"}, ${truncated} truncated by experiment policy — content redacted`
    ];
    const text = renderPluginExperimentReportText(report);
    const html = renderPluginExperimentReportHtml(report);
    for (const line of lines) {
      expect(text).toContain(line);
      expect(html).toContain(line);
    }
    for (const document of [text, html]) {
      for (const secret of ["src/a.ts", SOURCE_TEXT_SENTINEL, "symbol:src", "Title of case-a", "pack-artifact-unavailable"]) expect(document).not.toContain(secret);
    }
    expect(JSON.stringify(report)).not.toContain(SOURCE_TEXT_SENTINEL);
  });

  it("copies persisted numbers and never recalculates them from the redacted evidence", () => {
    const run = externalRun() as ReturnType<typeof externalRun> & { analysis: ContextPackGenerationAnalysisV1 };
    run.analysis.cases[0].treatments[0].fileF1 = { availability: "available", numerator: 7, denominator: 9, value: 0.123456, reason: null };
    const section = buildContextPackGenerationReport(run)!;
    expect(section.cases[0].treatments[0].fileF1.value).toBe(0.123456);
  });

  it("needs no pack artifact: the loader returns nothing and touches no file for an external run", async () => {
    const missingRoot = path.join(mkdtempSync(path.join(os.tmpdir(), "cpg-redacted-")), "does-not-exist");
    tempDirs.push(path.dirname(missingRoot));
    expect((await loadContextPackArtifacts(externalRun(), missingRoot)).size).toBe(0);
  });
});

describe("bundled preview is unchanged", () => {
  it("still previews identities and bounded source from the pack artifact, with no redaction marker", () => {
    const packs = new Map(results.map((result) => [result.evidence.caseId, result.pack!]));
    const section = buildContextPackGenerationReport(bundledRun(), packs)!;
    for (const preview of section.previews) {
      expect(preview.status).toBe("available");
      expect(preview).not.toHaveProperty("redaction");
      expect(preview.files?.items.length).toBeGreaterThan(0);
      expect(preview.sourceSlices?.items[0].previewText).toContain(SOURCE_TEXT_SENTINEL);
    }
    const missing = buildContextPackGenerationReport(bundledRun())!;
    expect(missing.previews.every((preview) => preview.status === "pack-artifact-unavailable")).toBe(true);
  });
});
