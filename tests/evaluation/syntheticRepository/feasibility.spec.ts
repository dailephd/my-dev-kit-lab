import { describe, expect, it } from "vitest";
import { maxImportEdges, validateSyntheticRepositoryConfig } from "../../../src/evaluation/syntheticRepository/index.js";
import { makeCase, makeConfig } from "./planOracle.js";

type Dims = {
  sourceFileCount: number;
  moduleDepth: number;
  internalImportCount: number;
  symbolCount?: number;
  taskLocality?: string;
};

function check(dims: Dims): { ok: boolean; errors: string[] } {
  const spec = makeCase({
    ...dims,
    symbolCount: dims.symbolCount ?? Math.max(dims.sourceFileCount, 1),
  } as Parameters<typeof makeCase>[0]);
  const result = validateSyntheticRepositoryConfig(makeConfig([spec]));
  return { ok: result.ok, errors: result.errors };
}

describe("synthetic repository cross-field feasibility", () => {
  it("TST-013 rejects moduleDepth above the module count or above 64 and accepts the 64/64 boundary", () => {
    const tooDeepForModules = check({ sourceFileCount: 3, moduleDepth: 4, internalImportCount: 3 });
    expect(tooDeepForModules.ok).toBe(false);
    expect(tooDeepForModules.errors.join("\n")).toMatch(/moduleDepth: must not exceed sourceFileCount/);

    const above64 = check({ sourceFileCount: 100, moduleDepth: 65, internalImportCount: 64 });
    expect(above64.ok).toBe(false);
    expect(above64.errors.join("\n")).toMatch(/moduleDepth/);

    expect(check({ sourceFileCount: 64, moduleDepth: 64, internalImportCount: 63 }).ok).toBe(true);
  });

  it("TST-014 requires at least moduleDepth - 1 imports to realize the depth", () => {
    const short = check({ sourceFileCount: 5, moduleDepth: 5, internalImportCount: 3 });
    expect(short.ok).toBe(false);
    expect(short.errors.join("\n")).toMatch(/at least moduleDepth - 1 \(4\)/);
    expect(check({ sourceFileCount: 5, moduleDepth: 5, internalImportCount: 4 }).ok).toBe(true);
  });

  it("TST-015 enforces depth-aware edge capacity exactly", () => {
    expect(check({ sourceFileCount: 4, moduleDepth: 1, internalImportCount: 0 }).ok).toBe(true);
    const flat = check({ sourceFileCount: 4, moduleDepth: 1, internalImportCount: 1 });
    expect(flat.ok).toBe(false);
    expect(flat.errors.join("\n")).toMatch(/exceeds the 0 unique acyclic edges/);

    expect(check({ sourceFileCount: 4, moduleDepth: 2, internalImportCount: 4 }).ok).toBe(true);
    expect(check({ sourceFileCount: 4, moduleDepth: 2, internalImportCount: 5 }).ok).toBe(false);

    expect(check({ sourceFileCount: 5, moduleDepth: 5, internalImportCount: 10 }).ok).toBe(true);
    expect(check({ sourceFileCount: 5, moduleDepth: 5, internalImportCount: 11 }).ok).toBe(false);

    expect(maxImportEdges(6, 3)).toBe(12);
    expect(check({ sourceFileCount: 6, moduleDepth: 3, internalImportCount: 12 }).ok).toBe(true);
    expect(check({ sourceFileCount: 6, moduleDepth: 3, internalImportCount: 13 }).ok).toBe(false);
  });

  it("TST-016 requires symbolCount >= sourceFileCount", () => {
    const below = check({ sourceFileCount: 5, moduleDepth: 2, internalImportCount: 3, symbolCount: 4 });
    expect(below.ok).toBe(false);
    expect(below.errors.join("\n")).toMatch(/symbolCount: must be at least sourceFileCount/);
    expect(check({ sourceFileCount: 5, moduleDepth: 2, internalImportCount: 3, symbolCount: 5 }).ok).toBe(true);
  });

  it("TST-017 rejects infeasible cross-module localities", () => {
    expect(
      check({ sourceFileCount: 1, moduleDepth: 1, internalImportCount: 0, taskLocality: "cross-module" }).errors.join("\n")
    ).toMatch(/cross-module requires sourceFileCount >= 2/);
    expect(
      check({ sourceFileCount: 2, moduleDepth: 1, internalImportCount: 0, taskLocality: "cross-module" }).errors.join("\n")
    ).toMatch(/cross-module requires internalImportCount >= 1/);
    expect(check({ sourceFileCount: 2, moduleDepth: 2, internalImportCount: 1, taskLocality: "cross-module" }).ok).toBe(true);
  });

  it("TST-018 rejects broad-change below four modules", () => {
    const three = check({ sourceFileCount: 3, moduleDepth: 1, internalImportCount: 0, taskLocality: "broad-change" });
    expect(three.ok).toBe(false);
    expect(three.errors.join("\n")).toMatch(/broad-change requires sourceFileCount >= 4/);
    expect(check({ sourceFileCount: 4, moduleDepth: 1, internalImportCount: 0, taskLocality: "broad-change" }).ok).toBe(true);
  });

  it("TST-019 maxImportEdges equals the brute-force maximum for every N and D up to 7", () => {
    for (let modules = 1; modules <= 7; modules += 1) {
      for (let depth = 1; depth <= modules; depth += 1) {
        let best = -1;
        const levels = new Array<number>(modules).fill(0);
        const walk = (position: number): void => {
          if (position === modules) {
            if (new Set(levels).size !== depth) return;
            let cross = 0;
            for (let left = 0; left < modules; left += 1) {
              for (let right = left + 1; right < modules; right += 1) if (levels[left] !== levels[right]) cross += 1;
            }
            best = Math.max(best, cross);
            return;
          }
          for (let level = 0; level < depth; level += 1) {
            levels[position] = level;
            walk(position + 1);
          }
        };
        walk(0);
        expect(maxImportEdges(modules, depth), `N=${modules} D=${depth}`).toBe(best);
      }
    }
  });

  it("never silently coerces, clamps or repairs an infeasible case", () => {
    const input = makeConfig([makeCase({ sourceFileCount: 4, moduleDepth: 2, internalImportCount: 9, symbolCount: 2 })]);
    const snapshot = JSON.stringify(input);
    const result = validateSyntheticRepositoryConfig(input);
    expect(result.ok).toBe(false);
    expect(result.config).toBeUndefined();
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
