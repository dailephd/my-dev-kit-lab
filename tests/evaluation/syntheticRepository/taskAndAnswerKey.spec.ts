import { describe, expect, it } from "vitest";
import { validateAnswerKey } from "../../../src/evaluation/benchmarkMetadata.js";
import { TASK_LOCALITIES } from "../../../src/evaluation/types.js";
import type { BenchmarkTaskAnswerKey } from "../../../src/evaluation/types.js";
import { SyntheticRepositoryConfigError, planSyntheticRepositoryCase } from "../../../src/evaluation/syntheticRepository/index.js";
import type { SyntheticRepositoryPlanV1 } from "../../../src/evaluation/syntheticRepository/index.js";
import { makeCase } from "./planOracle.js";

const SEEDS = ["t0", "t1", "t2", "t3", "t4", "t5"];

function plansFor(taskLocality: (typeof TASK_LOCALITIES)[number], sizes: number[], testFileCount = 6): SyntheticRepositoryPlanV1[] {
  const plans: SyntheticRepositoryPlanV1[] = [];
  for (const sourceFileCount of sizes) {
    const moduleDepth = Math.min(3, sourceFileCount);
    for (const seed of SEEDS) {
      plans.push(
        planSyntheticRepositoryCase(
          makeCase({
            id: `${taskLocality}-${sourceFileCount}`,
            seed,
            taskLocality,
            sourceFileCount,
            moduleDepth,
            internalImportCount: moduleDepth - 1 + (sourceFileCount > moduleDepth ? 1 : 0),
            symbolCount: sourceFileCount * 3,
            testFileCount,
          })
        )
      );
    }
  }
  return plans;
}

function toBenchmarkAnswerKey(plan: SyntheticRepositoryPlanV1): BenchmarkTaskAnswerKey {
  return {
    expectedFiles: plan.answerKey.expectedFiles,
    expectedSymbols: plan.answerKey.expectedSymbols,
    expectedFacts: plan.answerKey.facts.map((fact) => ({
      id: fact.factId,
      text: `placeholder for ${fact.factId}`,
      weight: fact.weight,
      required: fact.required,
    })),
    minimumCorrectFacts: plan.answerKey.minimumCorrectFacts,
  } as BenchmarkTaskAnswerKey;
}

const ALL_PLANS: Array<[string, SyntheticRepositoryPlanV1[]]> = [
  ["localized", [...plansFor("localized", [1, 4, 12]), ...plansFor("localized", [5], 0)]],
  ["cross-module", [...plansFor("cross-module", [2, 5, 12]), ...plansFor("cross-module", [6], 0)]],
  ["broad-change", [...plansFor("broad-change", [4, 5, 40]), ...plansFor("broad-change", [8], 0)]],
];

describe("synthetic repository task locality", () => {
  it("TST-037 localized tasks have exactly one owner module and its own tests", () => {
    for (const plan of ALL_PLANS[0][1]) {
      const { task } = plan;
      expect(task.locality).toBe("localized");
      expect(task.ownerModuleIds).toHaveLength(1);
      expect(task.relationEdge).toBeNull();
      expect(task.queryPlan.kind).toBe("locate-symbols");
      expect(task.symbolIds.length).toBeGreaterThanOrEqual(1);
      for (const symbolId of task.symbolIds) {
        expect(plan.symbols.find((symbol) => symbol.symbolId === symbolId)?.moduleId).toBe(task.ownerModuleIds[0]);
      }
      const owned = plan.testFiles.filter((test) => test.targetModuleId === task.ownerModuleIds[0]).map((test) => test.testId);
      expect(task.associatedTestIds).toEqual(owned);
      expect(plan.answerKey.expectedFiles).toHaveLength(1);
    }
    expect(ALL_PLANS[0][1].some((plan) => plan.testFiles.length === 0 && plan.task.associatedTestIds.length === 0)).toBe(true);
    expect(ALL_PLANS[0][1].some((plan) => plan.task.associatedTestIds.length > 0)).toBe(true);
  });

  it("TST-038 cross-module tasks span the endpoints of a planned import edge", () => {
    for (const plan of ALL_PLANS[1][1]) {
      const { task } = plan;
      expect(task.locality).toBe("cross-module");
      expect(task.ownerModuleIds.length).toBeGreaterThanOrEqual(2);
      expect(task.relationEdge).not.toBeNull();
      const edge = task.relationEdge as { from: string; to: string };
      expect(plan.importEdges.some((candidate) => candidate.from === edge.from && candidate.to === edge.to)).toBe(true);
      expect([...task.ownerModuleIds].sort()).toEqual([edge.from, edge.to].sort());
      const owners = new Set(task.symbolIds.map((symbolId) => plan.symbols.find((symbol) => symbol.symbolId === symbolId)?.moduleId));
      expect(owners.size).toBeGreaterThanOrEqual(2);
      expect(task.queryPlan.kind).toBe("trace-import");
    }
  });

  it("TST-039 broad-change tasks cover four distinct modules, one per quarter stratum", () => {
    for (const plan of ALL_PLANS[2][1]) {
      const { task } = plan;
      const count = plan.modules.length;
      expect(task.locality).toBe("broad-change");
      expect(new Set(task.ownerModuleIds).size).toBeGreaterThanOrEqual(4);
      expect(task.relationEdge).toBeNull();
      expect(task.queryPlan.kind).toBe("broad-change-survey");
      const ranges = [0, 1, 2, 3].map((stratum) => [Math.floor((stratum * count) / 4), Math.floor(((stratum + 1) * count) / 4)]);
      const ownerIndexes = task.ownerModuleIds.map((owner) => plan.modules.findIndex((module) => module.moduleId === owner));
      for (const [low, high] of ranges) {
        expect(ownerIndexes.some((index) => index >= low && index < high), `stratum ${low}..${high} of ${count}`).toBe(true);
      }
      expect(task.symbolIds.length).toBeGreaterThanOrEqual(4);
      const owners = new Set(task.symbolIds.map((symbolId) => plan.symbols.find((symbol) => symbol.symbolId === symbolId)?.moduleId));
      expect(owners.size).toBeGreaterThanOrEqual(4);
    }
  });

  it("TST-040 never silently downgrades a locality and rejects infeasible requests", () => {
    for (const taskLocality of TASK_LOCALITIES) {
      const plan = planSyntheticRepositoryCase(makeCase({ taskLocality, sourceFileCount: 6, moduleDepth: 3, internalImportCount: 8, symbolCount: 12 }));
      expect(plan.task.locality).toBe(taskLocality);
      expect(plan.requested.taskLocality).toBe(taskLocality);
      expect(plan.realized.taskLocality).toBe(taskLocality);
    }
    const infeasible = {
      localized: makeCase({ taskLocality: "localized", sourceFileCount: 4, symbolCount: 3 }),
      "cross-module": makeCase({ taskLocality: "cross-module", sourceFileCount: 1, moduleDepth: 1, internalImportCount: 0, symbolCount: 1 }),
      "broad-change": makeCase({ taskLocality: "broad-change", sourceFileCount: 3, moduleDepth: 1, internalImportCount: 0, symbolCount: 3 }),
    };
    for (const taskLocality of TASK_LOCALITIES) {
      expect(() => planSyntheticRepositoryCase(infeasible[taskLocality]), taskLocality).toThrow(SyntheticRepositoryConfigError);
    }
  });
});

