import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPluginExperimentReport,
  buildWarmIndexReuseReport,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
} from "../../src/report/index.js";
import {
  calculateWarmIndexMetrics,
  toRawOutcomeMetrics,
  toWarmOutcomeMetrics,
  warmIndexReuseMetadata,
  type WarmIndexProjectSummaryV1,
  type WarmIndexReuseRun,
  type WarmIndexTaskSummaryV1,
} from "../../src/experiments/plugins/warmIndexReuse/index.js";
import {
  AFFECTED_NEIGHBORHOOD_EXPLANATIONS,
  AFFECTED_NEIGHBORHOOD_METRICS,
  UPSTREAM_MY_DEV_KIT_SPEC,
  buildControlledMutationKitWrapperSource,
  resolveUpstreamBinRelativePath,
  validateAffectedNeighborhoodLayers,
  validateUpstreamMyDevKitIdentity,
  type AffectedNeighborhoodExpectation,
} from "../../scripts/verifyPackedPackageHelpers.js";
import { makeAssessment } from "../experiments/warmIndexReuse/affectedNeighborhoodTestHelpers.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("upstream my-dev-kit pin (TST-B4-002)", () => {
  it("pins the exact published spec and never a dist-tag", () => {
    expect(UPSTREAM_MY_DEV_KIT_SPEC).toBe("@dailephd/my-dev-kit@1.12.5");
    expect(UPSTREAM_MY_DEV_KIT_SPEC).not.toContain("latest");
  });

  it("accepts only the pinned package identity and rejects any other version or package", () => {
    expect(validateUpstreamMyDevKitIdentity({ name: "@dailephd/my-dev-kit", version: "1.12.5" })).toEqual([]);
    expect(validateUpstreamMyDevKitIdentity({ name: "@dailephd/my-dev-kit", version: "1.12.4" })).toHaveLength(1);
    expect(validateUpstreamMyDevKitIdentity({ name: "@dailephd/my-dev-kit", version: "latest" })).toHaveLength(1);
    expect(validateUpstreamMyDevKitIdentity({ name: "some-other-kit", version: "1.12.5" })).toHaveLength(1);
    expect(validateUpstreamMyDevKitIdentity(null)).toEqual(["upstream package.json is missing"]);
  });

  it("resolves the upstream bin from a string or a map and reports absence", () => {
    expect(resolveUpstreamBinRelativePath({ bin: "dist\\cli.js" })).toBe("dist/cli.js");
    expect(resolveUpstreamBinRelativePath({ bin: { "my-dev-kit": "dist/cli.js" } })).toBe("dist/cli.js");
    expect(resolveUpstreamBinRelativePath({})).toBeNull();
  });
});

