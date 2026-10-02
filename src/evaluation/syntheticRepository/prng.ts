const UINT32_RANGE = 4294967296;
const IDENTITY_PATTERN = /^[0-9a-f]{64}$/;

export type SyntheticRepositoryPrng = {
  nextUint32(): number;
  nextFloat(): number;
  /** Unbiased integer in [0, maxExclusive) by rejection sampling; maxExclusive is an integer in 1..2^32. */
  nextInt(maxExclusive: number): number;
  /** Fisher-Yates shuffle in place; returns the same array. */
  shuffle<T>(items: T[]): T[];
};

/** Initial uint32 state: the first four bytes of the SHA-256 identity digest, big-endian. */
export function syntheticRepositoryPrngInitialState(identity: string): number {
  if (!IDENTITY_PATTERN.test(identity)) {
    throw new Error("PRNG identity must be a lowercase 64-character SHA-256 hex string.");
  }
  const b0 = Number.parseInt(identity.slice(0, 2), 16);
  const b1 = Number.parseInt(identity.slice(2, 4), 16);
  const b2 = Number.parseInt(identity.slice(4, 6), 16);
  const b3 = Number.parseInt(identity.slice(6, 8), 16);
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/** Generator-owned Mulberry32 stream (version "mulberry32-v1"). Never reads Math.random. */
export function createSyntheticRepositoryPrng(identity: string): SyntheticRepositoryPrng {
  let state = syntheticRepositoryPrngInitialState(identity);

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return (t ^ (t >>> 14)) >>> 0;
  };

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new RangeError(`nextInt bound must be an integer between 1 and ${UINT32_RANGE} (received ${maxExclusive}).`);
    }
    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let value = nextUint32();
    while (value >= limit) value = nextUint32();
    return value % maxExclusive;
  };

  return {
    nextUint32,
    nextFloat: () => nextUint32() / UINT32_RANGE,
    nextInt,
    shuffle<T>(items: T[]): T[] {
      for (let index = items.length - 1; index > 0; index -= 1) {
        const swapIndex = nextInt(index + 1);
        const held = items[index];
        items[index] = items[swapIndex];
        items[swapIndex] = held;
      }
      return items;
    },
  };
}
