import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SyntheticRepositoryConfigError,
  canonicalSyntheticRepositoryCaseText,
  computeSyntheticRepositoryCaseIdentity,
  computeSyntheticRepositoryConfigIdentity,
} from "../../../src/evaluation/syntheticRepository/index.js";
import type { SyntheticRepositoryCaseSpecV1 } from "../../../src/evaluation/syntheticRepository/index.js";
import { makeCase, makeConfig } from "./planOracle.js";

const HEX64 = /^[0-9a-f]{64}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("synthetic repository identity", () => {
  it("TST-020 config identity is stable, order independent and sensitive to every case field", () => {
    const cases = [makeCase({ id: "b" }), makeCase({ id: "a", seed: "other" }), makeCase({ id: "C" })];
    const forward = computeSyntheticRepositoryConfigIdentity(makeConfig(cases));
    const backward = computeSyntheticRepositoryConfigIdentity(makeConfig([...cases].reverse()));
    expect(forward).toMatch(HEX64);
    expect(backward).toBe(forward);
    expect(computeSyntheticRepositoryConfigIdentity(makeConfig(cases))).toBe(forward);

    const variants: Array<Partial<SyntheticRepositoryCaseSpecV1>> = [
      { id: "b2" },
      { language: "python" },
      { seed: "changed" },
      { sourceFileCount: 5 },
      { moduleDepth: 3 },
      { internalImportCount: 4 },
      { symbolCount: 9 },
      { testFileCount: 3 },
      { taskLocality: "cross-module" },
      { repeatedPatternCount: 4 },
    ];
    for (const change of variants) {
      const changed = [{ ...cases[0], ...change }, cases[1], cases[2]];
      expect(computeSyntheticRepositoryConfigIdentity(makeConfig(changed)), JSON.stringify(change)).not.toBe(forward);
    }
    expect(() => computeSyntheticRepositoryConfigIdentity(makeConfig([]))).toThrow(SyntheticRepositoryConfigError);
  });

  it("TST-021 case identity reacts to every generation-relevant field", () => {
    const base = makeCase({ sourceFileCount: 4, moduleDepth: 2, internalImportCount: 3, symbolCount: 8, taskLocality: "cross-module" });
    const variants: Array<Partial<SyntheticRepositoryCaseSpecV1>> = [
      { id: "case-2" },
      { language: "python" },
      { seed: "another-seed" },
      { sourceFileCount: 5 },
      { moduleDepth: 3 },
      { internalImportCount: 4 },
      { symbolCount: 9 },
      { testFileCount: base.testFileCount + 1 },
      { taskLocality: "localized" },
      { repeatedPatternCount: base.repeatedPatternCount + 1 },
    ];
    const identities = [computeSyntheticRepositoryCaseIdentity(base)];
    for (const change of variants) identities.push(computeSyntheticRepositoryCaseIdentity({ ...base, ...change }));
    expect(identities).toHaveLength(11);
    expect(new Set(identities).size).toBe(11);
    for (const identity of identities) expect(identity).toMatch(HEX64);
    expect(computeSyntheticRepositoryCaseIdentity(base)).toBe(identities[0]);
    expect(computeSyntheticRepositoryCaseIdentity(JSON.parse(JSON.stringify(base)))).toBe(identities[0]);
    expect(() => computeSyntheticRepositoryCaseIdentity({ ...base, sourceFileCount: 0 })).toThrow(SyntheticRepositoryConfigError);
  });

  it("TST-022 equals an independently computed sha256 and a pinned literal, unaffected by the environment", () => {
    const fixed: SyntheticRepositoryCaseSpecV1 = {
      id: "golden-1",
      language: "typescript",
      seed: "seed-α",
      sourceFileCount: 5,
      moduleDepth: 3,
      internalImportCount: 6,
      symbolCount: 9,
      testFileCount: 2,
      taskLocality: "cross-module",
      repeatedPatternCount: 4,
    };
    const canonical =
      '{"id":"golden-1","language":"typescript","seed":"seed-α","sourceFileCount":5,"moduleDepth":3,"internalImportCount":6,"symbolCount":9,"testFileCount":2,"taskLocality":"cross-module","repeatedPatternCount":4}';
    const documented = [
      "my-dev-kit-lab-synthetic-repository-config-v1",
      "1.0.0",
      "sha256-canonical-json-v1",
      "case",
      canonical,
    ].join("\n");
    const independent = createHash("sha256").update(Buffer.from(documented, "utf8")).digest("hex");

    expect(canonicalSyntheticRepositoryCaseText(fixed)).toBe(canonical);
    expect(canonicalSyntheticRepositoryCaseText(Object.fromEntries(Object.entries(fixed).reverse()) as SyntheticRepositoryCaseSpecV1)).toBe(
      canonical
    );
    const plain = computeSyntheticRepositoryCaseIdentity(fixed);
    expect(plain).toBe(independent);
    expect(plain).toBe("cde5faac5230338ce399cf5f1bd0cd838ab8a9816b4f71cc20be42a21720e769");

    const throwing = (name: string) => () => {
      throw new Error(`${name} must not be consulted`);
    };
    vi.spyOn(Date, "now").mockImplementation(throwing("Date.now"));
    vi.spyOn(process, "cwd").mockImplementation(throwing("process.cwd"));
    vi.spyOn(Math, "random").mockImplementation(throwing("Math.random"));
    expect(computeSyntheticRepositoryCaseIdentity(fixed)).toBe(independent);
  });

  it("TST-023 separates the case and config identity domains", () => {
    const only = makeCase();
    expect(computeSyntheticRepositoryConfigIdentity(makeConfig([only]))).not.toBe(computeSyntheticRepositoryCaseIdentity(only));
  });
});
