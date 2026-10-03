import { normalizeSyntheticRepositoryConfig, validateSyntheticRepositoryCaseSpec } from "./config.js";
import { computeSyntheticRepositoryCaseIdentity } from "./identity.js";
import { createSyntheticRepositoryPrng } from "./prng.js";
import type { SyntheticRepositoryPrng } from "./prng.js";
import { planTopology } from "./topology.js";
import {
  SYNTHETIC_REPOSITORY_IDENTITY_ALGORITHM_VERSION,
  SYNTHETIC_REPOSITORY_PATTERN_ROLES,
  SYNTHETIC_REPOSITORY_PLAN_SCHEMA_ID,
  SYNTHETIC_REPOSITORY_PLAN_SCHEMA_VERSION,
  SYNTHETIC_REPOSITORY_PRNG_VERSION,
  SyntheticRepositoryConfigError,
  SyntheticRepositoryPlanningError,
} from "./types.js";
import type {
  PlannedAnswerFact,
  PlannedAnswerKey,
  PlannedImportEdge,
  PlannedRepeatedPattern,
  PlannedSourceModule,
  PlannedSymbol,
  PlannedTask,
  PlannedTestFile,
  SyntheticRepositoryCaseSpecV1,
  SyntheticRepositoryDimensions,
  SyntheticRepositoryPlanV1,
} from "./types.js";
import type { TaskLocality } from "../types.js";

const REQUIRED_FACT_WEIGHT = 2;
const OPTIONAL_FACT_WEIGHT = 1;
const MAX_TASK_SYMBOLS_PER_MODULE = 3;
const BROAD_CHANGE_MODULE_COUNT = 4;
const SAFE_PLANNED_PATH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function requestedDimensions(spec: SyntheticRepositoryCaseSpecV1): SyntheticRepositoryDimensions {
  return {
    sourceFileCount: spec.sourceFileCount,
    moduleDepth: spec.moduleDepth,
    internalImportCount: spec.internalImportCount,
    symbolCount: spec.symbolCount,
    testFileCount: spec.testFileCount,
    repeatedPatternCount: spec.repeatedPatternCount,
    taskLocality: spec.taskLocality,
  };
}

function planModules(
  spec: SyntheticRepositoryCaseSpecV1,
  levelOfModule: readonly number[],
  prng: SyntheticRepositoryPrng
): { modules: PlannedSourceModule[]; symbols: PlannedSymbol[]; symbolsByModule: PlannedSymbol[][] } {
  const moduleCount = spec.sourceFileCount;
  const extension = spec.language === "typescript" ? ".ts" : ".py";
  const symbolCounts = new Array<number>(moduleCount).fill(1);
  for (let extra = moduleCount; extra < spec.symbolCount; extra += 1) {
    symbolCounts[prng.nextInt(moduleCount)] += 1;
  }

  const modules: PlannedSourceModule[] = [];
  const symbols: PlannedSymbol[] = [];
  const symbolsByModule: PlannedSymbol[][] = [];
  let ordinal = 0;
  for (let index = 0; index < moduleCount; index += 1) {
    const moduleId = `mod_${pad(index + 1, 5)}`;
    const own: PlannedSymbol[] = [];
    for (let count = 0; count < symbolCounts[index]; count += 1) {
      ordinal += 1;
      const name = `sym_${pad(ordinal, 6)}`;
      own.push({ symbolId: `${moduleId}#${name}`, name, ordinal, moduleId });
    }
    symbols.push(...own);
    symbolsByModule.push(own);
    modules.push({
      moduleId,
      index,
      level: levelOfModule[index],
      path: `src/group_${pad(Math.floor(index / 100) + 1, 3)}/${moduleId}${extension}`,
      symbolIds: own.map((symbol) => symbol.symbolId),
    });
  }
  return { modules, symbols, symbolsByModule };
}

function pickConsecutiveSymbols(own: readonly PlannedSymbol[], maxCount: number, prng: SyntheticRepositoryPrng): PlannedSymbol[] {
  const count = 1 + prng.nextInt(Math.min(maxCount, own.length));
  const start = prng.nextInt(own.length);
  const indices = new Set<number>();
  for (let offset = 0; offset < count; offset += 1) indices.add((start + offset) % own.length);
  return [...indices].sort((left, right) => left - right).map((index) => own[index]);
}

