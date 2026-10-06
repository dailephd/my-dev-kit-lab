import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm as realRm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETRIEVAL_QUERY_STRATEGY_IDS, type RetrievalQueryStrategyId } from "../../src/evaluation/retrievalQueryStrategies.js";
import type { RetrievalQueryStrategyEvidenceV1 } from "../../src/evaluation/retrievalQueryStrategyEvidence.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";
import {
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_SCHEMA_VERSION,
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_VARIANTS,
  buildQueryStrategyTreatmentEvidence,
  buildRetrievalQueryStrategyComparisonExecutionArtifact,
  defaultRetrievalQueryStrategyComparisonConfig,
  executeRetrievalQueryStrategyComparison,
  retrievalQueryStrategyComparisonPlugin,
  validateRetrievalQueryStrategyComparisonConfig,
  type RetrievalQueryStrategyComparisonConfig,
  type RetrievalQueryStrategyComparisonDependencies,
  type RetrievalQueryStrategyComparisonRun
} from "../../src/experiments/plugins/retrievalQueryStrategyComparison/index.js";
import type { ExperimentExecutionContext, ExperimentTarget } from "../../src/experiments/types.js";
import {
  COMMAND_PATH_SENTINEL,
  indexResultOf,
  makeEvaluationCase,
  retrievalResultOf,
  SOURCE_SENTINEL,
  STDERR_SENTINEL,
  STDOUT_SENTINEL
} from "./retrievalPrecisionRecall/retrievalPrecisionRecallTestHelpers.js";

// Controllable filesystem faults for the Lab-owned copy/removal mechanics; everything else passes through.
const fsFaults = vi.hoisted(() => ({ failCopySuffix: null as string | null, failRemoveSuffix: null as string | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const endsWith = (target: unknown, suffix: string | null) =>
    suffix !== null && String(target).replace(/\\/g, "/").endsWith(suffix);
  return {
    ...actual,
    cp: async (source: Parameters<typeof actual.cp>[0], destination: Parameters<typeof actual.cp>[1], options?: Parameters<typeof actual.cp>[2]) => {
      if (endsWith(destination, fsFaults.failCopySuffix)) throw new Error("injected copy failure");
      return actual.cp(source, destination, options);
    },
    rm: async (target: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
      if (endsWith(target, fsFaults.failRemoveSuffix)) throw new Error("injected remove failure");
      return actual.rm(target, options);
    }
  };
});

const tempDirs: string[] = [];
beforeEach(() => {
  fsFaults.failCopySuffix = null;
  fsFaults.failRemoveSuffix = null;
});
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => realRm(dir, { recursive: true, force: true })));
});
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rqsc-"));
  tempDirs.push(dir);
  return dir;
};

const SECRET_MARKERS = [SOURCE_SENTINEL, STDOUT_SENTINEL, STDERR_SENTINEL, COMMAND_PATH_SENTINEL];

const evidenceFor = (
  strategyId: RetrievalQueryStrategyId,
  availability: RetrievalQueryStrategyEvidenceV1["availability"] = "available",
  files: string[] = ["src/a.ts"]
): RetrievalQueryStrategyEvidenceV1 => ({
  schemaVersion: "retrieval-query-strategy-evidence-v1",
  strategyId,
  availability,
  availabilityReason: availability === "available" ? null : "fixed-reason",
  files: files.map((file) => ({ path: file })),
  symbols: files.length > 0 ? [{ name: "A", nodeId: null, file: files[0] }] : [],
  steps: [{ kind: "search", succeeded: true, evidenceAvailable: true, reason: null }]
});

type Call = { strategyId: string; caseId: string; indexDir: string; existedAtCall?: boolean; hadBaseMarker?: boolean };

type Harness = {
  dependencies: RetrievalQueryStrategyComparisonDependencies;
  builds: Array<{ indexDir: string; absoluteTargetRoot: string }>;
  calls: Call[];
};

