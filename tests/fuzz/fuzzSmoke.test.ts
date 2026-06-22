import { describe, expect, it } from "vitest";
import { runFuzzTarget, runAllFuzzTargets } from "../../src/securityValidation/fuzz/fuzzHarness.js";
import {
  ALL_FUZZ_TARGETS,
  manifestReaderTarget,
  codeGraphReaderTarget,
  npmAuditParserTarget,
  npmLsParserTarget,
  npmOutdatedParserTarget,
  npmPackDryRunParserTarget,
  dotLabelEscapingTarget,
  pathNormalizationTarget,
  sourceWindowingTarget,
} from "../../src/securityValidation/fuzz/fuzzTargets.js";
import { createPrng, randomString, mutateJson, validManifestJson, validCodeGraphJson, ALL_MUTATION_STRATEGIES } from "../../src/securityValidation/fuzz/randomInput.js";

// ---------------------------------------------------------------------------
// Fuzz smoke tests
//
// Bounded and deterministic. Default CI run: 50 iterations per target.
// All tests must complete quickly (< 10s total for the full suite).
// Crashes produce structured findings; expected validation errors are not crashes.
// ---------------------------------------------------------------------------

const SMOKE_OPTIONS = { seed: 0xdeadbeef, iterations: 20, maxCrashesPerTarget: 5 };

describe("Fuzz harness — PRNG and input generation", () => {
  it("seeded PRNG is deterministic", () => {
    const prng1 = createPrng(42);
    const prng2 = createPrng(42);
    const vals1 = Array.from({ length: 10 }, () => prng1());
    const vals2 = Array.from({ length: 10 }, () => prng2());
    expect(vals1).toEqual(vals2);
  });

  it("different seeds produce different output", () => {
    const prng1 = createPrng(1);
    const prng2 = createPrng(2);
    const v1 = prng1();
    const v2 = prng2();
    expect(v1).not.toBe(v2);
  });

  it("randomString does not crash on any length", () => {
    const prng = createPrng(999);
    for (let i = 0; i < 20; i++) {
      const s = randomString(prng, 256);
      expect(typeof s).toBe("string");
    }
  });

  it("all mutation strategies produce strings without crashing", () => {
    const prng = createPrng(0xabc);
    const input = validManifestJson();
    for (const strategy of ALL_MUTATION_STRATEGIES) {
      const result = mutateJson(prng, input, strategy);
      expect(typeof result).toBe("string");
    }
  });

  it("validManifestJson and validCodeGraphJson return parseable JSON", () => {
    expect(() => JSON.parse(validManifestJson())).not.toThrow();
    expect(() => JSON.parse(validCodeGraphJson())).not.toThrow();
  });
});

describe("Fuzz harness — runFuzzTarget", () => {
  it("completes without throwing for manifest reader", async () => {
    const result = await runFuzzTarget(manifestReaderTarget, SMOKE_OPTIONS);
    expect(result.targetId).toBe("manifest-reader");
    expect(result.iterations).toBe(SMOKE_OPTIONS.iterations);
    expect(Array.isArray(result.crashes)).toBe(true);
  });

  it("records crashes as structured entries (not thrown exceptions)", async () => {
    // A target that always throws.
    const crashTarget = {
      id: "test-crash",
      name: "Test crash target",
      generateInput: (_prng: () => number, _i: number) => "input",
      run: (_input: string): undefined | string => {
        throw new Error("Intentional crash for testing");
      },
    };
    const result = await runFuzzTarget(crashTarget, { ...SMOKE_OPTIONS, iterations: 3 });
    expect(result.crashes.length).toBeGreaterThan(0);
    expect(result.crashes[0].errorMessage).toContain("Intentional crash");
  });

  it("expected validation errors (returned string) are not recorded as crashes", async () => {
    const validationTarget = {
      id: "test-validation",
      name: "Test validation error target",
      generateInput: (_prng: () => number, _i: number) => "input",
      run: (_input: string): undefined | string => "expected: always invalid",
    };
    const result = await runFuzzTarget(validationTarget, { ...SMOKE_OPTIONS, iterations: 5 });
    expect(result.crashes).toHaveLength(0);
  });

  it("respects maxCrashesPerTarget limit", async () => {
    const alwaysCrashTarget = {
      id: "test-always-crash",
      name: "Test always crash",
      generateInput: (_prng: () => number, _i: number) => "x",
      run: (_input: string): undefined | string => {
        throw new Error("crash");
      },
    };
    const result = await runFuzzTarget(alwaysCrashTarget, {
      seed: 1,
      iterations: 100,
      maxCrashesPerTarget: 3,
    });
    expect(result.crashes.length).toBeLessThanOrEqual(3);
  });
});