function planTestFiles(
  spec: SyntheticRepositoryCaseSpecV1,
  modules: readonly PlannedSourceModule[],
  symbolsByModule: readonly PlannedSymbol[][],
  prng: SyntheticRepositoryPrng
): PlannedTestFile[] {
  if (spec.testFileCount === 0) return [];
  const suffix = spec.language === "typescript" ? ".test.ts" : ".py";
  const order = prng.shuffle(Array.from({ length: modules.length }, (_, index) => index));
  const tests: PlannedTestFile[] = [];
  for (let position = 0; position < spec.testFileCount; position += 1) {
    const target = order[position % modules.length];
    const testId = `test_${pad(position + 1, 5)}`;
    tests.push({
      testId,
      path: `tests/${testId}${suffix}`,
      targetModuleId: modules[target].moduleId,
      targetSymbolIds: pickConsecutiveSymbols(symbolsByModule[target], MAX_TASK_SYMBOLS_PER_MODULE, prng).map(
        (symbol) => symbol.symbolId
      ),
    });
  }
  return tests;
}

function planRepeatedPatterns(
  spec: SyntheticRepositoryCaseSpecV1,
  modules: readonly PlannedSourceModule[],
  prng: SyntheticRepositoryPrng
): PlannedRepeatedPattern[] {
  const patterns: PlannedRepeatedPattern[] = [];
  for (let position = 0; position < spec.repeatedPatternCount; position += 1) {
    const target = prng.nextInt(modules.length);
    const role = SYNTHETIC_REPOSITORY_PATTERN_ROLES[prng.nextInt(SYNTHETIC_REPOSITORY_PATTERN_ROLES.length)];
    patterns.push({
      patternId: `pattern_${pad(position + 1, 6)}`,
      ordinal: position + 1,
      role,
      targetModuleId: modules[target].moduleId,
    });
  }
  return patterns;
}

function planTask(
  spec: SyntheticRepositoryCaseSpecV1,
  modules: readonly PlannedSourceModule[],
  symbolsByModule: readonly PlannedSymbol[][],
  edges: readonly PlannedImportEdge[],
  tests: readonly PlannedTestFile[],
  prng: SyntheticRepositoryPrng
): PlannedTask {
  const taskId = `${spec.id}-task`;
  const moduleIndexById = new Map(modules.map((module) => [module.moduleId, module.index] as const));

  if (spec.taskLocality === "localized") {
    const owner = prng.nextInt(modules.length);
    const symbols = pickConsecutiveSymbols(symbolsByModule[owner], MAX_TASK_SYMBOLS_PER_MODULE, prng);
    const symbolIds = symbols.map((symbol) => symbol.symbolId);
    return {
      taskId,
      locality: "localized",
      ownerModuleIds: [modules[owner].moduleId],
      symbolIds,
      relationEdge: null,
      associatedTestIds: tests.filter((test) => test.targetModuleId === modules[owner].moduleId).map((test) => test.testId),
      queryPlan: { kind: "locate-symbols", subjectSymbolIds: symbolIds },
    };
  }

  let selected: number[];
  let relationEdge: PlannedImportEdge | null = null;
  if (spec.taskLocality === "cross-module") {
    if (edges.length === 0 || modules.length < 2) {
      throw new SyntheticRepositoryPlanningError(["cross-module task requires at least two modules and one import edge."]);
    }
    relationEdge = edges[prng.nextInt(edges.length)];
    selected = [moduleIndexById.get(relationEdge.from) as number, moduleIndexById.get(relationEdge.to) as number];
  } else {
    if (modules.length < BROAD_CHANGE_MODULE_COUNT) {
      throw new SyntheticRepositoryPlanningError(["broad-change task requires at least four modules."]);
    }
    selected = [];
    for (let stratum = 0; stratum < BROAD_CHANGE_MODULE_COUNT; stratum += 1) {
      const low = Math.floor((stratum * modules.length) / BROAD_CHANGE_MODULE_COUNT);
      const high = Math.floor(((stratum + 1) * modules.length) / BROAD_CHANGE_MODULE_COUNT);
      selected.push(low + prng.nextInt(high - low));
    }
  }
  selected.sort((left, right) => left - right);
  const symbolIds = selected.map((index) => {
    const own = symbolsByModule[index];
    return own[prng.nextInt(own.length)].symbolId;
  });
  return {
    taskId,
    locality: spec.taskLocality,
    ownerModuleIds: selected.map((index) => modules[index].moduleId),
    symbolIds,
    relationEdge,
    associatedTestIds: [],
    queryPlan: {
      kind: spec.taskLocality === "cross-module" ? "trace-import" : "broad-change-survey",
      subjectSymbolIds: symbolIds,
    },
  };
}

