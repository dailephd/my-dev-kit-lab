import { describe, expect, it } from "vitest";
import { validateAnswerKey } from "../../../src/evaluation/benchmarkMetadata.js";

const baseKey = (expectedContextTargets: unknown) => ({
  expectedFiles: ["src/a.ts"],
  expectedSymbols: ["X"],
  expectedFacts: [
    { id: "f1", text: "one", weight: 1, required: true },
    { id: "f2", text: "two", weight: 1, required: false }
  ],
  expectedContextTargets,
  minimumCorrectFacts: 1
});

const validate = (targets: unknown) => validateAnswerKey(baseKey(targets), "case");

describe("validateAnswerKey fact-mapped context targets", () => {
  it("accepts valid factIds mappings, including symbols and optional targets", () => {
    expect(validate([{ file: "src/a.ts", symbols: ["X"], required: true, factIds: ["f1"] }, { file: "src\\b.ts", required: false, factIds: ["f1", "f2"] }])).toEqual([]);
  });

  it("keeps legacy targets without factIds valid, even when they would not satisfy the new rules", () => {
    expect(validate([{ file: "src/a.ts" }, { projectId: "p", file: "src/a.ts", symbols: ["X"], required: true }, { file: "/not-validated-legacy" }])).toEqual([]);
    expect(validateAnswerKey({ ...baseKey(undefined), expectedContextTargets: undefined }, "case")).toEqual([]);
  });

  it("rejects unknown fact ids", () => {
    expect(validate([{ file: "src/a.ts", factIds: ["nope"] }])).toEqual(["case: answerKey.expectedContextTargets[0]: factIds must reference existing expectedFacts ids."]);
  });

  it("rejects duplicate fact ids within one target", () => {
    expect(validate([{ file: "src/a.ts", factIds: ["f1", "f1"] }])).toEqual(["case: answerKey.expectedContextTargets[0]: factIds must not contain duplicates."]);
  });

  it("rejects non-array, empty and non-string fact ids", () => {
    for (const factIds of ["f1", {}, [], [""], [1], [null]]) {
      expect(validate([{ file: "src/a.ts", factIds }]), JSON.stringify(factIds)).toEqual(["case: answerKey.expectedContextTargets[0]: factIds must be a nonempty array of nonempty strings."]);
    }
  });

  it("rejects unsafe target files without echoing them", () => {
    for (const file of ["/abs/a.ts", "../a.ts", "C:\\a.ts", "a//b.ts", "", 5, undefined]) {
      const errors = validate([{ file, factIds: ["f1"] }]);
      expect(errors, String(file)).toEqual(["case: answerKey.expectedContextTargets[0]: file must be a safe repository-relative path."]);
    }
  });

  it("rejects invalid or duplicate target symbols and a non-boolean required flag", () => {
    expect(validate([{ file: "src/a.ts", factIds: ["f1"], symbols: [""] }])[0]).toContain("symbols must be an array of nonempty strings");
    expect(validate([{ file: "src/a.ts", factIds: ["f1"], symbols: "X" }])[0]).toContain("symbols must be an array of nonempty strings");
    expect(validate([{ file: "src/a.ts", factIds: ["f1"], symbols: ["X", "X"] }])[0]).toContain("symbols must not contain duplicates");
    expect(validate([{ file: "src/a.ts", factIds: ["f1"], required: "no" }])[0]).toContain("required must be a boolean when present");
  });

  it("reports the index of each offending target", () => {
    const errors = validate([{ file: "src/a.ts", factIds: ["f1"] }, { file: "src/a.ts", factIds: ["nope"] }, { file: "../x", factIds: ["f1"] }]);
    expect(errors.map((error) => error.slice(0, 41))).toEqual([
      "case: answerKey.expectedContextTargets[1]",
      "case: answerKey.expectedContextTargets[2]"
    ]);
  });
});