describe("Fuzz smoke — individual targets", () => {
  it("manifest reader handles malformed JSON without crashing", async () => {
    const result = await runFuzzTarget(manifestReaderTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });

  it("code-graph reader handles malformed JSON without crashing", async () => {
    const result = await runFuzzTarget(codeGraphReaderTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });

  it("npm audit parser handles arbitrary JSON without crashing", async () => {
    const result = await runFuzzTarget(npmAuditParserTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });

  it("npm ls parser handles arbitrary JSON without crashing", async () => {
    const result = await runFuzzTarget(npmLsParserTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });

  it("npm outdated parser handles arbitrary JSON without crashing", async () => {
    const result = await runFuzzTarget(npmOutdatedParserTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });

  it("npm pack dry-run parser handles arbitrary input without crashing", async () => {
    const result = await runFuzzTarget(npmPackDryRunParserTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });

  it("DOT label escaping never crashes on arbitrary strings", async () => {
    const result = await runFuzzTarget(dotLabelEscapingTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });

  it("path normalization never crashes on traversal inputs", async () => {
    const result = await runFuzzTarget(pathNormalizationTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });

  it("source windowing never crashes on edge-case window sizes", async () => {
    const result = await runFuzzTarget(sourceWindowingTarget, SMOKE_OPTIONS);
    expect(result.crashes).toHaveLength(0);
  });
});

describe("Fuzz smoke — runAllFuzzTargets", () => {
  it("completes within a reasonable time with default options", async () => {
    const result = await runAllFuzzTargets(ALL_FUZZ_TARGETS, SMOKE_OPTIONS);
    expect(result.id).toBe("fuzz-smoke");
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
    expect(result.durationMs).toBeLessThan(30_000);
  }, 35000);

  it("result has required SecurityCheckResult fields", async () => {
    const result = await runAllFuzzTargets(ALL_FUZZ_TARGETS, SMOKE_OPTIONS);
    expect(typeof result.id).toBe("string");
    expect(typeof result.name).toBe("string");
    expect(result.category).toBe("fuzz-smoke");
    expect(["passed", "failed", "warning", "skipped"]).toContain(result.status);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
    expect(typeof result.durationMs).toBe("number");
  }, 35000);

  it("different seeds produce consistent results on the same run", async () => {
    const result1 = await runAllFuzzTargets(ALL_FUZZ_TARGETS, { seed: 0x1234, iterations: 10 });
    const result2 = await runAllFuzzTargets(ALL_FUZZ_TARGETS, { seed: 0x1234, iterations: 10 });
    expect(result1.status).toBe(result2.status);
    expect(result1.findings.length).toBe(result2.findings.length);
  }, 35000);
});

describe("Fuzz smoke — ALL_FUZZ_TARGETS catalog", () => {
  it("covers expected target IDs", () => {
    const ids = ALL_FUZZ_TARGETS.map((t) => t.id);
    expect(ids).toContain("manifest-reader");
    expect(ids).toContain("code-graph-reader");
    expect(ids).toContain("npm-audit-parser");
    expect(ids).toContain("npm-ls-parser");
    expect(ids).toContain("npm-outdated-parser");
    expect(ids).toContain("npm-pack-dry-run-parser");
    expect(ids).toContain("dot-label-escaping");
    expect(ids).toContain("path-normalization");
    expect(ids).toContain("source-windowing");
  });

  it("all targets have non-empty id and name", () => {
    for (const target of ALL_FUZZ_TARGETS) {
      expect(target.id, `target id must be non-empty`).toBeTruthy();
      expect(target.name, `target '${target.id}' must have a name`).toBeTruthy();
    }
  });
});