function makeHarness(
  options: {
    buildOk?: boolean;
    buildThrows?: boolean;
    evidence?: (strategyId: RetrievalQueryStrategyId, caseId: string) => RetrievalQueryStrategyEvidenceV1;
    skipped?: (strategyId: RetrievalQueryStrategyId) => boolean;
    throwFor?: RetrievalQueryStrategyId;
    warningFor?: (strategyId: RetrievalQueryStrategyId) => string[];
  } = {}
): Harness {
  const builds: Harness["builds"] = [];
  const calls: Call[] = [];
  const evidence = options.evidence ?? ((strategyId) => evidenceFor(strategyId));
  return {
    builds,
    calls,
    dependencies: {
      async buildIndex(args) {
        builds.push({ indexDir: args.indexDir, absoluteTargetRoot: args.target.absoluteTargetRoot });
        if (options.buildThrows) throw new Error(`boom ${COMMAND_PATH_SENTINEL}`);
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(args.indexDir, { recursive: true });
        await writeFile(path.join(args.indexDir, "base-marker.txt"), "base");
        return indexResultOf(args.indexDir, options.buildOk ?? true);
      },
      async runCoreStrategy(args) {
        calls.push({ strategyId: args.strategyId, caseId: args.evaluationCase.id, indexDir: args.indexDir });
        if (options.throwFor === args.strategyId) throw new Error(`thrown ${COMMAND_PATH_SENTINEL}`);
        return {
          ...retrievalResultOf(args.evaluationCase, undefined, { skipped: options.skipped?.(args.strategyId), warnings: options.warningFor?.(args.strategyId) }),
          queryStrategyEvidence: evidence(args.strategyId, args.evaluationCase.id)
        };
      },
      async runSemanticStrategy(args) {
        const { writeFile } = await import("node:fs/promises");
        const existedAtCall = existsSync(args.indexDir);
        const hadBaseMarker = existsSync(path.join(args.indexDir, "base-marker.txt"));
        calls.push({ strategyId: args.strategyId, caseId: args.evaluationCase.id, indexDir: args.indexDir, existedAtCall, hadBaseMarker });
        // Mimic upstream `data-model`, which writes derived artifacts into the supplied index directory.
        await writeFile(path.join(args.indexDir, `derived-${args.strategyId}.json`), "{}");
        if (options.throwFor === args.strategyId) throw new Error(`thrown ${COMMAND_PATH_SENTINEL}`);
        return {
          caseId: args.evaluationCase.id,
          strategyId: args.strategyId,
          skipped: options.skipped?.(args.strategyId) ?? false,
          warnings: options.warningFor?.(args.strategyId) ?? [],
          totalChars: 400,
          totalEstimatedTokens: 100,
          tokenCountMethod: "estimated_chars_div_4",
          contextText: SOURCE_SENTINEL,
          commands: [{ ...retrievalResultOf(args.evaluationCase, undefined).commands[0], stdout: STDOUT_SENTINEL, stderr: STDERR_SENTINEL }],
          queryStrategyEvidence: evidence(args.strategyId, args.evaluationCase.id),
          durationMs: 5
        };
      }
    }
  };
}

const twoCases = [
  makeEvaluationCase({ id: "m1", project: "project-a" }),
  makeEvaluationCase({ id: "m2", project: "project-a" })
];

async function execute(cases: readonly EvaluationCase[], harness: Harness, outputRoot = tempDir()) {
  const result = await executeRetrievalQueryStrategyComparison({
    cases,
    kitCommand: "fake-kit",
    outputRoot,
    dependencies: harness.dependencies
  });
  return { result, outputRoot };
}

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

function contextOf(
  harness: Harness,
  cases: readonly EvaluationCase[],
  options: { config?: unknown; target?: ExperimentTarget; outputRoot?: string } = {}
): ExperimentExecutionContext<RetrievalQueryStrategyComparisonConfig> {
  return {
    runId: "run-1",
    startedAt: new Date(),
    toolRoot: process.cwd(),
    target: options.target ?? selfTarget(),
    config: configOf(options.config),
    outputRoot: options.outputRoot ?? tempDir(),
    inputs: { cases, retrievalDependencies: harness.dependencies }
  };
}
function configOf(config?: unknown): RetrievalQueryStrategyComparisonConfig {
  const validated = validateRetrievalQueryStrategyComparisonConfig(config);
  if (!validated.valid) throw new Error(validated.errors.join(" "));
  return validated.config as RetrievalQueryStrategyComparisonConfig;
}

