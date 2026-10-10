import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tokenCountMethod } from "../../../src/core/countTokens.js";
import { readEvaluationCases } from "../../../src/evaluation/readEvaluationCases.js";
import type { EvaluationCase, MyDevKitRetrievalResult, RawFullFileBaselineResult } from "../../../src/evaluation/types.js";
import { createDefaultExperimentPluginRegistry } from "../../../src/experiments/defaultRegistry.js";
import {
  CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION,
  STANDARD_CONTEXT_BUDGETS,
  contextWindowScalingPlugin,
  executeContextWindowScalingCases,
  type ContextWindowScalingDependencies,
  type ContextWindowScalingRun,
  type TreatmentEvaluationResult,
} from "../../../src/experiments/plugins/contextWindowScaling/index.js";
import type { ExperimentExecutionContext, ExperimentTarget } from "../../../src/experiments/types.js";

const rootDir = process.cwd();
const scalingCasesPath = path.join(rootDir, "benchmarks", "contracts", "context-window-scaling-cases.json");
const warmCasesPath = path.join(rootDir, "benchmarks", "contracts", "warm-index-benchmark-cases.json");
const fakeKitCommand = `node ${path.join(rootDir, "tests", "fixtures", "fake-context-scaling-kit-cli.js")}`;
const SCALE_IDS = ["ctx-scale-a-8k-16k", "ctx-scale-b-16k-32k", "ctx-scale-c-32k-64k", "ctx-scale-d-64k-plus"];

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ctx-scaling-test-"));
  tempDirs.push(dir);
  return dir;
}

const target: ExperimentTarget = {
  kind: "self",
  targetRoot: rootDir,
  toolRoot: rootDir,
  packageName: null,
  packageVersion: null,
  hasPackageJson: true,
  hasLockfile: true,
  branch: null,
  commit: null,
  hasGit: false,
  isSelf: true,
};

function rawResult(evaluationCase: EvaluationCase, tokens: number, files: string[]): RawFullFileBaselineResult {
  return {
    caseId: evaluationCase.id,
    targetRoot: evaluationCase.absoluteTargetRoot,
    filesIncluded: files,
    totalFiles: files.length,
    totalChars: tokens * 4,
    totalEstimatedTokens: tokens,
    tokenCountMethod,
    contextText: "",
    durationMs: 0,
  };
}

function guidedResult(evaluationCase: EvaluationCase, tokens: number, files: string[], skipped = false): MyDevKitRetrievalResult {
  return {
    caseId: evaluationCase.id,
    skipped,
    warnings: skipped ? ["no candidate"] : [],
    totalChars: tokens * 4,
    totalEstimatedTokens: tokens,
    tokenCountMethod,
    contextText: "",
    filesRead: files,
    commands: [],
    durationMs: 0,
  };
}

const PASS_EVALUATION: TreatmentEvaluationResult = {
  agentId: "fake-agent",
  agentStatus: "completed",
  correctness: { availability: "available", score: 1, pass: true },
  failureReasons: [],
  warnings: [],
  errors: [],
};

type Counters = { raw: number; guided: number; evaluated: string[] };

function stubs(options: {
  rawTokens: number;
  guidedTokens: number;
  guidedSkipped?: boolean;
  evaluation?: (treatment: string) => TreatmentEvaluationResult;
  rawThrows?: boolean;
}): { deps: ContextWindowScalingDependencies; counters: Counters } {
  const counters: Counters = { raw: 0, guided: 0, evaluated: [] };
  return {
    counters,
    deps: {
      constructRawContext: async (evaluationCase) => {
        counters.raw += 1;
        if (options.rawThrows) throw new Error("raw boom");
        return rawResult(evaluationCase, options.rawTokens, [...evaluationCase.expectedFiles, "src/other.ts"]);
      },
      constructGuidedContext: async ({ evaluationCase }) => {
        counters.guided += 1;
        return guidedResult(evaluationCase, options.guidedTokens, [evaluationCase.expectedFiles[0]!], options.guidedSkipped);
      },
      evaluateTreatment: async ({ treatment }) => {
        counters.evaluated.push(treatment);
        return (options.evaluation ?? (() => PASS_EVALUATION))(treatment);
      },
    },
  };
}

