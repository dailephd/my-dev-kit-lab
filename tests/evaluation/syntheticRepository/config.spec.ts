import { describe, expect, it } from "vitest";
import { TASK_LOCALITIES } from "../../../src/evaluation/types.js";
import {
  SYNTHETIC_REPOSITORY_CASE_FIELDS,
  SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_ID,
  SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION,
  SYNTHETIC_REPOSITORY_LIMITS,
  SyntheticRepositoryConfigError,
  normalizeSyntheticRepositoryConfig,
  validateSyntheticRepositoryCaseSpec,
  validateSyntheticRepositoryConfig,
} from "../../../src/evaluation/syntheticRepository/index.js";
import { deepFreeze, makeCase, makeConfig } from "./planOracle.js";

function errorsOf(overrides: Record<string, unknown>): string[] {
  return validateSyntheticRepositoryConfig(makeConfig([{ ...makeCase(), ...overrides }])).errors;
}

function accepts(overrides: Record<string, unknown>): boolean {
  return validateSyntheticRepositoryConfig(makeConfig([{ ...makeCase(), ...overrides }])).ok;
}

describe("synthetic repository config validation", () => {
  it("TST-001 accepts and normalizes a minimal typescript case", () => {
    const input = makeConfig([
      {
        repeatedPatternCount: 0,
        taskLocality: "localized",
        testFileCount: 0,
        symbolCount: 1,
        internalImportCount: 0,
        moduleDepth: 1,
        sourceFileCount: 1,
        seed: "s",
        language: "typescript",
        id: "min",
      },
    ]);
    const result = validateSyntheticRepositoryConfig(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    const normalized = normalizeSyntheticRepositoryConfig(input);
    expect(normalized).toEqual({
      schemaVersion: "1.0.0",
      cases: [
        {
          id: "min",
          language: "typescript",
          seed: "s",
          sourceFileCount: 1,
          moduleDepth: 1,
          internalImportCount: 0,
          symbolCount: 1,
          testFileCount: 0,
          taskLocality: "localized",
          repeatedPatternCount: 0,
        },
      ],
    });
    expect(Object.keys(normalized.cases[0])).toEqual([...SYNTHETIC_REPOSITORY_CASE_FIELDS]);
  });

  it("TST-002 accepts a minimal python case and preserves the language", () => {
    const normalized = normalizeSyntheticRepositoryConfig(
      makeConfig([makeCase({ language: "python", sourceFileCount: 1, moduleDepth: 1, internalImportCount: 0, symbolCount: 1 })])
    );
    expect(normalized.cases[0].language).toBe("python");
  });

  it("TST-003 sorts cases by code-unit order independent of input order and key order", () => {
    const reversedKeys = (spec: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(spec).reverse());
    const a = [makeCase({ id: "b-2" }), makeCase({ id: "A1" }), makeCase({ id: "a1x" })];
    const first = normalizeSyntheticRepositoryConfig(makeConfig(a));
    const second = normalizeSyntheticRepositoryConfig(
      makeConfig([a[2], a[0], a[1]].map((spec) => reversedKeys(spec as unknown as Record<string, unknown>)))
    );
    expect(first.cases.map((spec) => spec.id)).toEqual(["A1", "a1x", "b-2"]);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    for (const spec of second.cases) expect(Object.keys(spec)).toEqual([...SYNTHETIC_REPOSITORY_CASE_FIELDS]);
    expect(normalizeSyntheticRepositoryConfig(first)).toEqual(first);
  });

  it("TST-004 rejects duplicate ids, including ids that differ only by letter case", () => {
    for (const ids of [
      ["same", "same"],
      ["Same", "sAME"],
    ]) {
      const result = validateSyntheticRepositoryConfig(makeConfig(ids.map((id) => makeCase({ id }))));
      expect(result.ok).toBe(false);
      expect(result.errors.some((error) => /duplicate/i.test(error))).toBe(true);
      expect(result.config).toBeUndefined();
    }
  });

  it("TST-005 rejects malformed top-level configurations and enforces the case-count boundary", () => {
    for (const bad of [null, [], "text", 7, undefined]) {
      const result = validateSyntheticRepositoryConfig(bad);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toMatch(/^config:/);
    }
    expect(validateSyntheticRepositoryConfig({ schemaVersion: "2.0.0", cases: [makeCase()] }).errors.join("\n")).toMatch(
      /schemaVersion/
    );
    expect(validateSyntheticRepositoryConfig({ cases: [makeCase()] }).errors.join("\n")).toMatch(/schemaVersion/);
    expect(validateSyntheticRepositoryConfig({ schemaVersion: "1.0.0", cases: {} }).errors.join("\n")).toMatch(/cases/);
    expect(validateSyntheticRepositoryConfig({ schemaVersion: "1.0.0" }).errors.join("\n")).toMatch(/cases/);
    expect(validateSyntheticRepositoryConfig({ schemaVersion: "1.0.0", cases: [] }).ok).toBe(false);

    const caseOf = (count: number): unknown[] => Array.from({ length: count }, (_, index) => makeCase({ id: `c${index + 1}` }));
    expect(validateSyntheticRepositoryConfig(makeConfig(caseOf(64))).ok).toBe(true);
    const tooMany = validateSyntheticRepositoryConfig(makeConfig(caseOf(65)));
    expect(tooMany.ok).toBe(false);
    expect(tooMany.errors.join("\n")).toMatch(/between 1 and 64/);
  });

  it("TST-006 rejects unknown and missing fields without applying defaults", () => {
    const extraConfig = validateSyntheticRepositoryConfig({ ...makeConfig([makeCase()]), extra: 1 });
    expect(extraConfig.ok).toBe(false);
    expect(extraConfig.errors.join("\n")).toContain('"extra"');

    const extraCase = errorsOf({ surprise: true });
    expect(extraCase.join("\n")).toContain('"surprise"');

    for (const field of SYNTHETIC_REPOSITORY_CASE_FIELDS) {
      const spec: Record<string, unknown> = { ...makeCase() };
      delete spec[field];
      const result = validateSyntheticRepositoryConfig(makeConfig([spec]));
      expect(result.ok, `missing ${field}`).toBe(false);
      expect(result.errors.join("\n")).toContain(`missing required field ${field}`);
      expect(result.config).toBeUndefined();
    }
  });

  it("TST-007 rejects unknown languages and localities and accepts the shared locality vocabulary", () => {
    for (const language of ["java", "TypeScript", "", null, 3]) {
      expect(errorsOf({ language }).join("\n")).toMatch(/language/);
    }
    for (const taskLocality of ["global", "Localized", "", null, 1]) {
      expect(errorsOf({ taskLocality }).join("\n")).toMatch(/taskLocality/);
    }
    expect([...TASK_LOCALITIES]).toEqual(["localized", "cross-module", "broad-change"]);
    for (const taskLocality of TASK_LOCALITIES) {
      expect(accepts({ taskLocality }), taskLocality).toBe(true);
    }
  });

  it("TST-008 never coerces numeric fields", () => {
    const fields = [
      "sourceFileCount",
      "moduleDepth",
      "internalImportCount",
      "symbolCount",
      "testFileCount",
      "repeatedPatternCount",
    ] as const;
    const forbiddenZero = new Set(["sourceFileCount", "moduleDepth", "symbolCount"]);
    for (const field of fields) {
      const variants: unknown[] = ["5", 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -1, null, undefined, true, [], {}];
      if (forbiddenZero.has(field)) variants.push(0);
      for (const value of variants) {
        const result = validateSyntheticRepositoryConfig(makeConfig([{ ...makeCase(), [field]: value }]));
        expect(result.ok, `${field}=${String(value)}`).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        for (const error of result.errors) expect(error, `${field}=${String(value)}`).toContain(field);
      }
    }
  });

  it("TST-009 enforces every numeric range at limit-1, limit and limit+1", () => {
    const table: Array<{
      field: string;
      companions: Record<string, unknown>;
      min: number;
      max: number;
      companionsAt: (value: number) => Record<string, unknown>;
    }> = [
      {
        field: "sourceFileCount",
        companions: {},
        min: 1,
        max: 10000,
        companionsAt: (value) => ({ sourceFileCount: value, moduleDepth: 1, internalImportCount: 0, symbolCount: Math.max(value, 1) }),
      },
      {
        field: "moduleDepth",
        companions: {},
        min: 1,
        max: 64,
        companionsAt: (value) => ({ sourceFileCount: 65, moduleDepth: value, internalImportCount: Math.max(value - 1, 0), symbolCount: 65 }),
      },
      {
        field: "internalImportCount",
        companions: {},
        min: 0,
        max: 100000,
        companionsAt: (value) => ({ sourceFileCount: 1000, moduleDepth: value === 0 ? 1 : 2, internalImportCount: value, symbolCount: 1000 }),
      },
      {
        field: "symbolCount",
        companions: {},
        min: 1,
        max: 100000,
        companionsAt: (value) => ({ sourceFileCount: 1, moduleDepth: 1, internalImportCount: 0, symbolCount: value }),
      },
      {
        field: "testFileCount",
        companions: {},
        min: 0,
        max: 10000,
        companionsAt: (value) => ({ testFileCount: value }),
      },
      {
        field: "repeatedPatternCount",
        companions: {},
        min: 0,
        max: 100000,
        companionsAt: (value) => ({ repeatedPatternCount: value }),
      },
    ];
    for (const row of table) {
      for (const value of [row.min, row.min + 1, row.max - 1, row.max]) {
        expect(accepts(row.companionsAt(value)), `${row.field}=${value}`).toBe(true);
      }
      for (const value of [row.min - 1, row.max + 1]) {
        const errors = errorsOf(row.companionsAt(value));
        expect(errors.length, `${row.field}=${value}`).toBeGreaterThan(0);
        expect(errors.join("\n"), `${row.field}=${value}`).toContain(row.field);
      }
    }
  });

  it("TST-010 rejects unsafe case ids and accepts safe ones without sanitizing", () => {
    const unsafe = [
      "",
      "a".repeat(65),
      "../x",
      "a/b",
      "a\\b",
      ".hidden",
      "-x",
      "_x",
      "a b",
      "a:",
      "é",
      "a.",
      "CON",
      "nul.txt",
      "COM1",
      "lpt9",
    ];
    for (const id of unsafe) {
      const result = validateSyntheticRepositoryConfig(makeConfig([makeCase({ id })]));
      expect(result.ok, JSON.stringify(id)).toBe(false);
      expect(result.errors.join("\n")).toContain(".id");
    }
    for (const id of ["a", "a".repeat(64), "Case-1_v2.0"]) {
      const normalized = normalizeSyntheticRepositoryConfig(makeConfig([makeCase({ id })]));
      expect(normalized.cases[0].id).toBe(id);
    }
    expect(errorsOf({ id: 5 }).join("\n")).toMatch(/\.id: must be a string/);
  });

  it("TST-011 validates seeds and preserves accepted seeds exactly", () => {
    const rejected = ["", "   ", "\t\n", "a".repeat(257), "\ud800", "\udc00", "x\ud800y", "\udc00\ud800"];
    for (const seed of rejected) {
      const result = validateSyntheticRepositoryConfig(makeConfig([makeCase({ seed })]));
      expect(result.ok, JSON.stringify(seed)).toBe(false);
      expect(result.errors.join("\n")).toContain(".seed");
    }
    expect(errorsOf({ seed: 12 }).join("\n")).toMatch(/\.seed: must be a string/);
    const accepted = ["a".repeat(256), "héllo 日本語 😀", "  padded  ", "\u{1F600}".repeat(128), "line1\nline2"];
    for (const seed of accepted) {
      const normalized = normalizeSyntheticRepositoryConfig(makeConfig([makeCase({ seed })]));
      expect(normalized.cases[0].seed).toBe(seed);
    }
  });

  it("TST-012 validate never throws or mutates, normalize throws a ConfigError with the same errors", () => {
    const invalid = deepFreeze({
      schemaVersion: "1.0.0",
      zeta: 1,
      alpha: 2,
      cases: [{ ...makeCase(), id: "../bad", language: "java", sourceFileCount: "4" }],
    });
    const snapshot = JSON.stringify(invalid);
    const first = validateSyntheticRepositoryConfig(invalid);
    const second = validateSyntheticRepositoryConfig(invalid);
    expect(first.ok).toBe(false);
    expect(second.errors).toEqual(first.errors);
    expect(JSON.stringify(invalid)).toBe(snapshot);
    const alphaIndex = first.errors.findIndex((error) => error.includes('"alpha"'));
    const zetaIndex = first.errors.findIndex((error) => error.includes('"zeta"'));
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeLessThan(zetaIndex);

    let thrown: unknown;
    try {
      normalizeSyntheticRepositoryConfig(invalid);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SyntheticRepositoryConfigError);
    expect((thrown as SyntheticRepositoryConfigError).errors).toEqual(first.errors);
    expect((thrown as Error).name).toBe("SyntheticRepositoryConfigError");
  });

  it("TST-045 freezes the schema constants and planner limits", () => {
    expect(SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_ID).toBe("my-dev-kit-lab-synthetic-repository-config-v1");
    expect(SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION).toBe("1.0.0");
    expect(SYNTHETIC_REPOSITORY_LIMITS).toEqual({
      maxCases: 64,
      caseIdMaxLength: 64,
      seedMaxLength: 256,
      sourceFileCount: { min: 1, max: 10000 },
      moduleDepth: { min: 1, max: 64 },
      internalImportCount: { min: 0, max: 100000 },
      symbolCount: { min: 1, max: 100000 },
      testFileCount: { min: 0, max: 10000 },
      repeatedPatternCount: { min: 0, max: 100000 },
      broadChangeMinSourceFiles: 4,
      crossModuleMinSourceFiles: 2,
    });
    expect([...SYNTHETIC_REPOSITORY_CASE_FIELDS]).toEqual([
      "id",
      "language",
      "seed",
      "sourceFileCount",
      "moduleDepth",
      "internalImportCount",
      "symbolCount",
      "testFileCount",
      "taskLocality",
      "repeatedPatternCount",
    ]);
  });

  it("validates a single case spec through the case-level entry point", () => {
    const ok = validateSyntheticRepositoryCaseSpec(makeCase());
    expect(ok.ok).toBe(true);
    const bad = validateSyntheticRepositoryCaseSpec({ ...makeCase(), id: "" });
    expect(bad.ok).toBe(false);
    expect(validateSyntheticRepositoryCaseSpec("nope").ok).toBe(false);
  });
});
