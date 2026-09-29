import { readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildIncrementalChangeStalenessExecutionArtifactV2,
  writeIncrementalChangeStalenessExecutionArtifactV2
} from "../../../src/experiments/plugins/incrementalChangeStaleness/executionArtifactV2.js";
import type { IncrementalChangeStalenessScenarioExecutionV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/executionV2.js";
import {
  incrementalChangeStalenessMetadata,
  mapIncrementalChangeStalenessExecutionsToRunV2
} from "../../../src/experiments/plugins/incrementalChangeStaleness/plugin.js";
import { writePluginExperimentReports } from "../../../src/report/index.js";
import {
  LIMITATIONS_V2,
  buildIncrementalChangeStalenessPluginReport,
  findReportComparison,
  findReportTreatment,
  type IncrementalChangeStalenessReportV2
} from "../../../src/report/experiments/index.js";
import { cleanup, prepareAndExecuteV2 } from "../../experiments/incrementalChangeStaleness/executionV2TestHelpers.js";
import {
  expectCanonicalFilesUnchanged,
  expectNoIndexOutputInCanonicalProjects,
  makeRunOwnedRoot,
  repoRoot
} from "../../experiments/incrementalChangeStaleness/lifecycleTestHelpers.js";

const tracked: string[] = [];
let ready: IncrementalChangeStalenessScenarioExecutionV2;
let fallback: IncrementalChangeStalenessScenarioExecutionV2;
let failed: IncrementalChangeStalenessScenarioExecutionV2;

beforeAll(async () => {
  ready = (await prepareAndExecuteV2(tracked, "U1")).execution;
  fallback = (
    await prepareAndExecuteV2(tracked, "T1", {
      kit: { refresh: { "affected-neighborhood": "fallback" } },
      searchByTreatment: { "stale-index": "missing", "changed-files-refresh": "missing", "affected-neighborhood-refresh": "present", "full-refresh": "present" }
    })
  ).execution;
  failed = (await prepareAndExecuteV2(tracked, "L2", { kit: { bootstrap: "wrong-reason" } })).execution;
}, 300_000);

afterAll(async () => {
  await cleanup(tracked);
});

afterEach(() => {
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

const TARGET = {
  kind: "self",
  targetRoot: repoRoot,
  toolRoot: repoRoot,
  packageName: "@dailephd/my-dev-kit-lab",
  packageVersion: "0.6.2",
  hasPackageJson: true,
  hasLockfile: true,
  branch: null,
  commit: null,
  hasGit: true,
  isSelf: true
} as const;

async function report(executions: IncrementalChangeStalenessScenarioExecutionV2[], mutate?: (artifactPath: string) => void) {
  const outDir = makeRunOwnedRoot(tracked, "ics-report-v2-");
  const artifact = buildIncrementalChangeStalenessExecutionArtifactV2({ runId: "report-v2", pluginId: "incremental-change-staleness", executions });
  const artifactPath = await writeIncrementalChangeStalenessExecutionArtifactV2(outDir, artifact);
  mutate?.(artifactPath);
  const run = mapIncrementalChangeStalenessExecutionsToRunV2({
    runId: "report-v2",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    target: TARGET,
    kitCommand: "fake",
    executions,
    artifactPath
  });
  const { outputPaths } = await writePluginExperimentReports({ run, plugin: incrementalChangeStalenessMetadata, outputRoot: outDir });
  return {
    run,
    json: JSON.parse(readFileSync(outputPaths.jsonPath, "utf8")) as { report: { incrementalChangeStaleness: IncrementalChangeStalenessReportV2 } },
    text: readFileSync(outputPaths.textPath, "utf8"),
    html: readFileSync(outputPaths.htmlPath, "utf8")
  };
}

describe("V2 report dispatch and JSON presentation", () => {
  it("selects the V2 model for a V2 artifact and carries four treatments and three comparisons with explicit ids", async () => {
    const { json, run } = await report([ready]);
    const section = json.report.incrementalChangeStaleness;
    expect(section.schemaVersion).toBe("my-dev-kit-lab-incremental-change-staleness-report-v2");
    expect(buildIncrementalChangeStalenessPluginReport(run)?.schemaVersion).toBe(section.schemaVersion);
    const scenario = section.scenarios[0];
    expect(scenario.treatments.map((t) => t.treatmentId)).toEqual(["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]);
    expect(scenario.referenceComparisons.map((c) => `${c.candidateTreatmentId}->${c.referenceTreatmentId}`)).toEqual([
      "stale-index->full-refresh",
      "changed-files-refresh->full-refresh",
      "affected-neighborhood-refresh->full-refresh"
    ]);
    expect(scenario.treatments.map((t) => t.refreshExecution.realization)).toEqual(["NO_REFRESH", "APPLIED_PARTIAL", "APPLIED_PARTIAL", "FULL_REFRESH"]);
    expect(section.summary.scenarioCount).toBe(1);
    expect(section.limitations).toEqual(LIMITATIONS_V2);
    const text = JSON.stringify(json.report.incrementalChangeStaleness);
    for (const forbidden of ["winner", "bestTreatment", "recommendedTreatment", "\"rank\"", "safeToSkipRefresh", "safetyPercent", "staleRiskPercent", "contextText"]) {
      expect(text).not.toContain(forbidden);
    }
    // Explicit unavailable states are preserved, not coerced.
    expect(scenario.treatments[0].refreshedFreshness).toBeNull();
    expect(scenario.treatments[3].refreshExecution.incrementalRefresh).toBeNull();
  });

  it("resolves treatments and comparisons by explicit id, independent of array position", async () => {
    const { json } = await report([ready]);
    const scenario = structuredClone(json.report.incrementalChangeStaleness.scenarios[0]);
    scenario.treatments.reverse();
    scenario.referenceComparisons.reverse();
    expect(findReportTreatment(scenario, "affected-neighborhood-refresh")?.treatmentId).toBe("affected-neighborhood-refresh");
    expect(findReportTreatment(scenario, "full-refresh")?.refreshExecution.realization).toBe("FULL_REFRESH");
    expect(findReportComparison(scenario, "changed-files-refresh")?.candidateTreatmentId).toBe("changed-files-refresh");
    expect(findReportComparison(scenario, "stale-index")?.kind).toBe("stale-risk");
    expect(findReportTreatment({ treatments: [] }, "stale-index")).toBeNull();
  });
});

describe("V2 text report", () => {
  it("presents the four treatments, refresh evidence, three reference comparisons, and every limitation", async () => {
    const { text } = await report([ready]);
    for (const label of ["No Refresh Treatment (stale-index)", "Changed-Files Refresh Treatment (changed-files-refresh)", "Affected-Neighborhood Refresh Treatment (affected-neighborhood-refresh)", "Full Refresh Treatment (full-refresh)"]) {
      expect(text).toContain(label);
    }
    expect(text.indexOf("No Refresh Treatment")).toBeLessThan(text.indexOf("Changed-Files Refresh Treatment"));
    expect(text.indexOf("Changed-Files Refresh Treatment")).toBeLessThan(text.indexOf("Affected-Neighborhood Refresh Treatment"));
    expect(text.indexOf("Affected-Neighborhood Refresh Treatment")).toBeLessThan(text.indexOf("Full Refresh Treatment"));
    for (const expected of ["Refresh realization: APPLIED_PARTIAL", "Refresh realization: NO_REFRESH", "Refresh realization: FULL_REFRESH", "Requested scope: changed-files", "Applied scope: affected-neighborhood", "Selection status: applied", "Fresh extraction files: 1", "Reused files: 9"]) {
      expect(text).toContain(expected);
    }
    for (const comparison of ["No Refresh vs Full Refresh", "Changed-Files Refresh vs Full Refresh", "Affected-Neighborhood Refresh vs Full Refresh"]) {
      expect(text).toContain(comparison);
    }
    expect(text).toContain("Reference classification:");
    expect(text).toContain("Stale-risk classification:");
    expect(text).not.toContain("Partial refresh is not evaluated in v0.6.2");
    for (const limitation of LIMITATIONS_V2) expect(text).toContain(limitation);
    expect(text).toContain("Lab affected-neighborhood evidence describes the baseline graph neighborhood");
    for (const banned of ["winner", "Winner", "superior", "inferior", "best treatment"]) expect(text).not.toContain(banned);
  });

  it("states a fallback as requested-partial applied-full and not comparable as partial-refresh evidence", async () => {
    const { text, json } = await report([fallback]);
    const affected = findReportTreatment(json.report.incrementalChangeStaleness.scenarios[0], "affected-neighborhood-refresh")!;
    expect(affected.refreshExecution.realization).toBe("FALLBACK_FULL");
    expect(text).toContain("FALLBACK_FULL: requested affected-neighborhood, applied full, selection status fallback-full, reason seed-selection-unavailable");
    expect(text).toContain("Requested scope: affected-neighborhood");
    expect(text).toContain("Applied scope: full");
    expect(text).toContain("Reference classification: not-comparable-as-partial-refresh");
    expect(text).toContain("candidate-fell-back-to-full");
    expect(text).toContain("The requested partial-refresh treatment fell back to a full rebuild, so this run does not provide evidence about the requested partial-refresh behavior.");
    // The other, applied, partial treatment in the same scenario is still compared as a partial.
    expect(text).toContain("Reference classification: observed-regression-relative-to-full");
    expect(text).toContain("Stale-risk classification: observed-stale-regression");
  });

  it("keeps the no-observed wording conservative for stale and partial treatments", async () => {
    const { text } = await report([ready]);
    expect(text).toContain("does not establish general stale-index safety");
    expect(text).toContain("does not establish general equivalence or safety");
    expect(text).toContain("does not imply that full refresh is unnecessary");
  });

  it("shows a failed scenario as unavailable without fabricated zero evidence", async () => {
    const { text, json } = await report([failed]);
    expect(json.report.incrementalChangeStaleness.scenarios[0].treatments).toEqual([]);
    expect(text).toContain("Not produced: the scenario failed before any treatment evidence existed.");
    expect(text).toContain("baseline-bootstrap-contract-mismatch");
    expect(text).not.toContain("Context characters: 0");
    expect(text).not.toContain("Correctness score: 0");
    expect(text).toContain("Reference classification: inconclusive");
  });
});

describe("V2 HTML report", () => {
  it("renders equivalent semantic content including refresh realization, comparisons, and limitations", async () => {
    const { html } = await report([ready, fallback]);
    for (const expected of [
      "No Refresh Treatment (stale-index)",
      "Changed-Files Refresh Treatment (changed-files-refresh)",
      "Affected-Neighborhood Refresh Treatment (affected-neighborhood-refresh)",
      "Full Refresh Treatment (full-refresh)",
      "APPLIED_PARTIAL",
      "FALLBACK_FULL",
      "NO_REFRESH",
      "FULL_REFRESH",
      "Changed-Files Refresh vs Full Refresh",
      "not-comparable-as-partial-refresh",
      "The requested partial-refresh treatment fell back to a full rebuild"
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).toContain("FALLBACK_FULL: requested affected-neighborhood, applied full");
    for (const limitation of LIMITATIONS_V2) expect(html).toContain(limitation.replaceAll('"', "&quot;"));
    expect(html).not.toContain("Partial refresh is not evaluated in v0.6.2");
  });

  it("escapes persisted evidence text", async () => {
    const { html } = await report([fallback], (artifactPath) => {
      const persisted = JSON.parse(readFileSync(artifactPath, "utf8")) as {
        scenarios: Array<{ treatments: Array<{ refreshExecution: { incrementalRefresh: { fallbackReason: string; forcedNeighborSample: string[] } | null } }> }>;
      };
      const affected = persisted.scenarios[0].treatments[2].refreshExecution.incrementalRefresh!;
      affected.fallbackReason = "<script>alert('x')</script>";
      affected.forcedNeighborSample = ["<img src=x onerror=alert(1)>"];
      writeFileSync(artifactPath, JSON.stringify(persisted, null, 2));
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("report builder boundary", () => {
  it("rejects a contradictory persisted V2 artifact instead of presenting it", async () => {
    const outDir = makeRunOwnedRoot(tracked, "ics-report-v2-bad-");
    const artifact = buildIncrementalChangeStalenessExecutionArtifactV2({ runId: "bad", pluginId: "incremental-change-staleness", executions: [ready] });
    const artifactPath = await writeIncrementalChangeStalenessExecutionArtifactV2(outDir, artifact);
    const persisted = JSON.parse(readFileSync(artifactPath, "utf8"));
    persisted.scenarios[0].treatments[3].refreshExecution = structuredClone(persisted.scenarios[0].treatments[1].refreshExecution);
    writeFileSync(artifactPath, JSON.stringify(persisted));
    const run = mapIncrementalChangeStalenessExecutionsToRunV2({
      runId: "bad",
      startedAt: "x",
      completedAt: "x",
      target: TARGET,
      kitCommand: "fake",
      executions: [ready],
      artifactPath
    });
    expect(() => buildIncrementalChangeStalenessPluginReport(run)).toThrow("full-refresh must be a full refresh");
  });

  it("rejects an unrecognized artifact schema and a non-plugin run", async () => {
    const outDir = makeRunOwnedRoot(tracked, "ics-report-v2-schema-");
    const artifactPath = `${outDir}/incremental-change-staleness-execution.json`;
    writeFileSync(artifactPath, JSON.stringify({ schemaVersion: "other" }));
    const run = mapIncrementalChangeStalenessExecutionsToRunV2({ runId: "s", startedAt: "x", completedAt: "x", target: TARGET, kitCommand: "fake", executions: [], artifactPath });
    expect(() => buildIncrementalChangeStalenessPluginReport(run)).toThrow("unsupported execution artifact schema version");
    expect(buildIncrementalChangeStalenessPluginReport({ ...run, pluginId: "warm-index-reuse" })).toBeNull();
    await rm(outDir, { recursive: true, force: true });
  });
});