async function loadScalingCases(): Promise<EvaluationCase[]> {
  return readEvaluationCases(scalingCasesPath, rootDir);
}

async function execute(cases: EvaluationCase[], deps: Partial<ContextWindowScalingDependencies>, budgets: number[] = [...STANDARD_CONTEXT_BUDGETS]) {
  return executeContextWindowScalingCases({
    cases,
    contextBudgets: budgets,
    kitCommand: "unused",
    outputRoot: await tempDir(),
    projectProfiles: [],
    cwd: rootDir,
    dependencies: deps,
  });
}

describe("context construction and evaluation reuse (injected owners)", () => {
  it("constructs each treatment context once per case and evaluates each once across four budgets", async () => {
    const [first] = await loadScalingCases();
    const { deps, counters } = stubs({ rawTokens: 14035, guidedTokens: 200 });
    const [result] = await execute([first!], deps);
    expect(counters.raw).toBe(1);
    expect(counters.guided).toBe(1);
    expect(counters.evaluated).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    const raw = result!.treatments[0]!;
    expect(raw.budgetCells.map((cell) => cell.contextFitStatus)).toEqual(["context-too-large", "fits", "fits", "fits"]);
    expect(raw.evaluation.evaluationCount).toBe(1);
    const fitting = raw.budgetCells.filter((cell) => cell.contextFitStatus === "fits");
    expect(new Set(fitting.map((cell) => JSON.stringify(cell.correctness))).size).toBe(1);
  });

  it("creates one cell per budget for both treatments with the identical sorted budget set", async () => {
    const [first] = await loadScalingCases();
    const { deps } = stubs({ rawTokens: 9000, guidedTokens: 100 });
    const budgets = [8192, 12000, 16384, 65536];
    const [result] = await execute([first!], deps, budgets);
    expect(result!.treatments.map((treatment) => treatment.variantId)).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    for (const treatment of result!.treatments) {
      expect(treatment.budgetCells.map((cell) => cell.contextBudgetTokens)).toEqual(budgets);
    }
  });

  it("does not evaluate or fail a context that is too large for every budget", async () => {
    const [first] = await loadScalingCases();
    const { deps, counters } = stubs({ rawTokens: 104252, guidedTokens: 100 });
    const [result] = await execute([first!], deps);
    const raw = result!.treatments[0]!;
    expect(counters.evaluated).toEqual(["my-dev-kit-guided"]);
    expect(raw.status).toBe("completed");
    expect(raw.errors).toEqual([]);
    expect(raw.evaluation).toMatchObject({ status: "not-evaluated-no-fitting-budget", evaluationCount: 0 });
    for (const cell of raw.budgetCells) {
      expect(cell).toMatchObject({
        contextFitStatus: "context-too-large",
        evaluationStatus: "not-evaluated-context-too-large",
        correctness: { availability: "unavailable", score: null, pass: null },
        successEvidence: { status: "available", success: false, reason: "context-too-large" },
      });
    }
  });

  it("derives success from the existing correctness pass result", async () => {
    const [first] = await loadScalingCases();
    const failing = stubs({
      rawTokens: 100,
      guidedTokens: 100,
      evaluation: (treatment) =>
        treatment === "raw-full-file"
          ? PASS_EVALUATION
          : { ...PASS_EVALUATION, correctness: { availability: "available", score: 0.2, pass: false }, failureReasons: ["missing expected file"] },
    });
    const [result] = await execute([first!], failing.deps);
    expect(result!.treatments[0]!.budgetCells.every((cell) => cell.successEvidence.success === true)).toBe(true);
    const guided = result!.treatments[1]!;
    expect(guided.status).toBe("completed");
    expect(guided.budgetCells.every((cell) => cell.successEvidence.success === false && cell.successEvidence.reason === "correctness-fail")).toBe(true);
  });

  it("reports unavailable correctness and success, and a partial treatment, when a fitting evaluation is unavailable", async () => {
    const [first] = await loadScalingCases();
    const { deps } = stubs({
      rawTokens: 14035,
      guidedTokens: 100,
      evaluation: (treatment) =>
        treatment === "raw-full-file"
          ? { ...PASS_EVALUATION, agentStatus: "failed", correctness: { availability: "unavailable", score: null, pass: null } }
          : PASS_EVALUATION,
    });
    const [result] = await execute([first!], deps);
    const raw = result!.treatments[0]!;
    expect(raw.status).toBe("partial");
    expect(raw.budgetCells[0]!.successEvidence.reason).toBe("context-too-large");
    for (const cell of raw.budgetCells.slice(1)) {
      expect(cell).toMatchObject({
        contextFitStatus: "fits",
        evaluationStatus: "unavailable",
        correctness: { availability: "unavailable", score: null, pass: null },
        successEvidence: { status: "unavailable", success: null, reason: "evaluation-unavailable" },
      });
    }
    expect(result!.treatments[1]!.status).toBe("completed");
  });

  it("treats a thrown evaluator as unavailable evidence rather than a crash", async () => {
    const [first] = await loadScalingCases();
    const { deps } = stubs({
      rawTokens: 100,
      guidedTokens: 100,
      evaluation: () => {
        throw new Error("evaluator down");
      },
    });
    const [result] = await execute([first!], deps);
    expect(result!.treatments[0]).toMatchObject({ status: "partial", evaluation: { status: "unavailable", reason: "evaluator down" } });
  });

  it("skips a guided treatment whose retrieval produced no context and marks its cells unavailable", async () => {
    const [first] = await loadScalingCases();
    const { deps, counters } = stubs({ rawTokens: 100, guidedTokens: 0, guidedSkipped: true });
    const [result] = await execute([first!], deps);
    const guided = result!.treatments[1]!;
    expect(counters.evaluated).toEqual(["raw-full-file"]);
    expect(guided.status).toBe("skipped");
    expect(guided.context).toMatchObject({ status: "unavailable", estimatedTokens: null, observedFiles: null });
    expect(guided.relevantFileEvidence).toMatchObject({ status: "unavailable", omittedRelevantFileCount: null });
    expect(guided.budgetCells.every((cell) => cell.contextFitStatus === "unavailable" && cell.contextBudgetUtilizationPercent === null)).toBe(true);
    expect(guided.budgetCells.every((cell) => cell.successEvidence.reason === "context-unavailable")).toBe(true);
  });

  it("fails only the treatment whose context construction threw", async () => {
    const [first] = await loadScalingCases();
    const { deps } = stubs({ rawTokens: 100, guidedTokens: 100, rawThrows: true });
    const [result] = await execute([first!], deps);
    expect(result!.treatments[0]).toMatchObject({ status: "failed", errors: [{ code: "context-construction-failed", message: "raw boom" }] });
    expect(result!.treatments[1]!.status).toBe("completed");
  });

  it("records omitted relevant files from the injected observed-file provenance", async () => {
    const [first] = await loadScalingCases();
    const { deps } = stubs({ rawTokens: 100, guidedTokens: 100 });
    const [result] = await execute([first!], deps);
    expect(result!.treatments[0]!.relevantFileEvidence).toMatchObject({ status: "available", omittedRelevantFileCount: 0 });
    expect(result!.treatments[1]!.relevantFileEvidence).toMatchObject({
      status: "available",
      expectedRelevantFileCount: 2,
      observedExpectedFileCount: 1,
      omittedRelevantFileCount: 1,
      omittedRelevantFiles: [first!.expectedFiles[1]],
    });
  });
});

