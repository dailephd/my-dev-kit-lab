import type { PlannedAnswerFact, PlannedSourceModule, PlannedSymbol, SyntheticRepositoryPlanV1 } from "./types.js";

export type SyntheticRepositoryLayout = {
  /** Stable logical target root; never contains a physical output location. */
  logicalTargetRoot: string;
  sourceRoots: string[];
  testRoots: string[];
  rawIncludeGlobs: string[];
};

/**
 * Pure derivation of the generated repository layout from a plan. Globs list only roots that exist: the
 * existing glob collector fails when a glob base directory is missing, so `tests/` appears only when the
 * plan has test files. Support files (package.json, tsconfig.json, pyproject.toml) match no glob.
 */
export function deriveSyntheticRepositoryLayout(plan: SyntheticRepositoryPlanV1): SyntheticRepositoryLayout {
  const hasTests = plan.requested.testFileCount > 0;
  const sourceGlob = plan.language === "typescript" ? "src/**/*.ts" : "src/**/*.py";
  return {
    logicalTargetRoot: `synthetic/${plan.caseId}/repository`,
    sourceRoots: hasTests ? ["src", "tests"] : ["src"],
    testRoots: hasTests ? ["tests"] : [],
    rawIncludeGlobs: hasTests ? [sourceGlob, "tests/**/*"] : [sourceGlob],
  };
}

export type SyntheticTaskText = {
  title: string;
  query: string;
  /** Deterministic fact prose keyed by plan fact id (Batch 1 left prose to materialization). */
  factTextById: Map<string, string>;
};

function describeFact(
  fact: PlannedAnswerFact,
  moduleById: Map<string, PlannedSourceModule>,
  symbolById: Map<string, PlannedSymbol>,
  testPathById: Map<string, string>
): string {
  if (fact.role === "symbol-definition") {
    const symbol = symbolById.get(fact.symbolIds[0]) as PlannedSymbol;
    return `${symbol.name} is defined in ${(moduleById.get(symbol.moduleId) as PlannedSourceModule).path}.`;
  }
  if (fact.role === "import-relation") {
    const edge = fact.edge as { from: string; to: string };
    return `${(moduleById.get(edge.from) as PlannedSourceModule).path} imports ${(moduleById.get(edge.to) as PlannedSourceModule).path}.`;
  }
  return `${testPathById.get(fact.testId as string)} exercises code in the task module.`;
}

/** Deterministic task title, query and fact prose from the plan's task and answer-key plan. */
export function describeSyntheticTask(plan: SyntheticRepositoryPlanV1): SyntheticTaskText {
  const moduleById = new Map(plan.modules.map((module) => [module.moduleId, module] as const));
  const symbolById = new Map(plan.symbols.map((symbol) => [symbol.symbolId, symbol] as const));
  const testPathById = new Map(plan.testFiles.map((test) => [test.testId, test.path] as const));
  const names = plan.answerKey.expectedSymbols.join(", ");
  const pathOf = (moduleId: string): string => (moduleById.get(moduleId) as PlannedSourceModule).path;
  let query: string;
  if (plan.task.queryPlan.kind === "locate-symbols") {
    query = `Locate the source file that defines the symbols ${names}.`;
  } else if (plan.task.queryPlan.kind === "trace-import") {
    const edge = plan.task.relationEdge as { from: string; to: string };
    query = `Trace how ${pathOf(edge.from)} depends on ${pathOf(edge.to)} and identify the symbols ${names}.`;
  } else {
    query = `Survey the repository and list the files and symbols (${names}) involved in a change that spans ${plan.task.ownerModuleIds.length} separate modules.`;
  }
  return {
    title: `Synthetic ${plan.task.locality} task for ${plan.caseId}`,
    query,
    factTextById: new Map(plan.answerKey.facts.map((fact) => [fact.factId, describeFact(fact, moduleById, symbolById, testPathById)] as const)),
  };
}