describe("controlled-mutation kit wrapper (TST-B4-008, TST-B4-009)", () => {
  /** A stand-in upstream: prints its argv, writes to stderr, and exits with FAKE_STATUS_<command> (default 0). */
  function setup() {
    const dir = makeTempDir("packed-wrapper-");
    const upstream = path.join(dir, "upstream.js");
    writeFileSync(
      upstream,
      [
        `const args = process.argv.slice(2);`,
        `process.stdout.write("OUT:" + JSON.stringify(args));`,
        `process.stderr.write("ERR:" + args[0]);`,
        `process.exit(Number(process.env["FAKE_STATUS_" + args[0]] ?? 0));`,
      ].join("\n")
    );
    const mutateFile = path.join(dir, "target.ts");
    writeFileSync(mutateFile, "export const a = 1;\n");
    const other = path.join(dir, "other.ts");
    writeFileSync(other, "export const b = 2;\n");
    const statePath = path.join(dir, "state.json");
    const logPath = path.join(dir, "log.txt");
    const wrapper = path.join(dir, "wrapper.mjs");
    const mutationText = "// packed acceptance controlled mutation\n";
    writeFileSync(wrapper, buildControlledMutationKitWrapperSource({ upstreamBin: upstream, mutateFile, mutationText, statePath, logPath }));
    const run = (args: string[], env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [wrapper, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
    const state = () => JSON.parse(readFileSync(statePath, "utf8"));
    return { run, state, mutateFile, other, logPath, mutationText };
  }

  it("delegates first and preserves stdout, stderr, and exit status without mutating at index time", () => {
    const { run, mutateFile, state } = setup();
    const before = sha256(mutateFile);

    const index = run(["index", "--root", "x", "--out", "y"]);

    expect(index.status).toBe(0);
    expect(index.stdout).toBe('OUT:["index","--root","x","--out","y"]');
    expect(index.stderr).toBe("ERR:index");
    expect(sha256(mutateFile)).toBe(before);
    expect(state()).toMatchObject({ indexSucceededCount: 1, mutationCount: 0, shaBeforeIndex: before, shaAfterIndex: before });
  });

  it("mutates exactly once, only the configured file, on the first search after a successful index", () => {
    const { run, mutateFile, other, state, mutationText } = setup();
    const otherBefore = sha256(other);
    run(["index"]);
    const beforeSearch = sha256(mutateFile);

    const search = run(["search", "--query", "q"]);
    run(["search", "--query", "q2"]);
    run(["lookup", "--node", "n"]);

    expect(search.stdout).toBe('OUT:["search","--query","q"]');
    expect(readFileSync(mutateFile, "utf8")).toBe(`export const a = 1;\n${mutationText}`);
    expect(sha256(mutateFile)).not.toBe(beforeSearch);
    expect(sha256(other)).toBe(otherBefore);
    expect(state()).toMatchObject({ mutationCount: 1, shaBeforeMutation: beforeSearch, shaAfterMutation: sha256(mutateFile) });
  });

  it("never mutates after a failed index, or before any index, and preserves the failing exit code", () => {
    const { run, mutateFile, state, logPath } = setup();
    const before = sha256(mutateFile);

    const earlySearch = run(["search"]);
    const failed = run(["index"], { FAKE_STATUS_index: "3" });
    const laterSearch = run(["search"]);

    expect(earlySearch.status).toBe(0);
    expect(failed.status).toBe(3);
    expect(laterSearch.status).toBe(0);
    expect(sha256(mutateFile)).toBe(before);
    expect(state()).toMatchObject({ indexSucceededCount: 0, mutationCount: 0 });
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual(["search\t0", "index\t3", "search\t0"]);
  });

  it("passes through non-index commands untouched, including a failing status", () => {
    const { run, mutateFile } = setup();
    const before = sha256(mutateFile);

    const version = run(["--version"]);
    const failing = run(["source"], { FAKE_STATUS_source: "7" });

    expect(version.stdout).toBe('OUT:["--version"]');
    expect(failing.status).toBe(7);
    expect(sha256(mutateFile)).toBe(before);
  });

  it("keeps a source file syntactically valid TypeScript when the comment mutation is appended", () => {
    const { mutationText } = setup();
    expect(mutationText.startsWith("//")).toBe(true);
    expect(mutationText.endsWith("\n")).toBe(true);
    const file = path.join(makeTempDir("packed-mut-"), "f.ts");
    writeFileSync(file, "export const a = 1;\n");
    appendFileSync(file, mutationText);
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean)).toEqual(["export const a = 1;", "// packed acceptance controlled mutation"]);
  });
});

// -------------------------------------------------------------------------------------------------
// Cross-artifact layer validation, built from the real metric owner and report builders.
// -------------------------------------------------------------------------------------------------