function contextFor(outputRoot: string, runId: string, inputs: Record<string, unknown>): ExperimentExecutionContext<{ contextBudgets: number[]; kitCommand: string }> {
  return {
    runId,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    toolRoot: rootDir,
    target,
    config: { contextBudgets: [...STANDARD_CONTEXT_BUDGETS], kitCommand: fakeKitCommand },
    outputRoot,
    inputs,
  };
}

async function runProduction(cases: EvaluationCase[], runId = "run-1"): Promise<{ run: ContextWindowScalingRun; outputRoot: string }> {
  const outputRoot = await tempDir();
  const run = await contextWindowScalingPlugin.run(contextFor(outputRoot, runId, { cases }));
  return { run, outputRoot };
}

describe("context-window-scaling plugin with production owners and the fake kit", () => {
  it("yields the expected raw fit matrix across the four fixed scales", async () => {
    const cases = await loadScalingCases();
    const { run } = await runProduction(cases);
    expect(run.executionEvidence.map((c) => c.caseId)).toEqual(SCALE_IDS);
    const matrix = run.executionEvidence.map((c) => c.treatments[0]!.budgetCells.map((cell) => cell.contextFitStatus));
    expect(matrix).toEqual([
      ["context-too-large", "fits", "fits", "fits"],
      ["context-too-large", "context-too-large", "fits", "fits"],
      ["context-too-large", "context-too-large", "context-too-large", "fits"],
      ["context-too-large", "context-too-large", "context-too-large", "context-too-large"],
    ]);
  });

  it("evaluates guided under the same budget where raw is context-too-large", async () => {
    const cases = await loadScalingCases();
    const { run } = await runProduction(cases);
    for (const caseEvidence of run.executionEvidence) {
      const [raw, guided] = caseEvidence.treatments;
      expect(guided!.context.status).toBe("available");
      expect(guided!.context.estimatedTokens!).toBeLessThan(8192);
      expect(guided!.budgetCells.every((cell) => cell.contextFitStatus === "fits")).toBe(true);
      const discriminating = raw!.budgetCells.filter((cell, index) => cell.contextFitStatus === "context-too-large" && guided!.budgetCells[index]!.contextBudgetTokens === cell.contextBudgetTokens);
      expect(discriminating.length).toBeGreaterThan(0);
      for (const cell of guided!.budgetCells) {
        expect(cell.correctness.availability).toBe("available");
        expect(cell.correctness.pass).toBe(true);
        expect(cell.successEvidence).toEqual({ status: "available", success: true, reason: "correctness-pass" });
      }
    }
    const scaleB = run.executionEvidence[1]!;
    expect(scaleB.treatments[0]!.budgetCells[1]!.contextFitStatus).toBe("context-too-large");
    expect(scaleB.treatments[1]!.budgetCells[1]!.contextFitStatus).toBe("fits");
  });

  it("records natural guided provenance: the selected implementation file is observed, its test file is omitted", async () => {
    const cases = await loadScalingCases();
    const { run } = await runProduction(cases);
    const guided = run.executionEvidence[0]!.treatments[1]!;
    expect(guided.context.observedFiles).toEqual(["src/tasks/shippingQuote.ts"]);
    expect(guided.relevantFileEvidence).toMatchObject({ omittedRelevantFileCount: 1, omittedRelevantFiles: ["tests/tasks/shippingQuote.test.ts"] });
    expect(run.executionEvidence[0]!.treatments[0]!.relevantFileEvidence.omittedRelevantFileCount).toBe(0);
  });

  it("keeps an existing under-8k raw case fitting every standard budget", async () => {
    const existing = (await readEvaluationCases(warmCasesPath, rootDir)).filter((c) => c.id === "warm-medium-import-dedupe");
    const { run } = await runProduction(existing);
    const raw = run.executionEvidence[0]!.treatments[0]!;
    expect(raw.context.estimatedTokens!).toBeLessThan(8192);
    expect(raw.budgetCells.every((cell) => cell.contextFitStatus === "fits")).toBe(true);
    // The existing fake agent reports two facts while this case requires three, so the existing
    // scorer fails correctness; success must follow that result exactly, with no new threshold.
    expect(raw.budgetCells.every((cell) => cell.correctness.availability === "available" && cell.correctness.pass === false)).toBe(true);
    expect(raw.budgetCells.every((cell) => cell.successEvidence.success === false && cell.successEvidence.reason === "correctness-fail")).toBe(true);
    // The fake kit has no candidate for this query, so guided is legitimately skipped.
    expect(run.executionEvidence[0]!.treatments[1]!.status).toBe("skipped");
    expect(run.status).toBe("partial");
  });

  it("writes the V1 execution artifact under the output root with all persisted evidence", async () => {
    const cases = await loadScalingCases();
    const { run, outputRoot } = await runProduction(cases);
    const artifactPath = path.join(outputRoot, "context-window-scaling-execution.json");
    expect(run.artifacts[0]!.path).toBe(artifactPath);
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    expect(artifact.schemaVersion).toBe(CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION);
    expect(artifact.schemaVersion).toBe("my-dev-kit-lab-context-window-scaling-execution-v1");
    expect(artifact).toMatchObject({ pluginId: "context-window-scaling", pluginSchemaVersion: "1.0.0", estimator: { tokenCountMethod: "estimated_chars_div_4" }, contextBudgets: [8192, 16384, 32768, 65536] });
    expect(artifact.cases).toHaveLength(4);
    for (const caseEvidence of artifact.cases) {
      expect(caseEvidence.treatments.map((t: { variantId: string }) => t.variantId)).toEqual(["raw-full-file", "my-dev-kit-guided"]);
      for (const treatment of caseEvidence.treatments) {
        expect(treatment.context).toMatchObject({ status: "available", tokenCountMethod: "estimated_chars_div_4" });
        expect(treatment.budgetCells).toHaveLength(4);
        expect(treatment.relevantFileEvidence.expectedRelevantFiles.length).toBe(2);
        for (const cell of treatment.budgetCells) {
          expect(cell).toHaveProperty("correctness");
          expect(cell).toHaveProperty("successEvidence");
          expect(cell.contextBudgetUtilizationPercent).toBeTypeOf("number");
        }
      }
    }
    expect(JSON.stringify(artifact)).not.toContain("=== FILE:");
    const files = run.artifacts.map((a) => path.basename(a.path ?? ""));
    expect(files).toEqual(["context-window-scaling-execution.json"]);
  });

  it("maps generic run status without new status values or fit-derived failures", async () => {
    const cases = (await loadScalingCases()).slice(2);
    const { run } = await runProduction(cases);
    expect(run.status).toBe("completed");
    expect(run.failures).toEqual([]);
    expect(run.cases.flatMap((c) => c.outcomes.map((o) => o.status))).toEqual(["completed", "completed", "completed", "completed"]);
    expect(run.variants.map((v) => v.id)).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    expect(run.summary).toMatchObject({ status: "completed", totalCases: 2, completedCases: 2 });
  });

  it("produces equivalent scientific evidence across repeated runs", async () => {
    const [benchmarkCase] = await loadScalingCases();
    const firstStub = stubs({ rawTokens: 14035, guidedTokens: 200 });
    const secondStub = stubs({ rawTokens: 14035, guidedTokens: 200 });
    const firstOutputRoot = await tempDir();
    const secondOutputRoot = await tempDir();
    const firstRun = await contextWindowScalingPlugin.run(
      contextFor(firstOutputRoot, "run-a", { cases: [benchmarkCase], dependencies: firstStub.deps })
    );
    const secondRun = await contextWindowScalingPlugin.run(
      contextFor(secondOutputRoot, "run-b", { cases: [benchmarkCase], dependencies: secondStub.deps })
    );

    expect(firstStub.counters).toEqual({ raw: 1, guided: 1, evaluated: ["raw-full-file", "my-dev-kit-guided"] });
    expect(secondStub.counters).toEqual({ raw: 1, guided: 1, evaluated: ["raw-full-file", "my-dev-kit-guided"] });
    expect(secondRun.executionEvidence).toEqual(firstRun.executionEvidence);
    expect(secondRun.aggregate).toEqual(firstRun.aggregate);
    const read = async (root: string) => {
      const { runId: _runId, startedAt: _startedAt, completedAt: _completedAt, ...scientific } = JSON.parse(
        await readFile(path.join(root, "context-window-scaling-execution.json"), "utf8")
      );
      return scientific;
    };
    expect(await read(secondOutputRoot)).toEqual(await read(firstOutputRoot));
  });

  it("requires cases input and is registered in the public default registry (retrieval-precision-recall follows it)", async () => {
    await expect(contextWindowScalingPlugin.run(contextFor(await tempDir(), "x", {}))).rejects.toThrow("non-empty cases input");
    expect(createDefaultExperimentPluginRegistry().list().map((m) => m.id)).toEqual([
      "context-strategy-comparison",
      "warm-index-reuse",
      "incremental-change-staleness",
      "context-window-scaling",
      "retrieval-precision-recall",
      "retrieval-query-strategy-comparison",
      "context-pack-generation",
      "agent-success-rate",
    ]);
  });
});