function planAnswerKey(
  task: PlannedTask,
  modules: readonly PlannedSourceModule[],
  symbols: readonly PlannedSymbol[]
): PlannedAnswerKey {
  const moduleById = new Map(modules.map((module) => [module.moduleId, module] as const));
  const symbolById = new Map(symbols.map((symbol) => [symbol.symbolId, symbol] as const));
  const taskSymbols = task.symbolIds.map((symbolId) => symbolById.get(symbolId) as PlannedSymbol);

  const facts: PlannedAnswerFact[] = [];
  const addFact = (fact: Omit<PlannedAnswerFact, "factId" | "weight">): void => {
    facts.push({
      factId: `fact_${pad(facts.length + 1, 3)}`,
      weight: fact.required ? REQUIRED_FACT_WEIGHT : OPTIONAL_FACT_WEIGHT,
      ...fact,
    });
  };
  for (const symbol of taskSymbols) {
    addFact({ role: "symbol-definition", required: true, symbolIds: [symbol.symbolId], edge: null, testId: null });
  }
  if (task.relationEdge) {
    addFact({ role: "import-relation", required: true, symbolIds: [], edge: task.relationEdge, testId: null });
  }
  for (const testId of task.associatedTestIds) {
    addFact({ role: "associated-test", required: false, symbolIds: [], edge: null, testId });
  }

  return {
    expectedFiles: task.ownerModuleIds.map((moduleId) => (moduleById.get(moduleId) as PlannedSourceModule).path),
    expectedSymbols: taskSymbols.map((symbol) => symbol.name),
    expectedSymbolIds: [...task.symbolIds],
    facts,
    minimumCorrectFacts: facts.filter((fact) => fact.required).length,
    expectedContextTargets: task.ownerModuleIds.map((moduleId) => ({
      file: (moduleById.get(moduleId) as PlannedSourceModule).path,
      symbols: taskSymbols.filter((symbol) => symbol.moduleId === moduleId).map((symbol) => symbol.name),
      required: true,
    })),
  };
}

/** Broad-change stratum boundaries: stratum s starts at floor(s * moduleCount / 4). */
function stratumOf(moduleIndex: number, moduleCount: number): number {
  for (let stratum = BROAD_CHANGE_MODULE_COUNT - 1; stratum > 0; stratum -= 1) {
    if (moduleIndex >= Math.floor((stratum * moduleCount) / BROAD_CHANGE_MODULE_COUNT)) return stratum;
  }
  return 0;
}

function classifyLocality(ownerCount: number): TaskLocality | undefined {
  if (ownerCount === 1) return "localized";
  if (ownerCount >= BROAD_CHANGE_MODULE_COUNT) return "broad-change";
  if (ownerCount >= 2) return "cross-module";
  return undefined;
}

/**
 * Recomputes every measurable dimension of a plan from its own arrays and checks reference integrity, path
 * safety, graph shape, locality semantics and answer-key satisfiability. Returns what was found; never throws.
 */
