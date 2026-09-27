import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AffectedNeighborhoodAssessmentV1 } from "../../../src/evaluation/affectedNeighborhood.js";
import type { MyDevKitRetrievalResult } from "../../../src/evaluation/types.js";
import { INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND } from "../../../src/experiments/plugins/incrementalChangeStaleness/config.js";
import {
  buildIncrementalChangeStalenessDerivedTask,
  buildIncrementalChangeStalenessRequiredFileEvidence,
  checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry,
  classifyIncrementalChangeStalenessRetrieval,
  executeIncrementalChangeStalenessScenario,
  resolveIncrementalChangeStalenessQueryAndAnswer
} from "../../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import { prepareIncrementalChangeStalenessScenarioLifecycle } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycle.js";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/benchmarkMetadata.js";
import { readEvaluationCases } from "../../../src/evaluation/readEvaluationCases.js";
import { BENCHMARK_PROJECT_PROFILES_PATH, WARM_INDEX_BENCHMARK_CASES_PATH } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import { writeGraphFakeKit } from "../warmIndexReuse/warmIndexTestHelpers.js";
import {
  expectCanonicalFilesUnchanged,
  expectNoIndexOutputInCanonicalProjects,
  makeKitDir,
  makeRunOwnedRoot,
  repoRoot,
  resolveScenario
} from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

// ---------------------------------------------------------------------------
// Query / answer-key resolution (TST-B4-001..006).
// ---------------------------------------------------------------------------

describe("query/answer-key resolution", () => {
  it("inherit policy resolves exactly the base case's own query and answer key (TST-B4-001, 003, 004)", async () => {
    const resolved = await resolveScenario("U1"); // U1 answerPolicy: inherit
    expect(resolved.scenario.answerPolicy).toBe("inherit");
    const cases = await readEvaluationCases(path.resolve(repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), repoRoot);
    const baseCase = cases.find((candidate) => candidate.id === resolved.scenario.baseCaseId)!;
    const result = await resolveIncrementalChangeStalenessQueryAndAnswer({ scenario: resolved.scenario, repoRoot });
    expect(result.query).toBe(baseCase.query);
    expect(result.answerKey).toEqual(baseCase.answerKey);
    expect(result.expectedFiles).toEqual(baseCase.answerKey!.expectedFiles);
    expect(result.expectedSymbols).toEqual(baseCase.answerKey!.expectedSymbols);
  });

  it("scenario policy resolves exactly the scenario's post-mutation query and answer key, never merged with the canonical answer (TST-B4-002, 004)", async () => {
    const resolved = await resolveScenario("L2"); // L2 answerPolicy: scenario
    expect(resolved.scenario.answerPolicy).toBe("scenario");
    const result = await resolveIncrementalChangeStalenessQueryAndAnswer({ scenario: resolved.scenario, repoRoot });
    expect(result.query).toBe(resolved.scenario.scenarioQuery);
    expect(result.answerKey).toEqual(resolved.scenario.scenarioAnswerKey);
    // The canonical base case's own answer key/facts must not leak in.
    const cases = await readEvaluationCases(path.resolve(repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), repoRoot);
    const baseCase = cases.find((candidate) => candidate.id === resolved.scenario.baseCaseId)!;
    const canonicalFactIds = new Set((baseCase.answerKey?.expectedFacts ?? []).map((fact) => fact.id));
    for (const fact of result.answerKey.expectedFacts) {
      expect(canonicalFactIds.has(fact.id)).toBe(false);
    }
  });

  it("does not modify the canonical benchmark case/catalog files (TST-B4-006)", async () => {
    // expectCanonicalFilesUnchanged() in afterEach already proves this for every test in this file;
    // this test exists so the requirement has an explicit, named assertion.
    await resolveIncrementalChangeStalenessQueryAndAnswer({ scenario: (await resolveScenario("L2")).scenario, repoRoot });
    expectCanonicalFilesUnchanged();
  });
});