describe("synthetic repository answer-key plan", () => {
  it("TST-041 references only existing files, symbols and context targets with deterministic order", () => {
    for (const [label, plans] of ALL_PLANS) {
      for (const plan of plans) {
        const where = `${label}/${plan.caseId}`;
        const { answerKey, task } = plan;
        const pathByModule = new Map(plan.modules.map((module) => [module.moduleId, module.path] as const));
        const symbolById = new Map(plan.symbols.map((symbol) => [symbol.symbolId, symbol] as const));
        expect(answerKey.expectedFiles.length, where).toBeGreaterThan(0);
        expect(answerKey.expectedFiles, where).toEqual(task.ownerModuleIds.map((owner) => pathByModule.get(owner)));
        expect(answerKey.expectedSymbolIds, where).toEqual(task.symbolIds);
        expect(answerKey.expectedSymbols, where).toEqual(task.symbolIds.map((symbolId) => symbolById.get(symbolId)?.name));
        const allPaths = new Set([...plan.modules.map((module) => module.path), ...plan.testFiles.map((test) => test.path)]);
        for (const target of answerKey.expectedContextTargets) {
          expect(allPaths.has(target.file), where).toBe(true);
          expect(target.required).toBe(true);
          const moduleId = [...pathByModule.entries()].find(([, path]) => path === target.file)?.[0];
          for (const name of target.symbols) {
            const symbol = plan.symbols.find((candidate) => candidate.name === name);
            expect(symbol?.moduleId, `${where}/${name}`).toBe(moduleId);
            expect(task.symbolIds).toContain(symbol?.symbolId);
          }
        }
        expect(answerKey.expectedContextTargets.map((target) => target.file), where).toEqual(answerKey.expectedFiles);
      }
    }
    const first = planSyntheticRepositoryCase(makeCase({ taskLocality: "cross-module", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 8, symbolCount: 12 }));
    const again = planSyntheticRepositoryCase(makeCase({ taskLocality: "cross-module", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 8, symbolCount: 12 }));
    expect(again.answerKey).toEqual(first.answerKey);
  });

  it("TST-042 facts have unique ids, positive weights and a satisfiable minimum", () => {
    for (const [label, plans] of ALL_PLANS) {
      for (const plan of plans) {
        const where = `${label}/${plan.caseId}`;
        const { facts, minimumCorrectFacts } = plan.answerKey;
        expect(new Set(facts.map((fact) => fact.factId)).size, where).toBe(facts.length);
        for (const fact of facts) {
          expect(fact.weight, where).toBeGreaterThan(0);
          expect(["symbol-definition", "import-relation", "associated-test"], where).toContain(fact.role);
          expect(fact.required).toBe(fact.role !== "associated-test");
        }
        const required = facts.filter((fact) => fact.required);
        expect(minimumCorrectFacts, where).toBeGreaterThanOrEqual(1);
        expect(minimumCorrectFacts, where).toBeLessThanOrEqual(facts.length);
        expect(minimumCorrectFacts, where).toBe(required.length);
        const definitions = facts.filter((fact) => fact.role === "symbol-definition");
        expect(definitions.map((fact) => fact.symbolIds[0]), where).toEqual(plan.task.symbolIds);
        expect(facts.filter((fact) => fact.role === "import-relation").length, where).toBe(plan.task.relationEdge ? 1 : 0);
        expect(facts.filter((fact) => fact.role === "associated-test").map((fact) => fact.testId), where).toEqual(
          plan.task.associatedTestIds
        );
      }
    }
  });

  it("TST-043 converts to a BenchmarkTaskAnswerKey accepted by the existing validator", () => {
    for (const [label, plans] of ALL_PLANS) {
      for (const plan of plans) {
        expect(validateAnswerKey(toBenchmarkAnswerKey(plan), `${label}/${plan.caseId}`)).toEqual([]);
      }
    }
    const broken = toBenchmarkAnswerKey(ALL_PLANS[0][1][0]);
    expect(validateAnswerKey({ ...broken, expectedFiles: [] }, "broken")).not.toEqual([]);
  });
});
