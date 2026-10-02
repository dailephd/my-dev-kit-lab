import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_REPOSITORY_PATTERN_ROLES,
  SyntheticRepositoryConfigError,
  SyntheticRepositoryPlanningError,
  planSyntheticRepositories,
  planSyntheticRepositoryCase,
  verifySyntheticRepositoryPlan,
} from "../../../src/evaluation/syntheticRepository/index.js";
import type { SyntheticRepositoryCaseSpecV1, SyntheticRepositoryPlanV1 } from "../../../src/evaluation/syntheticRepository/index.js";
import { allPlannedPaths, analyzeImportGraph, isSafeLogicalPath, makeCase, makeConfig } from "./planOracle.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const NONTRIVIAL = makeCase({
  id: "nontrivial",
  sourceFileCount: 12,
  moduleDepth: 4,
  internalImportCount: 20,
  symbolCount: 40,
  testFileCount: 6,
  repeatedPatternCount: 9,
  taskLocality: "cross-module",
});

function clone(plan: SyntheticRepositoryPlanV1): SyntheticRepositoryPlanV1 {
  return JSON.parse(JSON.stringify(plan)) as SyntheticRepositoryPlanV1;
}

describe("synthetic repository planning determinism and purity", () => {
  it("TST-026 plans without Math.random, Date.now or process.cwd", () => {
    const reference = planSyntheticRepositoryCase(NONTRIVIAL);
    const refuse = (name: string) => () => {
      throw new Error(`${name} must not be consulted`);
    };
    const random = vi.spyOn(Math, "random").mockImplementation(refuse("Math.random"));
    const now = vi.spyOn(Date, "now").mockImplementation(refuse("Date.now"));
    const cwd = vi.spyOn(process, "cwd").mockImplementation(refuse("process.cwd"));
    const spied = planSyntheticRepositoryCase(NONTRIVIAL);
    expect(spied).toEqual(reference);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(cwd).not.toHaveBeenCalled();
  });

  it("TST-027 repeated planning is deep-equal, JSON-stable and input-order independent", () => {
    const first = planSyntheticRepositoryCase(NONTRIVIAL);
    expect(planSyntheticRepositoryCase(NONTRIVIAL)).toEqual(first);
    expect(planSyntheticRepositoryCase({ ...NONTRIVIAL })).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(JSON.stringify(planSyntheticRepositoryCase(NONTRIVIAL))).toBe(JSON.stringify(first));

    const cases = [makeCase({ id: "zz" }), makeCase({ id: "aa", language: "python" }), NONTRIVIAL];
    const forward = planSyntheticRepositories(makeConfig(cases));
    const backward = planSyntheticRepositories(makeConfig([...cases].reverse()));
    expect(backward).toEqual(forward);
    expect(forward.map((plan) => plan.caseId)).toEqual(["aa", "nontrivial", "zz"]);
    expect(() => planSyntheticRepositories(makeConfig([]))).toThrow(SyntheticRepositoryConfigError);
  });

  it("TST-028 planned paths are safe, relative, unique and language-appropriate", () => {
    const specs: SyntheticRepositoryCaseSpecV1[] = [
      NONTRIVIAL,
      { ...NONTRIVIAL, id: "py", language: "python" },
      makeCase({ id: "wide", sourceFileCount: 250, moduleDepth: 5, internalImportCount: 300, symbolCount: 260, testFileCount: 20 }),
      makeCase({ id: "wide-py", language: "python", sourceFileCount: 250, moduleDepth: 5, internalImportCount: 300, symbolCount: 260, testFileCount: 20 }),
    ];
    for (const spec of specs) {
      const plan = planSyntheticRepositoryCase(spec);
      const paths = allPlannedPaths(plan);
      expect(new Set(paths).size).toBe(paths.length);
      for (const path of paths) {
        expect(isSafeLogicalPath(path), path).toBe(true);
        expect(path).not.toMatch(/^[A-Za-z]:/);
        expect(path).not.toMatch(/^\/\//);
      }
      const moduleSuffix = spec.language === "typescript" ? ".ts" : ".py";
      for (const module of plan.modules) expect(module.path.endsWith(moduleSuffix), module.path).toBe(true);
      for (const test of plan.testFiles) {
        expect(test.path.startsWith("tests/")).toBe(true);
        expect(test.path.endsWith(spec.language === "typescript" ? ".test.ts" : ".py")).toBe(true);
      }
      const serialized = JSON.stringify(plan);
      const cwd = process.cwd();
      expect(serialized).not.toContain(cwd);
      expect(serialized).not.toContain(JSON.stringify(cwd).slice(1, -1));
      expect(serialized).not.toMatch(/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/);
      expect(serialized).not.toContain("\\\\");
    }
  });

  it("TST-035 keeps arrays in stable order", () => {
    const plan = planSyntheticRepositoryCase(NONTRIVIAL);
    plan.modules.forEach((module, position) => expect(module.index).toBe(position));
    plan.symbols.forEach((symbol, position) => expect(symbol.ordinal).toBe(position + 1));
    for (let index = 1; index < plan.importEdges.length; index += 1) {
      const previous = plan.importEdges[index - 1];
      const current = plan.importEdges[index];
      const before = previous.from < current.from || (previous.from === current.from && previous.to < current.to);
      expect(before, `${previous.from}>${previous.to} then ${current.from}>${current.to}`).toBe(true);
    }
    const ascending = (ids: string[]): boolean => ids.every((id, index) => index === 0 || ids[index - 1] < id);
    expect(ascending(plan.testFiles.map((test) => test.testId))).toBe(true);
    expect(ascending(plan.repeatedPatterns.map((pattern) => pattern.patternId))).toBe(true);
    const ownedInOrder = plan.modules.flatMap((module) => module.symbolIds);
    expect(ownedInOrder).toEqual(plan.symbols.map((symbol) => symbol.symbolId));
  });
});

describe("synthetic repository source and symbol plan", () => {
  it("TST-029 realizes exact source and symbol counts with consistent ownership", () => {
    const table: Array<[number, number]> = [
      [1, 1],
      [3, 3],
      [3, 30],
      [5, 500],
      [20, 2000],
    ];
    for (const [sourceFileCount, symbolCount] of table) {
      const plan = planSyntheticRepositoryCase(
        makeCase({ sourceFileCount, symbolCount, moduleDepth: 1, internalImportCount: 0, testFileCount: 0, repeatedPatternCount: 0 })
      );
      expect(plan.modules).toHaveLength(sourceFileCount);
      expect(plan.symbols).toHaveLength(symbolCount);
      expect(new Set(plan.modules.map((module) => module.moduleId)).size).toBe(sourceFileCount);
      expect(new Set(plan.symbols.map((symbol) => symbol.symbolId)).size).toBe(symbolCount);
      expect(new Set(plan.symbols.map((symbol) => symbol.name)).size).toBe(symbolCount);
      const moduleIds = new Set(plan.modules.map((module) => module.moduleId));
      for (const symbol of plan.symbols) expect(moduleIds.has(symbol.moduleId)).toBe(true);
      for (const module of plan.modules) {
        expect(module.symbolIds.length).toBeGreaterThanOrEqual(1);
        const owned = plan.symbols.filter((symbol) => symbol.moduleId === module.moduleId).map((symbol) => symbol.symbolId);
        expect(module.symbolIds).toEqual(owned);
      }
    }
  });

  it("TST-030 satisfies the graph invariants across a configuration table, checked by an independent oracle", () => {
    const table: Array<[string, Partial<SyntheticRepositoryCaseSpecV1>]> = [
      ["flat", { sourceFileCount: 5, moduleDepth: 1, internalImportCount: 0, symbolCount: 5 }],
      ["single", { sourceFileCount: 1, moduleDepth: 1, internalImportCount: 0, symbolCount: 1 }],
      ["chain", { sourceFileCount: 6, moduleDepth: 6, internalImportCount: 5, symbolCount: 6 }],
      ["dense-chain", { sourceFileCount: 6, moduleDepth: 6, internalImportCount: 15, symbolCount: 6 }],
      ["dense", { sourceFileCount: 7, moduleDepth: 3, internalImportCount: 16, symbolCount: 10 }],
      ["dense-small", { sourceFileCount: 4, moduleDepth: 2, internalImportCount: 4, symbolCount: 4 }],
      ["sparse", { sourceFileCount: 10, moduleDepth: 4, internalImportCount: 3, symbolCount: 12 }],
      ["deep", { sourceFileCount: 40, moduleDepth: 20, internalImportCount: 60, symbolCount: 50 }],
    ];
    for (const [label, overrides] of table) {
      for (const seed of ["s0", "s1", "s2", "s3", "s4"]) {
        const plan = planSyntheticRepositoryCase(makeCase({ id: label, seed, testFileCount: 0, repeatedPatternCount: 0, ...overrides }));
        const report = analyzeImportGraph(plan);
        const where = `${label}/${seed}`;
        expect(report.edgeCount, where).toBe(overrides.internalImportCount);
        expect(report.selfEdges, where).toBe(0);
        expect(report.duplicateEdges, where).toBe(0);
        expect(report.danglingEndpoints, where).toBe(0);
        expect(report.acyclic, where).toBe(true);
        expect(report.longestChainModules, where).toBe(overrides.moduleDepth);
      }
    }
  });

  it("TST-031 topology is deterministic and seed sensitive while counts and depth stay exact", () => {
    const edgesFor = (seed: string): string => {
      const plan = planSyntheticRepositoryCase(
        makeCase({ id: "topo", seed, sourceFileCount: 9, moduleDepth: 3, internalImportCount: 12, symbolCount: 12 })
      );
      const report = analyzeImportGraph(plan);
      expect(report.edgeCount).toBe(12);
      expect(report.longestChainModules).toBe(3);
      return JSON.stringify(plan.importEdges);
    };
    const seeds = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
    const first = seeds.map(edgesFor);
    expect(seeds.map(edgesFor)).toEqual(first);
    expect(new Set(first).size).toBeGreaterThanOrEqual(2);
  });

  it("TST-032 plans exactly the requested test files against existing modules and symbols", () => {
    for (const testFileCount of [0, 1, 4, 7]) {
      const plan = planSyntheticRepositoryCase(makeCase({ testFileCount }));
      expect(plan.testFiles).toHaveLength(testFileCount);
      if (testFileCount === 0) expect(plan.testFiles).toEqual([]);
      expect(new Set(plan.testFiles.map((test) => test.testId)).size).toBe(testFileCount);
      expect(new Set(plan.testFiles.map((test) => test.path)).size).toBe(testFileCount);
      for (const test of plan.testFiles) {
        const target = plan.modules.find((module) => module.moduleId === test.targetModuleId);
        expect(target, test.testId).toBeDefined();
        expect(test.targetSymbolIds.length).toBeGreaterThanOrEqual(1);
        for (const symbolId of test.targetSymbolIds) {
          const symbol = plan.symbols.find((candidate) => candidate.symbolId === symbolId);
          expect(symbol?.moduleId, symbolId).toBe(test.targetModuleId);
        }
      }
    }
  });

  it("TST-033 plans exactly the requested repeated patterns with stable ids and roles", () => {
    for (const repeatedPatternCount of [0, 1, 50]) {
      const plan = planSyntheticRepositoryCase(makeCase({ repeatedPatternCount }));
      expect(plan.repeatedPatterns).toHaveLength(repeatedPatternCount);
      const ids = plan.repeatedPatterns.map((pattern) => pattern.patternId);
      expect(new Set(ids).size).toBe(repeatedPatternCount);
      expect([...ids].sort()).toEqual(ids);
      const moduleIds = new Set(plan.modules.map((module) => module.moduleId));
      plan.repeatedPatterns.forEach((pattern, position) => {
        expect(pattern.ordinal).toBe(position + 1);
        expect(moduleIds.has(pattern.targetModuleId)).toBe(true);
        expect(SYNTHETIC_REPOSITORY_PATTERN_ROLES as readonly string[]).toContain(pattern.role);
      });
      expect(planSyntheticRepositoryCase(makeCase({ repeatedPatternCount })).repeatedPatterns).toEqual(plan.repeatedPatterns);
    }
    expect([...SYNTHETIC_REPOSITORY_PATTERN_ROLES]).toEqual(["helper-block", "table-block", "doc-block", "guard-block"]);
  });

  it("TST-034 realized dimensions equal requested dimensions and infeasible cases never plan", () => {
    for (const spec of [NONTRIVIAL, makeCase({ language: "python", taskLocality: "broad-change", sourceFileCount: 8, symbolCount: 8 })]) {
      const plan = planSyntheticRepositoryCase(spec);
      expect(plan.requested).toEqual({
        sourceFileCount: spec.sourceFileCount,
        moduleDepth: spec.moduleDepth,
        internalImportCount: spec.internalImportCount,
        symbolCount: spec.symbolCount,
        testFileCount: spec.testFileCount,
        repeatedPatternCount: spec.repeatedPatternCount,
        taskLocality: spec.taskLocality,
      });
      expect(plan.realized).toEqual(plan.requested);
      expect(verifySyntheticRepositoryPlan(plan)).toEqual(plan.requested);
      expect(plan.caseId).toBe(spec.id);
      expect(plan.generationIdentity).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const bad of [
      makeCase({ internalImportCount: 99 }),
      makeCase({ symbolCount: 1 }),
      { ...makeCase(), sourceFileCount: "4" },
      { ...makeCase(), extra: true },
      null,
    ]) {
      expect(() => planSyntheticRepositoryCase(bad)).toThrow(SyntheticRepositoryConfigError);
    }
  });

  it("fails closed when a plan no longer matches its requested dimensions or structure", () => {
    const base = planSyntheticRepositoryCase(NONTRIVIAL);

    const missingEdge = clone(base);
    missingEdge.importEdges.pop();
    expect(() => verifySyntheticRepositoryPlan(missingEdge)).toThrow(SyntheticRepositoryPlanningError);

    const extraTest = clone(base);
    extraTest.testFiles.pop();
    expect(() => verifySyntheticRepositoryPlan(extraTest)).toThrow(/testFileCount/);

    const wrongRequest = clone(base);
    wrongRequest.requested.symbolCount += 1;
    expect(() => verifySyntheticRepositoryPlan(wrongRequest)).toThrow(/symbolCount/);

    const wrongRecord = clone(base);
    wrongRecord.realized.moduleDepth += 1;
    expect(() => verifySyntheticRepositoryPlan(wrongRecord)).toThrow(/recorded realized moduleDepth/);

    const cyclic = clone(base);
    const firstEdge = cyclic.importEdges[0];
    cyclic.importEdges.push({ from: firstEdge.to, to: firstEdge.from });
    expect(() => verifySyntheticRepositoryPlan(cyclic)).toThrow(/cycle/);

    const dangling = clone(base);
    dangling.importEdges[0] = { from: "mod_missing", to: dangling.importEdges[0].to };
    expect(() => verifySyntheticRepositoryPlan(dangling)).toThrow(/missing module/);

    const unsafePath = clone(base);
    unsafePath.modules[0].path = "../escape.ts";
    expect(() => verifySyntheticRepositoryPlan(unsafePath)).toThrow(/unsafe planned path/);

    const unchanged = clone(base);
    expect(verifySyntheticRepositoryPlan(unchanged)).toEqual(base.requested);
  });

  it("TST-036 plans a maximum-size repository in memory", () => {
    const plan = planSyntheticRepositoryCase(
      makeCase({
        id: "max",
        sourceFileCount: 10000,
        moduleDepth: 64,
        internalImportCount: 100000,
        symbolCount: 100000,
        testFileCount: 10000,
        repeatedPatternCount: 100000,
      })
    );
    expect(plan.modules).toHaveLength(10000);
    expect(plan.symbols).toHaveLength(100000);
    expect(plan.importEdges).toHaveLength(100000);
    expect(plan.testFiles).toHaveLength(10000);
    expect(plan.repeatedPatterns).toHaveLength(100000);
    const report = analyzeImportGraph(plan);
    expect(report.acyclic).toBe(true);
    expect(report.duplicateEdges).toBe(0);
    expect(report.longestChainModules).toBe(64);
    expect(plan.realized).toEqual(plan.requested);
  }, 120_000);
});
