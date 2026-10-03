import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSyntheticRepositoryPrng,
  syntheticRepositoryPrngInitialState,
} from "../../../src/evaluation/syntheticRepository/index.js";

const ID_A = "01020304".padEnd(64, "0");
const ID_B = `a1b2c3d4${"00".repeat(28)}`;
const ID_C = "ab".repeat(32);

afterEach(() => {
  vi.restoreAllMocks();
});

function draw(identity: string, count: number): number[] {
  const prng = createSyntheticRepositoryPrng(identity);
  return Array.from({ length: count }, () => prng.nextUint32());
}

describe("synthetic repository PRNG", () => {
  it("TST-024 reproduces pinned golden sequences and the big-endian identity byte order", () => {
    expect(syntheticRepositoryPrngInitialState(ID_A)).toBe(0x01020304);
    expect(syntheticRepositoryPrngInitialState(ID_A)).not.toBe(0x04030201);
    expect(syntheticRepositoryPrngInitialState(ID_B)).toBe(2712847316);

    expect(draw(ID_A, 6)).toEqual([1631875969, 1514618365, 1564684804, 2950013393, 3055738825, 2616283698]);
    expect(draw(ID_B, 6)).toEqual([2979790600, 656909989, 2879365244, 2730649062, 3702574806, 909917912]);
    expect(draw(ID_C, 4)).toEqual([132256517, 181333402, 215622108, 1802439074]);

    const prng = createSyntheticRepositoryPrng(ID_C);
    expect(Array.from({ length: 6 }, () => prng.nextInt(10))).toEqual([7, 2, 8, 4, 4, 8]);
  });

  it("TST-025 is deterministic, bounded and argument-checked", () => {
    expect(draw(ID_A, 20)).toEqual(draw(ID_A, 20));
    expect(draw(ID_A, 20)).not.toEqual(draw(ID_B, 20));

    const prng = createSyntheticRepositoryPrng(ID_A);
    for (let index = 0; index < 200; index += 1) {
      expect(prng.nextInt(1)).toBe(0);
      expect([0, 1]).toContain(prng.nextInt(2));
      const wide = prng.nextInt(2 ** 32);
      expect(wide).toBeGreaterThanOrEqual(0);
      expect(wide).toBeLessThan(2 ** 32);
      const rejecting = prng.nextInt(3_000_000_000);
      expect(rejecting).toBeLessThan(3_000_000_000);
      const float = prng.nextFloat();
      expect(float).toBeGreaterThanOrEqual(0);
      expect(float).toBeLessThan(1);
    }
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32 + 1]) {
      expect(() => createSyntheticRepositoryPrng(ID_A).nextInt(bad), String(bad)).toThrow(RangeError);
    }
    for (const bad of ["", "xyz", ID_B.toUpperCase(), ID_A.slice(1), `${ID_A}0`, "g".repeat(64)]) {
      expect(() => createSyntheticRepositoryPrng(bad), bad).toThrow(/lowercase 64-character/);
      expect(() => syntheticRepositoryPrngInitialState(bad), bad).toThrow();
    }

    const shuffled = createSyntheticRepositoryPrng(ID_A).shuffle(Array.from({ length: 10 }, (_, index) => index));
    expect([...shuffled].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(createSyntheticRepositoryPrng(ID_A).shuffle(Array.from({ length: 10 }, (_, index) => index))).toEqual(shuffled);
    const source = [1, 2, 3];
    expect(createSyntheticRepositoryPrng(ID_A).shuffle(source)).toBe(source);
    expect(createSyntheticRepositoryPrng(ID_A).shuffle([])).toEqual([]);
  });

  it("never consults Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not be consulted");
    });
    const prng = createSyntheticRepositoryPrng(ID_C);
    prng.nextUint32();
    prng.nextFloat();
    prng.nextInt(17);
    prng.shuffle([1, 2, 3, 4]);
    expect(spy).not.toHaveBeenCalled();
  });
});