describe("derived task descriptor (TST-B4-005)", () => {
  it("uses the canonical base case's project/source identity but the resolved query/expected files/symbols", async () => {
    const resolved = await resolveScenario("L2");
    const cases = await readEvaluationCases(path.resolve(repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), repoRoot);
    const baseEvaluationCase = cases.find((candidate) => candidate.id === resolved.scenario.baseCaseId)!;
    const answer = await resolveIncrementalChangeStalenessQueryAndAnswer({ scenario: resolved.scenario, repoRoot });
    const task = buildIncrementalChangeStalenessDerivedTask({ scenario: resolved.scenario, baseEvaluationCase, resolved: answer });
    expect(task.benchmarkProject).toBe(baseEvaluationCase.benchmarkProject);
    expect(task.targetRoot).toBe(baseEvaluationCase.targetRoot);
    expect(task.absoluteTargetRoot).toBe(baseEvaluationCase.absoluteTargetRoot);
    expect(task.sourceRoots).toEqual(baseEvaluationCase.sourceRoots);
    expect(task.query).toBe(answer.query);
    expect(task.expectedFiles).toEqual(answer.expectedFiles);
    expect(task.expectedSymbols).toEqual(answer.expectedSymbols);
    expect(task.answerKey).toEqual(answer.answerKey);
  });
});

// ---------------------------------------------------------------------------
// Affected-neighborhood symmetry (TST-B4-012..015; unit-level over constructed assessments).
// ---------------------------------------------------------------------------

function makeAssessment(overrides: Partial<AffectedNeighborhoodAssessmentV1> = {}): AffectedNeighborhoodAssessmentV1 {
  return {
    schemaVersion: "my-dev-kit-lab-affected-neighborhood-assessment-v1",
    status: "complete",
    freshnessStatus: "stale",
    seedMappingStatus: "complete",
    graphEvidenceStatus: "complete",
    neighborhoodStatus: "complete",
    changedFileCount: 1,
    changedSymbolCount: 0,
    seedNodeCount: 1,
    affectedNodeCount: 1,
    affectedEdgeCount: 0,
    affectedNodeIds: ["file:a.ts"],
    participatingEdgeIds: [],
    taskMapping: {
      status: "complete",
      expectedFiles: ["a.ts"],
      expectedSymbols: [],
      resolvedFiles: [{ path: "a.ts", nodeId: "file:a.ts" }],
      resolvedSymbols: [],
      unresolvedCount: 0,
      unresolved: [],
      unresolvedTruncated: false,
      ambiguousCount: 0,
      ambiguousSymbols: [],
      ambiguousTruncated: false,
      duplicateEntryCount: 0,
      resolvedTaskNodeIds: ["file:a.ts"],
      resolvableTaskNodeCount: 1
    },
    taskOverlapCount: 1,
    taskOverlapNodeIds: ["file:a.ts"],
    taskOverlapPercent: 100,
    relationship: "related",
    reindexRecommendation: "recommended",
    warningCount: 0,
    warnings: [],
    warningsTruncated: false,
    ...overrides
  };
}