const METHOD = "estimated_chars_div_4";
function taskSummary(caseId: string, overrides: Partial<WarmIndexTaskSummaryV1> = {}): WarmIndexTaskSummaryV1 {
  return {
    caseId,
    status: "completed",
    rawStatus: "completed",
    warmStatus: "completed",
    rawBaseline: { targetRoot: "/t", filesIncluded: ["a.ts"], totalFiles: 1, totalChars: 400, totalEstimatedTokens: 100, tokenCountMethod: METHOD, durationMs: 10 },
    warmRetrieval: {
      skipped: false,
      warnings: [],
      totalChars: 40,
      totalEstimatedTokens: 10,
      tokenCountMethod: METHOD,
      filesRead: [],
      selectedNodeId: null,
      selectedFile: null,
      selectedSymbol: null,
      durationMs: 2,
      commands: [],
    },
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function layersFor(task: WarmIndexTaskSummaryV1) {
  const project: WarmIndexProjectSummaryV1 = {
    benchmarkProject: "todo-ts",
    sessionKey: "todo-ts",
    status: "completed",
    targetRoot: "/t",
    sourceRoots: ["src"],
    indexDir: "/out/indexes/todo-ts",
    sessionPrepared: true,
    buildDurationMs: 100,
    indexCommand: null,
    tasks: [task],
    warnings: [],
    errors: [],
  };
  const metrics = calculateWarmIndexMetrics([project]);
  const run = {
    runId: "run-1",
    pluginId: "warm-index-reuse",
    startedAt: "2026-09-26T00:00:00.000Z",
    completedAt: "2026-09-26T00:00:01.000Z",
    status: "completed",
    target: { kind: "self", targetRoot: "/t", toolRoot: "/t", packageName: null, packageVersion: null, hasPackageJson: false, hasLockfile: false, branch: null, commit: null, hasGit: false, isSelf: true },
    variants: [],
    cases: [],
    metrics: [],
    artifacts: [],
    warnings: [],
    failures: [],
    projectExecutions: [project],
    warmIndexMetrics: metrics,
  } as unknown as WarmIndexReuseRun;
  const pluginReport = buildPluginExperimentReport({ run, plugin: warmIndexReuseMetadata });
  const taskMetrics = metrics.projects[0].tasks[0];
  const withCases = {
    ...pluginReport,
    cases: [
      {
        id: task.caseId,
        outcomes: [
          { variantId: "raw-full-file", metrics: toRawOutcomeMetrics(taskMetrics, "raw-full-file") },
          { variantId: "warm-index-reuse", metrics: toWarmOutcomeMetrics(taskMetrics, "warm-index-reuse") },
        ],
      },
    ],
  };
  return {
    caseId: task.caseId,
    executionArtifact: { schemaVersion: "my-dev-kit-lab-warm-index-execution-v1", projects: [project] },
    report: JSON.parse(JSON.stringify(withCases)) as Record<string, unknown>,
    reportText: renderPluginExperimentReportText(pluginReport),
    reportHtml: renderPluginExperimentReportHtml(pluginReport),
    modelReport: buildWarmIndexReuseReport(run),
  };
}

const FRESH: AffectedNeighborhoodExpectation = {
  freshnessStatus: "fresh",
  assessmentStatus: "complete",
  relationship: "unrelated",
  reindexRecommendation: "not-indicated",
  metrics: { changedFileCount: 0, changedSymbolCount: 0, affectedNodeCount: 0, affectedEdgeCount: 0, taskOverlapCount: 0, taskOverlapPercent: 0 },
};
const CHANGED: AffectedNeighborhoodExpectation = {
  freshnessStatus: "stale",
  assessmentStatus: "complete",
  relationship: "related",
  reindexRecommendation: "recommended",
  metrics: { changedFileCount: 1, changedSymbolCount: "positive", affectedNodeCount: "positive", affectedEdgeCount: "nonnegative", taskOverlapCount: "positive", taskOverlapPercent: "positive" },
};
const changedAssessment = () =>
  makeAssessment({
    freshnessStatus: "stale",
    changedFileCount: 1,
    changedSymbolCount: 2,
    seedNodeCount: 3,
    affectedNodeCount: 6,
    affectedEdgeCount: 5,
    taskOverlapCount: 2,
    taskOverlapPercent: 66.66666666666666,
    relationship: "related",
    reindexRecommendation: "recommended",
  });

describe("installed-run affected-neighborhood layer validation", () => {
  // TST-B4-003 .. TST-B4-007, TST-B4-021, TST-B4-022
  it("accepts a consistent fresh (unrelated / not-indicated) run across every layer", () => {
    const layers = layersFor(taskSummary("c1", { affectedNeighborhood: makeAssessment() }));

    expect(validateAffectedNeighborhoodLayers({ ...layers, reportText: layers.reportText, expected: FRESH })).toEqual([]);
  });

  // TST-B4-013 .. TST-B4-022
  it("accepts a consistent changed-file (related / recommended) run across every layer", () => {
    const layers = layersFor(taskSummary("c1", { affectedNeighborhood: changedAssessment() }));

    expect(validateAffectedNeighborhoodLayers({ ...layers, expected: CHANGED })).toEqual([]);
  });

  it("rejects a run whose evidence does not match the scenario", () => {
    const layers = layersFor(taskSummary("c1", { affectedNeighborhood: makeAssessment() }));

    const problems = validateAffectedNeighborhoodLayers({ ...layers, expected: CHANGED });

    expect(problems.join("\n")).toContain("relationship is unrelated, expected related");
    expect(problems.join("\n")).toContain("assessment changedFileCount is 0, expected 1");
  });

  // TST-B4-021
  it("detects a disagreement between the generic warm metric and the assessment", () => {
    const layers = layersFor(taskSummary("c1", { affectedNeighborhood: changedAssessment() }));
    const warm = ((layers.report.cases as Array<{ outcomes: Array<{ variantId: string; metrics: Array<{ id: string; value: number }> }> }>)[0].outcomes.find((outcome) => outcome.variantId === "warm-index-reuse"))!;
    warm.metrics.find((metric) => metric.id === "affected-neighborhood-node-count")!.value = 999;

    const problems = validateAffectedNeighborhoodLayers({ ...layers, expected: CHANGED });

    expect(problems.join("\n")).toContain("warm outcome metric affected-neighborhood-node-count is missing or disagrees");
  });

  // TST-B4-005
  it("detects affected-neighborhood metrics leaking onto the raw outcome", () => {
    const layers = layersFor(taskSummary("c1", { affectedNeighborhood: makeAssessment() }));
    const raw = ((layers.report.cases as Array<{ outcomes: Array<{ variantId: string; metrics: unknown[] }> }>)[0].outcomes.find((outcome) => outcome.variantId === "raw-full-file"))!;
    raw.metrics.push({ id: "affected-neighborhood-task-overlap-count", value: 0, unit: "count" });

    expect(validateAffectedNeighborhoodLayers({ ...layers, expected: FRESH }).join("\n")).toContain("raw side carries affected-neighborhood metric taskOverlapCount");
  });

  // TST-B4-025
  it("detects graph node/edge payloads embedded in the execution artifact", () => {
    const layers = layersFor(taskSummary("c1", { affectedNeighborhood: makeAssessment() }));
    (layers.executionArtifact as Record<string, unknown>).graph = { nodes: [{ id: "file:x" }], edges: [] };

    expect(validateAffectedNeighborhoodLayers({ ...layers, expected: FRESH }).join("\n")).toContain("embeds graph node or edge records");
  });

  // TST-B4-007
  it("detects a report surface missing the fixed explanation or category", () => {
    const layers = layersFor(taskSummary("c1", { affectedNeighborhood: makeAssessment() }));

    const problems = validateAffectedNeighborhoodLayers({
      ...layers,
      reportText: layers.reportText.replace(AFFECTED_NEIGHBORHOOD_EXPLANATIONS["not-indicated"], ""),
      reportHtml: "<html></html>",
      expected: FRESH,
    });

    expect(problems.join("\n")).toContain("report.txt lacks");
    expect(problems.join("\n")).toContain("report.html lacks the affected-neighborhood presentation");
  });

  it("reports a missing assessment object", () => {
    const layers = layersFor(taskSummary("c1", { affectedNeighborhood: null }));

    expect(validateAffectedNeighborhoodLayers({ ...layers, expected: FRESH })).toEqual(["[c1] execution artifact task has no affectedNeighborhood assessment object"]);
  });

  // TST-B4-023, TST-B4-024
  it("keeps partial zero overlap unknown / unknown and distinguishes absent, null, and unavailable", () => {
    const partial = makeAssessment({
      status: "partial",
      taskMapping: { ...makeAssessment().taskMapping, status: "partial", unresolvedCount: 1, unresolved: [{ subject: "expected-symbol", name: "ghost", reason: "graph-node-missing" }], resolvableTaskNodeCount: 1, resolvedTaskNodeIds: ["file:src/a.ts"] },
      relationship: "unknown",
      reindexRecommendation: "unknown",
    });
    const unavailable = makeAssessment({ status: "unavailable", relationship: "unknown", reindexRecommendation: "unknown" });
    const blocks = (task: WarmIndexTaskSummaryV1) => layersFor(task).modelReport!.projects[0].tasks[0].affectedNeighborhood;

    expect(blocks(taskSummary("c1", { affectedNeighborhood: partial }))).toMatchObject({ status: "partial", relationship: "unknown", reindexRecommendation: "unknown" });
    expect(blocks(taskSummary("c1", { affectedNeighborhood: unavailable }))).toMatchObject({ status: "unavailable" });
    expect(blocks(taskSummary("c1", { affectedNeighborhood: null }))).toBeNull();
    expect(blocks(taskSummary("c1"))).toBeNull();
    const partialLayers = layersFor(taskSummary("c1", { affectedNeighborhood: partial }));
    expect(validateAffectedNeighborhoodLayers({ ...partialLayers, expected: { ...FRESH, assessmentStatus: "partial", relationship: "unknown", reindexRecommendation: "unknown" } })).toEqual([]);
  });

  it("names the six metrics with the frozen IDs and units", () => {
    expect(AFFECTED_NEIGHBORHOOD_METRICS.map((metric) => [metric.field, metric.id, metric.unit])).toEqual([
      ["changedFileCount", "affected-neighborhood-changed-file-count", "count"],
      ["changedSymbolCount", "affected-neighborhood-changed-symbol-count", "count"],
      ["affectedNodeCount", "affected-neighborhood-node-count", "count"],
      ["affectedEdgeCount", "affected-neighborhood-edge-count", "count"],
      ["taskOverlapCount", "affected-neighborhood-task-overlap-count", "count"],
      ["taskOverlapPercent", "affected-neighborhood-task-overlap-percent", "percent"],
    ]);
  });
});

describe("packed verifier v0.6.1 section guards (TST-B4-001, TST-B4-002, TST-B4-030)", () => {
  const source = readFileSync(path.resolve(process.cwd(), "scripts/verify-packed-package.mjs"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("// 9c-2. v0.6.1 affected-neighborhood installed-package acceptance.");
  const end = source.indexOf("// 9d. v0.5.2 real-agent campaign acceptance.");
  const section = source.slice(start, end);

  it("locates the affected-neighborhood section between the existing warm-index and campaign sections", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("drives the installed binaries from the exact tarball, never the source checkout, npm link, or tsx", () => {
    expect(section).toContain("runInstalledCli(\n      cliCommand,");
    expect(section).toContain("runInstalledCli(\n      sandboxCliCommand,");
    expect(section).toContain('["install", "--no-audit", "--no-fund", tarballPath]');
    expect(section).not.toMatch(/compiledBinPath|npm link|\btsx\b|dist\/scripts\/cli\.js|REPO_ROOT, "dist"/);
  });

  it("uses the real published upstream at the exact pin, never @latest or the fake kit", () => {
    expect(section).toContain("UPSTREAM_MY_DEV_KIT_SPEC");
    expect(section).toContain("BLOCKED_UPSTREAM_MY_DEV_KIT_BASELINE_CHANGED");
    expect(section).not.toMatch(/@latest|fakeKitCommand|fake-my-dev-kit|FAKE_MY_DEV_KIT/);
    expect(source).not.toMatch(/my-dev-kit@latest/);
  });

  it("keeps the pre-v0.6.1 gates and no longer forbids v0.6.1 evidence in the fake-kit run", () => {
    for (const gate of ["TARGET_IMMUTABILITY", "INSTALLED_PACKAGE_IMMUTABILITY", "PACKAGED_EXAMPLE_IMMUTABILITY", "WARM_INDEX_INDEX_FRESHNESS", "WARM_INDEX_REPORT_FRESHNESS", "WARM_INDEX_CAMPAIGN_GALLERY"]) {
      expect(source).toContain(gate);
    }
    expect(source).not.toContain("contains v0.6.1+ fields");
    expect(source).toContain("dist/src/evaluation/affectedNeighborhood.js");
  });

  it("writes every generated artifact under the verifier temp workspace", () => {
    expect(section).toContain("dirs.affectedRuns");
    expect(section).toContain("assertOutputOutsidePackage(freshOut, installedPackageRoot");
    expect(section).toContain("assertOutputOutsidePackage(changedOut, sandboxPackageRoot");
  });
});
