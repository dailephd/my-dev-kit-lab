import { maxImportEdges } from "./config.js";
import { SyntheticRepositoryPlanningError } from "./types.js";
import type { SyntheticRepositoryPrng } from "./prng.js";

export type PlannedTopology = {
  /** Number of modules at each dependency level (all >= 1). Level 0 modules import deeper levels. */
  levelSizes: number[];
  /** Level of each module index; module indices are ordered by level. */
  levelOfModule: number[];
  /** Unique import edges as [importerIndex, importedIndex], importerIndex < importedIndex, sorted ascending. */
  edges: Array<[number, number]>;
};

export type TopologyRequest = {
  sourceFileCount: number;
  moduleDepth: number;
  internalImportCount: number;
};

/**
 * Plans the acyclic import graph: exactly `internalImportCount` unique edges whose longest chain has exactly
 * `moduleDepth` modules. Modules live on `moduleDepth` levels and may only import modules on a deeper level,
 * so the longest chain can never exceed `moduleDepth`; one spine chain guarantees it reaches it.
 * Assumes a validated request (feasibility is also re-checked defensively).
 */
export function planTopology(request: TopologyRequest, prng: SyntheticRepositoryPrng): PlannedTopology {
  const { sourceFileCount, moduleDepth, internalImportCount } = request;
  if (internalImportCount > maxImportEdges(sourceFileCount, moduleDepth) || internalImportCount < moduleDepth - 1) {
    throw new SyntheticRepositoryPlanningError([
      `topology request is infeasible: ${sourceFileCount} modules, depth ${moduleDepth}, ${internalImportCount} edges.`,
    ]);
  }

  const levelSizes = new Array<number>(moduleDepth).fill(1);
  for (let extra = moduleDepth; extra < sourceFileCount; extra += 1) {
    levelSizes[prng.nextInt(moduleDepth)] += 1;
  }

  let sumOfSquares = levelSizes.reduce((total, size) => total + size * size, 0);
  let capacity = (sourceFileCount * sourceFileCount - sumOfSquares) / 2;
  while (capacity < internalImportCount) {
    let largest = 0;
    let smallest = 0;
    for (let level = 1; level < moduleDepth; level += 1) {
      if (levelSizes[level] > levelSizes[largest]) largest = level;
      if (levelSizes[level] < levelSizes[smallest]) smallest = level;
    }
    if (levelSizes[largest] - levelSizes[smallest] < 2) {
      throw new SyntheticRepositoryPlanningError(["topology rebalancing exhausted before reaching the requested edge count."]);
    }
    const from = levelSizes[largest];
    const to = levelSizes[smallest];
    sumOfSquares += (from - 1) * (from - 1) + (to + 1) * (to + 1) - from * from - to * to;
    levelSizes[largest] -= 1;
    levelSizes[smallest] += 1;
    capacity = (sourceFileCount * sourceFileCount - sumOfSquares) / 2;
  }

  const levelStart: number[] = [];
  const levelEnd: number[] = [];
  const levelOfModule = new Array<number>(sourceFileCount);
  let cursor = 0;
  for (let level = 0; level < moduleDepth; level += 1) {
    levelStart.push(cursor);
    for (let count = 0; count < levelSizes[level]; count += 1) {
      levelOfModule[cursor] = level;
      cursor += 1;
    }
    levelEnd.push(cursor);
  }

  // Candidate edge ranks: modules in index order, each followed by the modules on strictly deeper levels.
  const cumulative = new Array<number>(sourceFileCount + 1);
  cumulative[0] = 0;
  for (let module = 0; module < sourceFileCount; module += 1) {
    cumulative[module + 1] = cumulative[module] + (sourceFileCount - levelEnd[levelOfModule[module]]);
  }
  const totalRanks = cumulative[sourceFileCount];

  const rankToEdge = (rank: number): [number, number] => {
    let low = 0;
    let high = sourceFileCount - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (cumulative[middle] <= rank) low = middle;
      else high = middle - 1;
    }
    return [low, levelEnd[levelOfModule[low]] + (rank - cumulative[low])];
  };

  const spineRanks: number[] = [];
  for (let level = 0; level + 1 < moduleDepth; level += 1) {
    spineRanks.push(cumulative[levelStart[level]]);
  }

  const extraEdges = internalImportCount - spineRanks.length;
  const freeRanks = totalRanks - spineRanks.length;
  const chosen = new Set<number>();
  for (let upper = freeRanks - extraEdges; upper < freeRanks; upper += 1) {
    const pick = prng.nextInt(upper + 1);
    chosen.add(chosen.has(pick) ? upper : pick);
  }

  const ranks = [...spineRanks];
  for (const freeIndex of chosen) {
    let rank = freeIndex;
    for (const spineRank of spineRanks) {
      if (spineRank <= rank) rank += 1;
      else break;
    }
    ranks.push(rank);
  }
  ranks.sort((left, right) => left - right);

  return { levelSizes, levelOfModule, edges: ranks.map(rankToEdge) };
}