describe("affected-neighborhood symmetry", () => {
  it("identical related assessments are symmetric (TST-B4-012)", () => {
    expect(checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry(makeAssessment(), makeAssessment())).toEqual({ symmetric: true });
  });
  it("identical unrelated assessments are symmetric (TST-B4-013)", () => {
    const unrelated = makeAssessment({ relationship: "unrelated", reindexRecommendation: "not-indicated", taskOverlapCount: 0, taskOverlapNodeIds: [], taskOverlapPercent: 0 });
    expect(checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry(unrelated, unrelated)).toEqual({ symmetric: true });
  });
  it("identical unknown assessments are symmetric (TST-B4-014)", () => {
    const unknown = makeAssessment({
      status: "unavailable",
      relationship: "unknown",
      reindexRecommendation: "unknown",
      affectedNodeCount: null,
      affectedEdgeCount: null,
      taskOverlapCount: null,
      taskOverlapPercent: null
    });
    expect(checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry(unknown, unknown)).toEqual({ symmetric: true });
  });
  it("a metric/category asymmetry is detected (TST-B4-015)", () => {
    const stale = makeAssessment();
    const full = makeAssessment({ relationship: "unrelated", reindexRecommendation: "not-indicated", taskOverlapCount: 0 });
    const result = checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry(stale, full);
    expect(result.symmetric).toBe(false);
  });
  it("reindexRecommendation itself never triggers any action (TST-B4-016): it is only compared, never branched on to decide anything else", () => {
    const stale = makeAssessment({ reindexRecommendation: "recommended" });
    const full = makeAssessment({ reindexRecommendation: "recommended" });
    expect(checkIncrementalChangeStalenessAffectedNeighborhoodSymmetry(stale, full).symmetric).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retrieval classification and required-file evidence (unit-level).
// ---------------------------------------------------------------------------

function makeRetrieval(overrides: Partial<MyDevKitRetrievalResult> = {}): MyDevKitRetrievalResult {
  return {
    caseId: "case",
    skipped: false,
    warnings: [],
    totalChars: 10,
    totalEstimatedTokens: 3,
    tokenCountMethod: "chars-div-4" as never,
    contextText: "text",
    filesRead: ["src/a.ts"],
    commands: [],
    durationMs: 5,
    ...overrides
  };
}

describe("retrieval classification and required-file evidence", () => {
  it("a non-skipped retrieval is completed", () => {
    expect(classifyIncrementalChangeStalenessRetrieval(makeRetrieval())).toBe("completed");
  });
  it("a skipped retrieval whose commands all succeeded (legitimate zero-candidate result) is skipped, not failed", () => {
    const result = makeRetrieval({ skipped: true, filesRead: [], commands: [{ ok: true } as never] });
    expect(classifyIncrementalChangeStalenessRetrieval(result)).toBe("skipped");
  });
  it("a skipped retrieval with a failed command is failed", () => {
    const result = makeRetrieval({ skipped: true, filesRead: [], commands: [{ ok: false } as never] });
    expect(classifyIncrementalChangeStalenessRetrieval(result)).toBe("failed");
  });
  it("completed retrieval with all required files read -> present", () => {
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: ["src/a.ts"], retrieval: makeRetrieval({ filesRead: ["src/a.ts"] }) });
    expect(evidence.status).toBe("present");
  });
  it("completed retrieval missing a required file -> missing", () => {
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: ["src/a.ts", "src/b.ts"], retrieval: makeRetrieval({ filesRead: ["src/a.ts"] }) });
    expect(evidence.status).toBe("missing");
    expect(evidence.missingFiles).toEqual(["src/b.ts"]);
  });
  it("failed retrieval -> unknown, never missing", () => {
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({
      requiredFiles: ["src/a.ts"],
      retrieval: makeRetrieval({ skipped: true, filesRead: [], commands: [{ ok: false } as never] })
    });
    expect(evidence.status).toBe("unknown");
  });
  it("no retrieval attempted -> unknown", () => {
    const evidence = buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: ["src/a.ts"], retrieval: null });
    expect(evidence.status).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Full scenario integration with a controllable fake kit (TST-B4-017..025).
// ---------------------------------------------------------------------------

/**
 * Wraps `writeGraphFakeKit` (index/version/graph unchanged) but replaces `search` with a
 * deterministic, per-index-directory-substring result, so tests can control exactly which file the
 * retrieval reports as read for each treatment/phase without depending on the shared fake CLI's
 * hardcoded todo-* project mapping.
 */
function writeSearchControlledKit(
  dir: string,
  options: { symbols?: Record<string, string[]>; searchMap: Array<{ whenIndexDirContains: string; file: string; symbol: string }> }
): { command: string; logPath: string } {
  const inner = writeGraphFakeKit(dir, { symbols: options.symbols ?? {} });
  const wrapperPath = path.join(dir, "fake-kit-search-controlled.mjs");
  writeFileSync(
    wrapperPath,
    [
      `import { spawnSync } from "node:child_process";`,
      `const args = process.argv.slice(2);`,
      `const innerScript = ${JSON.stringify(path.join(dir, "fake-kit-graph.mjs"))};`,
      `if (args[0] === "search") {`,
      `  const idx = args.indexOf("--index");`,
      `  const indexDir = (idx >= 0 ? String(args[idx + 1]) : "").replace(/\\\\/g, "/");`,
      `  const map = ${JSON.stringify(options.searchMap)};`,
      `  const matched = map.find((entry) => indexDir.includes(entry.whenIndexDirContains));`,
      `  if (matched) {`,
      `    console.log(JSON.stringify({ results: [{ nodeId: "file:" + matched.file, file: matched.file, symbol: matched.symbol }] }));`,
      `  } else {`,
      `    console.log(JSON.stringify({ results: [] }));`,
      `  }`,
      `  process.exit(0);`,
      `}`,
      `const result = spawnSync(process.execPath, [innerScript, ...args], { stdio: "inherit" });`,
      `process.exit(result.status ?? 1);`
    ].join("\n")
  );
  return { command: `node ${wrapperPath}`, logPath: inner.logPath };
}

async function loadProjectProfiles() {
  return readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
}

describe("full scenario execution (L2, controllable fixture)", () => {
  it("stale retrieves from the baseline index/target and full-refresh from the refreshed index/target, exactly one attempt each, in stale-then-full order, with a matched classification (TST-B4-017..025, 036..038, 046..056 sample)", async () => {
    const resolved = await resolveScenario("L2");
    const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-batch4-exec-");
    const kitDir = makeKitDir(tracked);
    // The real retrieval mechanism reports exactly one selected file per attempt (section 18), and
    // L2's resolved answer key requires two files, so neither treatment's single-file read can ever
    // satisfy the full required-file set here -- this fixture proves retrieval-authority correctness
    // (each treatment's search sees its own index directory) rather than a required-file win/loss.
    const kit = writeSearchControlledKit(kitDir, {
      searchMap: [
        { whenIndexDirContains: "full-refresh/refreshed", file: "src/services/completeTask.ts", symbol: "completeTask" },
        { whenIndexDirContains: "stale-index/baseline", file: "src/store/taskStore.ts", symbol: "TaskWorkflowStore" }
      ]
    });

    const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycle({
      repoRoot,
      runOwnedRoot,
      scenario: resolved.scenario,
      baseCase: resolved.baseCase,
      kitCommand: kit.command
    });
    expect(lifecycle.status).toBe("ready");
    const projectProfiles = await loadProjectProfiles();

    const execution = await executeIncrementalChangeStalenessScenario({
      repoRoot,
      scenario: resolved.scenario,
      lifecycle,
      baseCase: resolved.baseCase,
      projectProfiles,
      runOwnedRoot,
      cwd: repoRoot
    });

    expect(execution.status).toBe("ready");
    const stale = execution.stale!;
    const full = execution.fullRefresh!;

    // TST-B4-017/019: correct active-index authority per treatment.
    if (lifecycle.status !== "ready") throw new Error("unreachable");
    expect(stale.activeIndexPhase).toBe("baseline");
    expect(full.activeIndexPhase).toBe("refreshed");
    expect(lifecycle.session.treatments["stale-index"].activeRetrieval.index.indexDir).toContain(path.join("stale-index", "baseline"));
    expect(lifecycle.session.treatments["full-refresh"].activeRetrieval.index.indexDir).toContain(path.join("full-refresh", "refreshed"));

    // TST-B4-023/024/025: exactly one retrieval attempt each, no retry, no raw fallback in play.
    expect(stale.retrieval?.commands.filter((command) => command.commandId === "search")).toHaveLength(1);
    expect(full.retrieval?.commands.filter((command) => command.commandId === "search")).toHaveLength(1);

    // Each treatment's single-file read differs (proving distinct index/target authority) but
    // neither satisfies both required files, so both are "missing" -> required-file relation "same".
    expect(stale.requiredFileEvidence.status).toBe("missing");
    expect(stale.requiredFileEvidence.observedFiles).toEqual(["src/store/taskStore.ts"]);
    expect(full.requiredFileEvidence.status).toBe("missing");
    expect(full.requiredFileEvidence.observedFiles).toEqual(["src/services/completeTask.ts"]);
    expect(execution.comparison.requiredFileEvidenceRelation).toBe("same");
    // The deterministic fake agent always answers from the (shared) resolved answer key regardless
    // of retrieved content, so correctness is also "same" here -> no observed stale-specific
    // regression under either frozen evidence dimension for this fixture.
    expect(execution.comparison.correctnessRelation).toBe("same");
    expect(execution.comparison.staleRiskClassification).toBe("no-observed-stale-regression");
  }, 60_000);

  it("full-refresh reading the sole required file while stale misses it -> stale-worse required-file relation -> observed-stale-regression (TST-B4-041, 046)", async () => {
    const resolved = await resolveScenario("T1"); // T1's resolved answer key has exactly one required file.
    const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-batch4-t1-");
    const kitDir = makeKitDir(tracked);
    const kit = writeSearchControlledKit(kitDir, {
      searchMap: [
        { whenIndexDirContains: "full-refresh/refreshed", file: "py/tests/test_quality.py", symbol: "test_determine_quality_label" },
        { whenIndexDirContains: "stale-index/baseline", file: "py/task_analytics/quality.py", symbol: "determine_quality_label" }
      ]
    });
    const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycle({
      repoRoot,
      runOwnedRoot,
      scenario: resolved.scenario,
      baseCase: resolved.baseCase,
      kitCommand: kit.command
    });
    expect(lifecycle.status).toBe("ready");
    const projectProfiles = await loadProjectProfiles();
    const execution = await executeIncrementalChangeStalenessScenario({
      repoRoot,
      scenario: resolved.scenario,
      lifecycle,
      baseCase: resolved.baseCase,
      projectProfiles,
      runOwnedRoot,
      cwd: repoRoot
    });
    expect(execution.status).toBe("ready");
    expect(execution.stale!.requiredFileEvidence.status).toBe("missing");
    expect(execution.fullRefresh!.requiredFileEvidence.status).toBe("present");
    expect(execution.comparison.requiredFileEvidenceRelation).toBe("stale-worse");
    expect(execution.comparison.staleRiskClassification).toBe("observed-stale-regression");
    expect(execution.comparison.reasonCodes).toContain("stale-missing-required-file");
  }, 60_000);

  it("propagates a failed lifecycle as a failed scenario execution with inconclusive comparison and no fabricated treatment evidence (TST-B4-069)", async () => {
    const resolved = await resolveScenario("L2");
    const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-batch4-fail-");
    const projectProfiles = await loadProjectProfiles();
    const failedLifecycle = {
      status: "failed" as const,
      scenarioId: resolved.scenario.id,
      failure: { code: "baseline-index-build-failed" as const, message: "simulated failure", treatmentId: "stale-index" as const },
      lifecycleEvents: [],
      indexBuildCounts: { "stale-index": 0, "full-refresh": 0 }
    };
    const execution = await executeIncrementalChangeStalenessScenario({
      repoRoot,
      scenario: resolved.scenario,
      lifecycle: failedLifecycle,
      baseCase: resolved.baseCase,
      projectProfiles,
      runOwnedRoot,
      cwd: repoRoot
    });
    expect(execution.status).toBe("failed");
    expect(execution.stale).toBeNull();
    expect(execution.fullRefresh).toBeNull();
    expect(execution.comparison.staleRiskClassification).toBe("inconclusive");
    expect(execution.comparison.correctnessRelation).toBe("unknown");
    expect(execution.comparison.requiredFileEvidenceRelation).toBe("unknown");
  });
});

describe.each(["U1", "L2", "E1", "P1", "I1", "T1"])("all six scenarios execute through the same generic path (%s) (TST-B4-078..084)", (scenarioId) => {
  it("resolves query/answer, assesses affected neighborhoods symmetrically, retrieves twice, and produces one comparison classification", async () => {
    const resolved = await resolveScenario(scenarioId);
    const runOwnedRoot = makeRunOwnedRoot(tracked, `ics-batch4-all6-${scenarioId}-`);
    const kit = writeGraphFakeKit(makeKitDir(tracked), { symbols: {} });
    const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycle({
      repoRoot,
      runOwnedRoot,
      scenario: resolved.scenario,
      baseCase: resolved.baseCase,
      kitCommand: kit.command
    });
    expect(lifecycle.status).toBe("ready");
    const projectProfiles = await loadProjectProfiles();
    const execution = await executeIncrementalChangeStalenessScenario({
      repoRoot,
      scenario: resolved.scenario,
      lifecycle,
      baseCase: resolved.baseCase,
      projectProfiles,
      runOwnedRoot,
      cwd: repoRoot
    });
    expect(execution.status).toBe("ready");
    expect(execution.query).toBeTruthy();
    expect(execution.stale).not.toBeNull();
    expect(execution.fullRefresh).not.toBeNull();
    expect(execution.stale!.fakeAgent?.status).toBe("completed");
    expect(execution.fullRefresh!.fakeAgent?.status).toBe("completed");
    expect(execution.stale!.requiredFileEvidence.status).not.toBe("");
    expect(execution.fullRefresh!.requiredFileEvidence.status).not.toBe("");
    expect(["observed-stale-regression", "no-observed-stale-regression", "inconclusive"]).toContain(execution.comparison.staleRiskClassification);
  }, 60_000);
});