function inspectPlan(plan: SyntheticRepositoryPlanV1): { realized: SyntheticRepositoryDimensions; errors: string[] } {
  const errors: string[] = [];
  const moduleCount = plan.modules.length;
  const moduleIndexById = new Map<string, number>();
  plan.modules.forEach((module, index) => {
    if (moduleIndexById.has(module.moduleId)) errors.push(`duplicate module id ${module.moduleId}.`);
    moduleIndexById.set(module.moduleId, index);
    if (module.index !== index) errors.push(`module ${module.moduleId} index ${module.index} does not match its position ${index}.`);
  });

  const seenPaths = new Set<string>();
  for (const path of [...plan.modules.map((module) => module.path), ...plan.testFiles.map((test) => test.path)]) {
    if (!SAFE_PLANNED_PATH_PATTERN.test(path)) errors.push(`unsafe planned path ${JSON.stringify(path)}.`);
    if (seenPaths.has(path)) errors.push(`duplicate planned path ${path}.`);
    seenPaths.add(path);
  }

  const symbolById = new Map<string, PlannedSymbol>();
  const symbolNames = new Set<string>();
  const symbolsPerModule = new Map<string, string[]>();
  for (const symbol of plan.symbols) {
    if (symbolById.has(symbol.symbolId)) errors.push(`duplicate symbol id ${symbol.symbolId}.`);
    if (symbolNames.has(symbol.name)) errors.push(`duplicate symbol name ${symbol.name}.`);
    symbolById.set(symbol.symbolId, symbol);
    symbolNames.add(symbol.name);
    if (!moduleIndexById.has(symbol.moduleId)) {
      errors.push(`symbol ${symbol.symbolId} references missing module ${symbol.moduleId}.`);
      continue;
    }
    const list = symbolsPerModule.get(symbol.moduleId) ?? [];
    list.push(symbol.symbolId);
    symbolsPerModule.set(symbol.moduleId, list);
  }
  for (const module of plan.modules) {
    const owned = symbolsPerModule.get(module.moduleId) ?? [];
    if (owned.length === 0) errors.push(`module ${module.moduleId} owns no symbol.`);
    if (owned.length !== module.symbolIds.length || owned.some((symbolId, index) => symbolId !== module.symbolIds[index])) {
      errors.push(`module ${module.moduleId} symbolIds do not match the symbols that reference it.`);
    }
  }

  const adjacency: number[][] = Array.from({ length: moduleCount }, () => []);
  const indegree = new Array<number>(moduleCount).fill(0);
  const edgeKeys = new Set<string>();
  for (const edge of plan.importEdges) {
    const from = moduleIndexById.get(edge.from);
    const to = moduleIndexById.get(edge.to);
    if (from === undefined || to === undefined) {
      errors.push(`edge ${edge.from} -> ${edge.to} references a missing module.`);
      continue;
    }
    if (from === to) errors.push(`self edge on ${edge.from}.`);
    const key = `${edge.from}>${edge.to}`;
    if (edgeKeys.has(key)) errors.push(`duplicate edge ${edge.from} -> ${edge.to}.`);
    edgeKeys.add(key);
    adjacency[from].push(to);
    indegree[to] += 1;
  }

  // Longest chain (in modules) via Kahn's algorithm; a short count means the graph has a cycle.
  const chainLength = new Array<number>(moduleCount).fill(1);
  const queue: number[] = [];
  for (let index = 0; index < moduleCount; index += 1) if (indegree[index] === 0) queue.push(index);
  let processed = 0;
  let moduleDepth = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    processed += 1;
    moduleDepth = Math.max(moduleDepth, chainLength[current]);
    for (const next of adjacency[current]) {
      chainLength[next] = Math.max(chainLength[next], chainLength[current] + 1);
      indegree[next] -= 1;
      if (indegree[next] === 0) queue.push(next);
    }
  }
  if (processed < moduleCount) errors.push("import graph contains a cycle.");

  const testIds = new Set<string>();
  for (const test of plan.testFiles) {
    if (testIds.has(test.testId)) errors.push(`duplicate test id ${test.testId}.`);
    testIds.add(test.testId);
    if (!moduleIndexById.has(test.targetModuleId)) errors.push(`test ${test.testId} targets missing module ${test.targetModuleId}.`);
    if (test.targetSymbolIds.length === 0) errors.push(`test ${test.testId} references no symbol.`);
    for (const symbolId of test.targetSymbolIds) {
      if (symbolById.get(symbolId)?.moduleId !== test.targetModuleId) {
        errors.push(`test ${test.testId} references symbol ${symbolId} that is not owned by ${test.targetModuleId}.`);
      }
    }
  }

  const patternIds = new Set<string>();
  for (const pattern of plan.repeatedPatterns) {
    if (patternIds.has(pattern.patternId)) errors.push(`duplicate pattern id ${pattern.patternId}.`);
    patternIds.add(pattern.patternId);
    if (!moduleIndexById.has(pattern.targetModuleId)) {
      errors.push(`pattern ${pattern.patternId} targets missing module ${pattern.targetModuleId}.`);
    }
    if (!(SYNTHETIC_REPOSITORY_PATTERN_ROLES as readonly string[]).includes(pattern.role)) {
      errors.push(`pattern ${pattern.patternId} has unknown role ${pattern.role}.`);
    }
  }

  const { task, answerKey } = plan;
  const ownerSet = new Set(task.ownerModuleIds);
  if (ownerSet.size !== task.ownerModuleIds.length) errors.push("task owner modules are not unique.");
  const symbolOwners = new Set<string>();
  for (const symbolId of task.symbolIds) {
    const symbol = symbolById.get(symbolId);
    if (!symbol) {
      errors.push(`task references missing symbol ${symbolId}.`);
      continue;
    }
    symbolOwners.add(symbol.moduleId);
    if (!ownerSet.has(symbol.moduleId)) errors.push(`task symbol ${symbolId} is outside the task owner modules.`);
  }
  for (const owner of task.ownerModuleIds) {
    if (!moduleIndexById.has(owner)) errors.push(`task owner ${owner} is missing from the plan.`);
    if (!symbolOwners.has(owner)) errors.push(`task owner ${owner} has no task symbol.`);
  }
  let taskLocality = classifyLocality(symbolOwners.size);
  if (taskLocality === undefined) {
    errors.push("task spans no source module.");
    taskLocality = task.locality;
  }
  if (task.locality !== taskLocality) {
    errors.push(`task locality ${task.locality} does not match its structure (${taskLocality}).`);
  }
  if (taskLocality === "cross-module") {
    const relation = task.relationEdge;
    if (!relation || !edgeKeys.has(`${relation.from}>${relation.to}`) || !ownerSet.has(relation.from) || !ownerSet.has(relation.to)) {
      errors.push("cross-module task owners are not connected by a planned import edge.");
    }
  }
  if (taskLocality === "broad-change") {
    const strata = new Set(task.ownerModuleIds.map((owner) => stratumOf(moduleIndexById.get(owner) ?? 0, moduleCount)));
    if (strata.size < BROAD_CHANGE_MODULE_COUNT) errors.push("broad-change task owners are not spread over four module strata.");
  }
  for (const testId of task.associatedTestIds) {
    const test = plan.testFiles.find((candidate) => candidate.testId === testId);
    if (!test || !ownerSet.has(test.targetModuleId)) errors.push(`task associated test ${testId} does not resolve to a task owner.`);
  }

  const modulePathById = new Map(plan.modules.map((module) => [module.moduleId, module.path] as const));
  const expectedFiles = task.ownerModuleIds.map((owner) => modulePathById.get(owner));
  if (answerKey.expectedFiles.length === 0 || answerKey.expectedFiles.join("\n") !== expectedFiles.join("\n")) {
    errors.push("answer key expectedFiles do not match the task owner modules.");
  }
  const expectedNames = task.symbolIds.map((symbolId) => symbolById.get(symbolId)?.name);
  if (answerKey.expectedSymbols.length === 0 || answerKey.expectedSymbols.join("\n") !== expectedNames.join("\n")) {
    errors.push("answer key expectedSymbols do not match the task symbols.");
  }
  if (answerKey.expectedSymbolIds.join("\n") !== task.symbolIds.join("\n")) {
    errors.push("answer key expectedSymbolIds do not match the task symbols.");
  }
  for (const target of answerKey.expectedContextTargets) {
    if (!seenPaths.has(target.file)) errors.push(`context target file ${target.file} is not planned.`);
    for (const name of target.symbols) if (!symbolNames.has(name)) errors.push(`context target symbol ${name} is not planned.`);
  }
  const factIds = new Set<string>();
  let requiredFacts = 0;
  for (const fact of answerKey.facts) {
    if (factIds.has(fact.factId)) errors.push(`duplicate fact id ${fact.factId}.`);
    factIds.add(fact.factId);
    if (!(fact.weight > 0)) errors.push(`fact ${fact.factId} must have a positive weight.`);
    if (fact.required) requiredFacts += 1;
    for (const symbolId of fact.symbolIds) {
      if (!task.symbolIds.includes(symbolId)) errors.push(`fact ${fact.factId} references symbol ${symbolId} outside the task.`);
    }
    if (fact.edge && !edgeKeys.has(`${fact.edge.from}>${fact.edge.to}`)) errors.push(`fact ${fact.factId} references a missing edge.`);
    if (fact.testId !== null && !testIds.has(fact.testId)) errors.push(`fact ${fact.factId} references missing test ${fact.testId}.`);
  }
  if (
    !Number.isInteger(answerKey.minimumCorrectFacts) ||
    answerKey.minimumCorrectFacts < 1 ||
    answerKey.minimumCorrectFacts > requiredFacts
  ) {
    errors.push("answer key minimumCorrectFacts is not satisfiable by the required facts.");
  }

  return {
    errors,
    realized: {
      sourceFileCount: moduleCount,
      moduleDepth,
      internalImportCount: plan.importEdges.length,
      symbolCount: plan.symbols.length,
      testFileCount: plan.testFiles.length,
      repeatedPatternCount: plan.repeatedPatterns.length,
      taskLocality,
    },
  };
}

