import { describe, expect, it } from "vitest";
import { calculateStageContextDeterminism } from "../../../src/evaluation/stageContextDeterminism/calculateStageContextDeterminism.js";
import type { StageContextDeterminismCandidateV1 } from "../../../src/evaluation/stageContextDeterminism/types.js";

describe("calculateStageContextDeterminism", () => {
  it("DET-022 one run returns not-applicable", () => {
    const result = calculateStageContextDeterminism([{ runNumber: 1, value: { a: 1 } }]);
    expect(result.availability).toBe("not-applicable");
  });

  it("DET-023 one-run reason is exact", () => {
    const result = calculateStageContextDeterminism([{ runNumber: 1, value: { a: 1 } }]);
    expect(result.reason).toBe("Repeated-run determinism requires at least two runs.");
  });

  it("DET-024 two identical runs are deterministic", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 2, value: { a: 1 } }
    ]);
    expect(result.availability).toBe("available");
    expect(result.deterministic).toBe(true);
  });

  it("DET-025 three identical runs are deterministic", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 2, value: { a: 1 } },
      { runNumber: 3, value: { a: 1 } }
    ]);
    expect(result.deterministic).toBe(true);
  });

  it("DET-026 a differing second run is nondeterministic", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 2, value: { a: 2 } }
    ]);
    expect(result.deterministic).toBe(false);
    expect(result.mismatchRunNumbers).toEqual([2]);
  });

  it("DET-027 a differing third run is nondeterministic", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 2, value: { a: 1 } },
      { runNumber: 3, value: { a: 2 } }
    ]);
    expect(result.deterministic).toBe(false);
    expect(result.mismatchRunNumbers).toEqual([3]);
  });

  it("DET-028 multiple mismatches are all returned", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 2, value: { a: 2 } },
      { runNumber: 3, value: { a: 3 } }
    ]);
    expect(result.mismatchRunNumbers).toEqual([2, 3]);
  });

  it("DET-029 mismatch order follows candidate order", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 3, value: { a: 3 } },
      { runNumber: 2, value: { a: 2 } }
    ]);
    expect(result.mismatchRunNumbers).toEqual([3, 2]);
  });

  it("DET-030 the first run is the baseline", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 5, value: { a: 1 } },
      { runNumber: 6, value: { a: 1 } }
    ]);
    expect(result.baselineSha256).toBe(result.runDigests[0].sha256);
  });

  it("DET-031 run digests preserve supplied order", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 2, value: { a: 2 } }
    ]);
    expect(result.runDigests.map((d) => d.runNumber)).toEqual([1, 2]);
  });

  it("DET-032 run numbers are preserved", () => {
    const candidates: StageContextDeterminismCandidateV1[] = [
      { runNumber: 10, value: { a: 1 } },
      { runNumber: 20, value: { a: 1 } }
    ];
    const result = calculateStageContextDeterminism(candidates);
    expect(result.runDigests.map((d) => d.runNumber)).toEqual([10, 20]);
  });

  it("DET-033 object insertion-order differences do not cause mismatch", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1, b: 2 } },
      { runNumber: 2, value: { b: 2, a: 1 } }
    ]);
    expect(result.deterministic).toBe(true);
  });

  it("DET-034 array-order differences cause mismatch", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: [1, 2, 3] },
      { runNumber: 2, value: [3, 2, 1] }
    ]);
    expect(result.deterministic).toBe(false);
  });

  it("DET-035 path differences cause mismatch", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { path: "src/a.ts" } },
      { runNumber: 2, value: { path: "src/b.ts" } }
    ]);
    expect(result.deterministic).toBe(false);
  });

  it("DET-036 null differences cause mismatch", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { field: null } },
      { runNumber: 2, value: { field: "value" } }
    ]);
    expect(result.deterministic).toBe(false);
  });

  it("DET-037 canonicalization failure returns unavailable", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: obj },
      { runNumber: 2, value: obj }
    ]);
    expect(result.availability).toBe("unavailable");
  });

  it("DET-038 unavailable reason is exact", () => {
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: 10n as unknown },
      { runNumber: 2, value: 10n as unknown }
    ]);
    expect(result.reason).toBe("Stage-context run values could not be canonicalized for determinism comparison.");
  });

  it("DET-039 candidate values are not mutated", () => {
    const candidates: StageContextDeterminismCandidateV1[] = [
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 2, value: { a: 1 } }
    ];
    const before = JSON.stringify(candidates);
    calculateStageContextDeterminism(candidates);
    expect(JSON.stringify(candidates)).toBe(before);
  });

  it("DET-040 no external tokenizer or hashing dependency is used", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/evaluation/stageContextDeterminism/calculateStageContextDeterminism.ts", "utf8");
    expect(source).toContain("node:crypto");
    expect(source.toLowerCase()).not.toContain("tiktoken");
  });
});