describe("plugin metadata and config", () => {
  it("TST-081-027 declares the frozen metadata and seven ordered variants", () => {
    expect(retrievalQueryStrategyComparisonPlugin.metadata).toEqual({
      id: "retrieval-query-strategy-comparison",
      name: "Retrieval Query Strategy Comparison",
      description:
        "Compare seven deterministic my-dev-kit retrieval query strategies on matched bundled benchmark cases without coding agents.",
      schemaVersion: "1.0.0",
      status: "experimental",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "html", "text", "artifact"]
    });
    expect(retrievalQueryStrategyComparisonPlugin.supportedVariants).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
    expect(RETRIEVAL_QUERY_STRATEGY_COMPARISON_VARIANTS.map((variant) => variant.id)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
  });

  it("TST-081-028 validates the closed config and rejects strategy filtering", () => {
    expect(defaultRetrievalQueryStrategyComparisonConfig).toEqual({
      outDir: "lab-output/retrieval-query-strategy-comparison",
      kitCommand: "npx @dailephd/my-dev-kit@latest"
    });
    expect(validateRetrievalQueryStrategyComparisonConfig(undefined)).toMatchObject({ valid: true });
    expect(validateRetrievalQueryStrategyComparisonConfig({ caseIds: ["a"], benchmarkProjects: ["p"] })).toMatchObject({ valid: true });
    expect(validateRetrievalQueryStrategyComparisonConfig("nope").valid).toBe(false);
    expect(validateRetrievalQueryStrategyComparisonConfig({ caseIds: [] }).valid).toBe(false);
    expect(validateRetrievalQueryStrategyComparisonConfig({ kitCommand: " " }).valid).toBe(false);
    const unknown = validateRetrievalQueryStrategyComparisonConfig({ zeta: 1, alpha: 2 });
    expect(unknown.valid).toBe(false);
    expect(unknown.errors).toContain("Unsupported retrieval-query-strategy-comparison config field(s): alpha, zeta.");
    const strategies = validateRetrievalQueryStrategyComparisonConfig({ strategies: ["keyword-search"] });
    expect(strategies.valid).toBe(false);
    expect(strategies.errors).toContain("Unsupported retrieval-query-strategy-comparison config field(s): strategies.");
  });
});