/** Verifies a plan against its own structure and its requested dimensions; throws on any mismatch. */
export function verifySyntheticRepositoryPlan(plan: SyntheticRepositoryPlanV1): SyntheticRepositoryDimensions {
  const { realized, errors } = inspectPlan(plan);
  for (const key of Object.keys(plan.requested) as Array<keyof SyntheticRepositoryDimensions>) {
    if (plan.requested[key] !== realized[key]) {
      errors.push(`realized ${key} ${String(realized[key])} does not equal requested ${String(plan.requested[key])}.`);
    }
    if (plan.realized[key] !== realized[key]) {
      errors.push(`recorded realized ${key} ${String(plan.realized[key])} does not match the plan (${String(realized[key])}).`);
    }
  }
  if (errors.length > 0) throw new SyntheticRepositoryPlanningError(errors);
  return realized;
}

/** Plans one repository. Re-validates the case, never repairs, and never returns a partial plan. */
export function planSyntheticRepositoryCase(input: unknown): SyntheticRepositoryPlanV1 {
  const validation = validateSyntheticRepositoryCaseSpec(input);
  if (!validation.ok) throw new SyntheticRepositoryConfigError(validation.errors);
  const spec = validation.spec;
  const generationIdentity = computeSyntheticRepositoryCaseIdentity(spec);
  const prng = createSyntheticRepositoryPrng(generationIdentity);

  const topology = planTopology(spec, prng);
  const { modules, symbols, symbolsByModule } = planModules(spec, topology.levelOfModule, prng);
  const importEdges: PlannedImportEdge[] = topology.edges.map(([from, to]) => ({
    from: modules[from].moduleId,
    to: modules[to].moduleId,
  }));
  const testFiles = planTestFiles(spec, modules, symbolsByModule, prng);
  const repeatedPatterns = planRepeatedPatterns(spec, modules, prng);
  const task = planTask(spec, modules, symbolsByModule, importEdges, testFiles, prng);
  const answerKey = planAnswerKey(task, modules, symbols);

  const requested = requestedDimensions(spec);
  const plan: SyntheticRepositoryPlanV1 = {
    schemaId: SYNTHETIC_REPOSITORY_PLAN_SCHEMA_ID,
    schemaVersion: SYNTHETIC_REPOSITORY_PLAN_SCHEMA_VERSION,
    prngVersion: SYNTHETIC_REPOSITORY_PRNG_VERSION,
    identityAlgorithmVersion: SYNTHETIC_REPOSITORY_IDENTITY_ALGORITHM_VERSION,
    caseId: spec.id,
    generationIdentity,
    language: spec.language,
    logicalProjectId: `synthetic-${spec.id}`,
    requested,
    realized: requested,
    modules,
    symbols,
    importEdges,
    testFiles,
    repeatedPatterns,
    task,
    answerKey,
  };
  plan.realized = inspectPlan(plan).realized;
  verifySyntheticRepositoryPlan(plan);
  return plan;
}

/** Normalizes a configuration (throwing on invalid input) and plans every case in canonical id order. */
export function planSyntheticRepositories(input: unknown): SyntheticRepositoryPlanV1[] {
  return normalizeSyntheticRepositoryConfig(input).cases.map((spec) => planSyntheticRepositoryCase(spec));
}