describe("matched execution", () => {
  it("TST-081-029 returns a rectangular seven-treatment matrix per case", async () => {
    const { result } = await execute(twoCases, makeHarness());
    expect(result).toHaveLength(2);
    for (const entry of result) {
      expect(entry.treatments).toHaveLength(7);
      expect(entry.treatments.map((treatment) => treatment.strategyId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
      expect(entry.treatments.every((treatment) => treatment.status === "completed")).toBe(true);
    }
  });

  it("TST-081-030 builds one base index per project and shares it with every core strategy", async () => {
    const harness = makeHarness();
    const cases = [...twoCases, makeEvaluationCase({ id: "l1", project: "project-b" })];
    const { result } = await execute(cases, harness);
    expect(result).toHaveLength(3);
    expect(harness.builds).toHaveLength(2);
    const baseByProject = new Map(harness.builds.map((build) => [path.basename(path.dirname(build.indexDir)), build.indexDir]));
    expect(harness.builds.every((build) => path.basename(build.indexDir) === "base")).toBe(true);
    const coreCalls = harness.calls.filter((call) => !["data-model-graph", "model-view-lineage"].includes(call.strategyId));
    expect(coreCalls).toHaveLength(15);
    for (const call of coreCalls) {
      const project = call.caseId === "l1" ? "project-b" : "project-a";
      expect(call.indexDir).toBe(baseByProject.get(project));
    }
  });

  it("TST-081-031 gives each semantic treatment a private copy derived from an untouched base index", async () => {
    const harness = makeHarness();
    const { outputRoot } = await execute([twoCases[0]], harness);
    const base = harness.builds[0].indexDir;
    const dmg = harness.calls.find((call) => call.strategyId === "data-model-graph")!;
    const mvl = harness.calls.find((call) => call.strategyId === "model-view-lineage")!;
    expect(dmg.indexDir).not.toBe(base);
    expect(mvl.indexDir).not.toBe(base);
    expect(dmg.indexDir).not.toBe(mvl.indexDir);
    for (const call of [dmg, mvl]) {
      expect(call.existedAtCall).toBe(true);
      expect(call.hadBaseMarker).toBe(true);
    }
    // Neither semantic treatment mutated the base index, and neither copy leaks the other's derived artifacts.
    expect(existsSync(path.join(base, "base-marker.txt"))).toBe(true);
    expect(existsSync(path.join(base, "derived-data-model-graph.json"))).toBe(false);
    expect(existsSync(path.join(base, "derived-model-view-lineage.json"))).toBe(false);
    expect(path.relative(outputRoot, dmg.indexDir).replace(/\\/g, "/")).toMatch(/^strategy-indexes\/project-a\/m1\/data-model-graph$/);
    // Copies are temporary execution state and are removed after measurement.
    expect(existsSync(dmg.indexDir)).toBe(false);
    expect(existsSync(mvl.indexDir)).toBe(false);
  });

  it("TST-081-032 never reuses a semantic copy between cases", async () => {
    const harness = makeHarness();
    await execute(twoCases, harness);
    const dirsOf = (strategyId: string) => harness.calls.filter((call) => call.strategyId === strategyId).map((call) => call.indexDir);
    for (const strategyId of ["data-model-graph", "model-view-lineage"]) {
      const dirs = dirsOf(strategyId);
      expect(dirs).toHaveLength(2);
      expect(new Set(dirs).size).toBe(2);
    }
    const all = [...dirsOf("data-model-graph"), ...dirsOf("model-view-lineage")];
    expect(new Set(all).size).toBe(4);
  });

  it("TST-081-033 executes treatments sequentially in the frozen order for every case", async () => {
    const harness = makeHarness();
    await execute(twoCases, harness);
    expect(harness.calls.map((call) => `${call.caseId}:${call.strategyId}`)).toEqual(
      twoCases.flatMap((entry) => RETRIEVAL_QUERY_STRATEGY_IDS.map((strategyId) => `${entry.id}:${strategyId}`))
    );
  });

  it("TST-081-034 treats an available empty retrieval as completed", async () => {
    const harness = makeHarness({
      skipped: () => true,
      evidence: (strategyId) => evidenceFor(strategyId, "available", [])
    });
    const { result } = await execute([twoCases[0]], harness);
    for (const treatment of result[0].treatments) {
      expect(treatment.status).toBe("completed");
      expect(treatment.retrieval?.skipped).toBe(true);
      expect(treatment.retrieval?.retrievedFileCount).toBe(0);
    }
  });

  it("TST-081-035 maps partial and unavailable evidence to partial and a thrown executor to failed", async () => {
    const partial = await execute([twoCases[0]], makeHarness({ evidence: (id) => evidenceFor(id, "partial") }));
    expect(partial.result[0].treatments.every((t) => t.status === "partial")).toBe(true);
    const unavailable = await execute([twoCases[0]], makeHarness({ evidence: (id) => evidenceFor(id, "unavailable", []) }));
    expect(unavailable.result[0].treatments.every((t) => t.status === "partial")).toBe(true);
    expect(unavailable.result[0].treatments[0].retrieval?.evidenceAvailability).toBe("unavailable");
    const thrown = await execute([twoCases[0]], makeHarness({ throwFor: "source-slice" }));
    expect(thrown.result[0].treatments.find((t) => t.strategyId === "source-slice")?.status).toBe("failed");
  });

  it("TST-081-036 fails all seven treatments for invalid ground truth without running a strategy", async () => {
    const harness = makeHarness();
    const invalid = { ...makeEvaluationCase({ id: "bad", project: "project-a" }), answerKey: undefined };
    const { result } = await execute([invalid, twoCases[0]], harness);
    expect(result.map((entry) => entry.caseId)).toEqual(["bad", "m1"]);
    expect(result[0].treatments.map((t) => t.status)).toEqual(Array(7).fill("failed"));
    expect(result[0].treatments.every((t) => t.errors[0].code === "ground-truth-invalid")).toBe(true);
    expect(harness.calls.some((call) => call.caseId === "bad")).toBe(false);
    expect(result[1].treatments.every((t) => t.status === "completed")).toBe(true);
  });

  it("TST-081-037 fails a structurally inconsistent project group without indexing it", async () => {
    const harness = makeHarness();
    const cases = [
      makeEvaluationCase({ id: "x1", project: "project-x", sourceRoots: ["src"] }),
      makeEvaluationCase({ id: "x2", project: "project-x", sourceRoots: ["lib"] })
    ];
    const { result } = await execute(cases, harness);
    expect(harness.builds).toHaveLength(0);
    expect(harness.calls).toHaveLength(0);
    for (const entry of result) {
      expect(entry.treatments).toHaveLength(7);
      expect(entry.treatments.every((t) => t.status === "failed" && t.errors[0].code === "project-group-inconsistent")).toBe(true);
    }
  });

  it("TST-081-038 fails every case of a project whose index failed, whether it returned ok=false or threw", async () => {
    for (const options of [{ buildOk: false }, { buildThrows: true }]) {
      const harness = makeHarness(options);
      const { result } = await execute(twoCases, harness);
      expect(harness.calls).toHaveLength(0);
      for (const entry of result) {
        expect(entry.treatments.every((t) => t.status === "failed" && t.errors[0].code === "project-index-failed")).toBe(true);
        expect(JSON.stringify(entry)).not.toContain("sentinel-user");
      }
    }
  });

  it("TST-081-039 keeps the matrix when one strategy throws", async () => {
    const harness = makeHarness({ throwFor: "graph-neighborhood" });
    const { result } = await execute([twoCases[0]], harness);
    const treatments = result[0].treatments;
    expect(treatments).toHaveLength(7);
    expect(treatments[2]).toMatchObject({ strategyId: "graph-neighborhood", status: "failed", retrieval: null, evidence: null });
    expect(treatments[2].errors).toEqual([{ code: "retrieval-failed", message: "The retrieval strategy threw before producing a measurement." }]);
    expect(harness.calls.map((call) => call.strategyId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
    expect(JSON.stringify(treatments)).not.toContain("sentinel-user");
  });

  it("TST-081-040 contains a semantic copy failure to that treatment", async () => {
    fsFaults.failCopySuffix = "/data-model-graph";
    const harness = makeHarness();
    const { result } = await execute([twoCases[0]], harness);
    const treatments = result[0].treatments;
    expect(treatments[4]).toMatchObject({ strategyId: "data-model-graph", status: "failed" });
    expect(treatments[4].errors).toEqual([
      { code: "strategy-index-copy-failed", message: "The isolated semantic-strategy index could not be prepared." }
    ]);
    expect(harness.calls.map((call) => call.strategyId)).not.toContain("data-model-graph");
    expect(harness.calls.map((call) => call.strategyId)).toContain("model-view-lineage");
    expect(treatments.filter((t) => t.status === "completed")).toHaveLength(6);
  });

  it("records a path-free warning when semantic index cleanup fails and keeps the measurement", async () => {
    const harness = makeHarness();
    const runSemantic = harness.dependencies.runSemanticStrategy;
    // Only the post-measurement removal may fail; the pre-copy removal must still succeed.
    harness.dependencies.runSemanticStrategy = async (args) => {
      const result = await runSemantic(args);
      if (args.strategyId === "model-view-lineage") fsFaults.failRemoveSuffix = "/model-view-lineage";
      return result;
    };
    const { result } = await execute([twoCases[0]], harness);
    const lineage = result[0].treatments[5];
    expect(lineage.status).toBe("completed");
    expect(lineage.retrieval?.warnings).toEqual(["semantic-index-cleanup-failed"]);
    expect(result[0].treatments[4].retrieval?.warnings).toEqual([]);
  });

  it("TST-081-070 records both the retrieval failure and a path-free cleanup failure when the executor throws", async () => {
    const throwing = makeHarness({ throwFor: "model-view-lineage" });
    const throwingSemantic = throwing.dependencies.runSemanticStrategy;
    throwing.dependencies.runSemanticStrategy = async (args) => {
      if (args.strategyId === "model-view-lineage") fsFaults.failRemoveSuffix = "/model-view-lineage";
      return throwingSemantic(args);
    };
    const { result } = await execute([twoCases[0]], throwing);
    const lineage = result[0].treatments[5];
    expect(lineage.status).toBe("failed");
    expect(lineage.retrieval).toBeNull();
    expect(lineage.errors).toEqual([
      { code: "retrieval-failed", message: "The retrieval strategy threw before producing a measurement." },
      { code: "strategy-index-cleanup-failed", message: "The isolated semantic-strategy index could not be removed." }
    ]);
    expect(JSON.stringify(lineage.errors)).not.toMatch(/[A-Za-z]:[\/]|strategy-indexes/);
    expect(result[0].treatments[4].errors).toEqual([]);
  });

  it("TST-081-071 keeps a valid measurement and only warns when cleanup fails after it", async () => {
    const harness = makeHarness();
    const runSemantic = harness.dependencies.runSemanticStrategy;
    harness.dependencies.runSemanticStrategy = async (args) => {
      const result = await runSemantic(args);
      if (args.strategyId === "model-view-lineage") fsFaults.failRemoveSuffix = "/model-view-lineage";
      return result;
    };
    const { result } = await execute([twoCases[0]], harness);
    const lineage = result[0].treatments[5];
    expect(lineage.status).toBe("completed");
    expect(lineage.retrieval?.warnings).toContain("semantic-index-cleanup-failed");
    expect(lineage.errors).toEqual([]);
    expect(lineage.errors.map((error) => error.code)).not.toContain("strategy-index-cleanup-failed");
  });

  it("TST-081-041 persists no raw context, stdout, stderr, or command paths", async () => {
    const harness = makeHarness({ warningFor: () => [`bad ${COMMAND_PATH_SENTINEL}`] });
    const { result } = await execute(twoCases, harness);
    const artifact = buildRetrievalQueryStrategyComparisonExecutionArtifact({
      runId: "r",
      pluginId: "retrieval-query-strategy-comparison",
      pluginSchemaVersion: "1.0.0",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      cases: result
    });
    const serialized = JSON.stringify(artifact);
    for (const marker of SECRET_MARKERS) expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain("sentinel-user");
    expect(serialized).not.toContain("contextText");
  });

  it("normalizes a result without accepting contextText", () => {
    const treatment = buildQueryStrategyTreatmentEvidence("keyword-search", {
      skipped: false,
      warnings: ["w"],
      totalEstimatedTokens: 3,
      tokenCountMethod: "estimated_chars_div_4",
      durationMs: 1,
      queryStrategyEvidence: evidenceFor("keyword-search")
    });
    expect(treatment).toMatchObject({ strategyId: "keyword-search", status: "completed", errors: [] });
    expect(treatment.retrieval).toEqual({
      skipped: false,
      durationMs: 1,
      totalEstimatedTokens: 3,
      tokenCountMethod: "estimated_chars_div_4",
      warnings: ["w"],
      evidenceAvailability: "available",
      evidenceAvailabilityReason: null,
      retrievedFileCount: 1,
      retrievedSymbolCount: 1,
      steps: [{ kind: "search", succeeded: true, evidenceAvailable: true, reason: null }]
    });
  });
});

describe("execution artifact and plugin run", () => {
  it("TST-081-042 builds a detached analysis-free execution artifact in case order", async () => {
    const { result } = await execute(twoCases, makeHarness());
    const artifact = buildRetrievalQueryStrategyComparisonExecutionArtifact({
      runId: "r",
      pluginId: "retrieval-query-strategy-comparison",
      pluginSchemaVersion: "1.0.0",
      startedAt: "s",
      completedAt: "c",
      cases: result
    });
    expect(artifact.schemaVersion).toBe("my-dev-kit-lab-retrieval-query-strategy-comparison-execution-v1");
    expect(artifact.schemaVersion).toBe(RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_SCHEMA_VERSION);
    expect(artifact.strategyOrder).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
    expect(artifact.cases.map((entry) => entry.caseId)).toEqual(["m1", "m2"]);
    expect(artifact.cases).not.toBe(result);
    expect(Object.keys(artifact).sort()).toEqual(
      ["cases", "completedAt", "pluginId", "pluginSchemaVersion", "runId", "schemaVersion", "startedAt", "strategyOrder"]
    );
    const serialized = JSON.stringify(artifact);
    for (const forbidden of ["aggregate", "winner", "ranking", "quality", "contextText"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("TST-081-043 runs the plugin on the self target and maps outcomes with scientific metrics", async () => {
    const harness = makeHarness();
    const outputRoot = tempDir();
    const run: RetrievalQueryStrategyComparisonRun = await retrievalQueryStrategyComparisonPlugin.run(
      contextOf(harness, [...twoCases, makeEvaluationCase({ id: "l1", project: "project-b" })], { outputRoot })
    );
    expect(run.pluginId).toBe("retrieval-query-strategy-comparison");
    expect(run.variants.map((variant) => variant.id)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
    expect(run.cases.map((entry) => entry.id)).toEqual(["m1", "m2", "l1"]);
    for (const entry of run.cases) {
      expect(entry.outcomes).toHaveLength(7);
      expect(entry.outcomes.map((outcome) => outcome.variantId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
      expect(entry.outcomes.every((outcome) => outcome.metrics.length === 14 && outcome.artifacts.length === 0)).toBe(true);
      expect(entry.outcomes[0].id).toBe(`${entry.id}:keyword-search`);
    }
    expect(run.metrics).toHaveLength(4 * (1 + 7 * 4));
    expect(run.failures).toEqual([]);
    expect(run.status).toBe("completed");
    expect(run.artifacts.map((artifact) => artifact.id)).toEqual([
      "retrieval-query-strategy-comparison-execution",
      "retrieval-query-strategy-comparison-analysis"
    ]);
    expect(run.summary).toBeDefined();
    expect(retrievalQueryStrategyComparisonPlugin.summarize?.(run, contextOf(harness, twoCases))).toBe(run.summary);
    const artifactPath = run.artifacts[0].path as string;
    expect(path.basename(artifactPath)).toBe("retrieval-query-strategy-comparison-execution.json");
    const written = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(written.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["m1", "m2", "l1"]);
  });

  it("TST-081-066 writes separate execution and analysis artifacts", async () => {
    const outputRoot = tempDir();
    const run = await retrievalQueryStrategyComparisonPlugin.run(contextOf(makeHarness(), twoCases, { outputRoot }));
    expect(run.artifacts.map((artifact) => artifact.id)).toEqual([
      "retrieval-query-strategy-comparison-execution",
      "retrieval-query-strategy-comparison-analysis"
    ]);
    const execution = JSON.parse(readFileSync(run.artifacts[0].path as string, "utf8"));
    const analysis = JSON.parse(readFileSync(run.artifacts[1].path as string, "utf8"));
    expect(path.basename(run.artifacts[1].path as string)).toBe("retrieval-query-strategy-comparison-analysis.json");
    expect(execution.schemaVersion).toBe("my-dev-kit-lab-retrieval-query-strategy-comparison-execution-v1");
    expect(Object.keys(execution)).not.toContain("analysis");
    expect(JSON.stringify(execution)).not.toContain("fileF1");
    expect(analysis.schemaVersion).toBe("my-dev-kit-lab-retrieval-query-strategy-comparison-analysis-v1");
    expect(analysis.analysis.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["m1", "m2"]);
    expect(analysis.analysis).toEqual(run.analysis);
    expect(run.metadata).toEqual({ executionArtifactPath: run.artifacts[0].path, analysisArtifactPath: run.artifacts[1].path });
    for (const marker of SECRET_MARKERS) expect(JSON.stringify(analysis)).not.toContain(marker);
  });

  it("derives per-outcome failures and run status from treatments", async () => {
    const harness = makeHarness({ throwFor: "keyword-search" });
    const run = await retrievalQueryStrategyComparisonPlugin.run(contextOf(harness, [twoCases[0]]));
    expect(run.status).toBe("partial");
    expect(run.cases[0].outcomes[0].failures).toEqual([
      { code: "retrieval-failed", message: "The retrieval strategy threw before producing a measurement.", variantId: "keyword-search", caseId: "m1", recoverable: true }
    ]);
    expect(run.failures).toEqual([]);
  });

  it("TST-081-044 fails closed on an external-local target", async () => {
    const harness = makeHarness();
    const external = { ...selfTarget(), kind: "external-local" as const, isSelf: false };
    await expect(retrievalQueryStrategyComparisonPlugin.run(contextOf(harness, twoCases, { target: external }))).rejects.toThrow(
      "External-local retrieval-query-strategy-comparison targets require a loaded local repository subject (--local-subject-config)."
    );
    expect(harness.builds).toHaveLength(0);
  });

  it("requires cases input", async () => {
    const harness = makeHarness();
    const context = contextOf(harness, twoCases);
    await expect(retrievalQueryStrategyComparisonPlugin.run({ ...context, inputs: {} })).rejects.toThrow(
      "Retrieval query strategy comparison requires cases input."
    );
  });

  it("TST-081-045 filters narrow cases but never the treatment set", async () => {
    const corpus = [...twoCases, makeEvaluationCase({ id: "l1", project: "project-b" })];
    const byCase = await retrievalQueryStrategyComparisonPlugin.run(contextOf(makeHarness(), corpus, { config: { caseIds: ["m2"] } }));
    expect(byCase.cases.map((entry) => entry.id)).toEqual(["m2"]);
    expect(byCase.cases[0].outcomes).toHaveLength(7);
    const byProject = await retrievalQueryStrategyComparisonPlugin.run(
      contextOf(makeHarness(), corpus, { config: { benchmarkProjects: ["project-b"] } })
    );
    expect(byProject.cases.map((entry) => entry.id)).toEqual(["l1"]);
    expect(byProject.cases[0].outcomes.map((outcome) => outcome.variantId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
  });
});
