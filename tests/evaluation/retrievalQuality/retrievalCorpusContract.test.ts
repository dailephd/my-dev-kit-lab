import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../../../src/evaluation/index.js";
import {
  interpretFactContextTarget,
  validateRetrievalPrecisionRecallCase,
  validateRetrievalPrecisionRecallCorpus
} from "../../../src/evaluation/retrievalQuality/index.js";
import type { EvaluationCase, EvaluationCaseInput } from "../../../src/evaluation/types.js";
import { ORIGINAL_CORPUS_SHA256, PLANNER_FACT_MAPPINGS } from "./plannerFactMappings.js";

const CORPUS_PATH = path.resolve("benchmarks/contracts/warm-index-benchmark-cases.json");

async function loadCorpus(): Promise<EvaluationCase[]> {
  const profiles = await readBenchmarkProjectProfiles(path.resolve("benchmarks/contracts/benchmark-project-profiles.json"), process.cwd());
  return readEvaluationCases(CORPUS_PATH, process.cwd(), { projectProfiles: profiles, requireProjectProfileRef: true });
}

describe("bundled retrieval-precision-recall corpus", () => {
  it("keeps the 12-case, two-project, three-locality shape and validates through the normal reader", async () => {
    const cases = await loadCorpus();
    expect(cases).toHaveLength(12);
    expect([...new Set(cases.map((entry) => entry.benchmarkProject))]).toEqual(["task-workflow-medium-ts", "task-analytics-large-mixed"]);
    expect([...new Set(cases.map((entry) => entry.taskLocality))].sort()).toEqual(["broad-change", "cross-module", "localized"]);
  });

  it("changes no original field: only expectedContextTargets was added", async () => {
    const original = JSON.parse(await readFile(CORPUS_PATH, "utf8")) as Array<{ answerKey: Record<string, unknown> }>;
    for (const entry of original) delete entry.answerKey.expectedContextTargets;
    expect(createHash("sha256").update(JSON.stringify(original)).digest("hex")).toBe(ORIGINAL_CORPUS_SHA256);
  });

  it("contains exactly the original 54 expected fact ids with complete required mappings", async () => {
    const cases = await loadCorpus();
    const factIds = cases.flatMap((entry) => entry.answerKey!.expectedFacts.map((fact) => fact.id));
    expect(factIds).toHaveLength(54);
    expect(new Set(factIds).size).toBe(54);
    expect(factIds.sort()).toEqual(Object.values(PLANNER_FACT_MAPPINGS).flatMap((facts) => Object.keys(facts)).sort());

    for (const entry of cases) {
      const known = new Set(entry.answerKey!.expectedFacts.map((fact) => fact.id));
      const mapped = new Set<string>();
      for (const target of entry.answerKey!.expectedContextTargets ?? []) {
        const interpreted = interpretFactContextTarget(target, known);
        expect(interpreted.ok, `${entry.id} ${JSON.stringify(target.file)}`).toBe(true);
        if (interpreted.ok && interpreted.target.required) interpreted.target.factIds.forEach((id) => mapped.add(id));
      }
      expect([...mapped].sort(), entry.id).toEqual([...known].sort());
    }
  });

  it("maps only to files and symbols already in each case's answer key", async () => {
    for (const entry of await loadCorpus()) {
      const files = new Set(entry.answerKey!.expectedFiles);
      const symbols = new Set(entry.answerKey!.expectedSymbols);
      for (const target of entry.answerKey!.expectedContextTargets ?? []) {
        expect(files.has(target.file), `${entry.id} ${target.file}`).toBe(true);
        for (const symbol of target.symbols ?? []) expect(symbols.has(symbol), `${entry.id} ${symbol}`).toBe(true);
      }
    }
  });

  it("preserves the planner's exact fact-to-target relation", async () => {
    const cases = await loadCorpus();
    for (const entry of cases) {
      const expected = PLANNER_FACT_MAPPINGS[entry.id];
      expect(expected, entry.id).toBeDefined();
      // Rebuild each fact's required (file, symbol) set from the merged corpus targets.
      const actual = new Map<string, Set<string>>(entry.answerKey!.expectedFacts.map((fact) => [fact.id, new Set<string>()]));
      for (const target of entry.answerKey!.expectedContextTargets ?? []) {
        for (const factId of target.factIds ?? []) {
          for (const symbol of target.symbols ?? []) actual.get(factId)!.add(`${target.file}::${symbol}`);
        }
      }
      for (const [factId, pairs] of Object.entries(expected)) {
        expect([...(actual.get(factId) ?? [])].sort(), `${entry.id} ${factId}`).toEqual(pairs.map(([file, symbol]) => `${file}::${symbol}`).sort());
      }
    }
  });

  it("passes the retrieval-precision-recall completeness gate", async () => {
    expect(validateRetrievalPrecisionRecallCorpus(await loadCorpus())).toEqual([]);
  });
});

describe("retrieval-precision-recall completeness gate", () => {
  const validCase = (): EvaluationCaseInput => ({
    id: "c1",
    title: "t",
    benchmarkProject: "p",
    targetRoot: "x",
    sourceRoots: ["src"],
    query: "q",
    expectedFiles: ["src/a.ts"],
    expectedSymbols: ["A"],
    rawIncludeGlobs: [],
    answerKey: {
      expectedFiles: ["src/a.ts"],
      expectedSymbols: ["A"],
      expectedFacts: [{ id: "f1", text: "one", weight: 1, required: true }],
      expectedContextTargets: [{ file: "src/a.ts", symbols: ["A"], required: true, factIds: ["f1"] }],
      minimumCorrectFacts: 1
    }
  });
  const withKey = (patch: Record<string, unknown>): EvaluationCaseInput => {
    const base = validCase();
    return { ...base, answerKey: { ...base.answerKey!, ...patch } as EvaluationCaseInput["answerKey"] };
  };

  it("accepts a complete case", () => {
    expect(validateRetrievalPrecisionRecallCase(validCase())).toEqual([]);
  });

  it("rejects each violated completeness rule with a bounded message", () => {
    const cases: Array<[string, EvaluationCaseInput, string]> = [
      ["missing answer key", { ...validCase(), answerKey: undefined }, "answerKey is required"],
      ["empty expected files", withKey({ expectedFiles: [] }), "expectedFiles must be a nonempty array"],
      ["empty expected symbols", withKey({ expectedSymbols: [] }), "expectedSymbols must be a nonempty array"],
      ["no facts", withKey({ expectedFacts: [] }), "expectedFacts must be a nonempty array"],
      ["no targets", withKey({ expectedContextTargets: undefined }), "expectedContextTargets is required"],
      ["unmapped fact", withKey({ expectedContextTargets: [{ file: "src/a.ts", symbols: ["A"], factIds: ["f1"], required: false }] }), "expected fact f1 has no required fact-mapped context target"],
      ["unknown fact id", withKey({ expectedContextTargets: [{ file: "src/a.ts", factIds: ["nope"] }] }), "factIds must reference existing expectedFacts ids"],
      ["unsafe target file", withKey({ expectedContextTargets: [{ file: "/abs/a.ts", factIds: ["f1"] }] }), "file must be a safe repository-relative path"],
      ["file outside the answer key", withKey({ expectedContextTargets: [{ file: "src/b.ts", factIds: ["f1"] }] }), "file must be listed in answerKey.expectedFiles"],
      ["symbol outside the answer key", withKey({ expectedContextTargets: [{ file: "src/a.ts", symbols: ["Z"], factIds: ["f1"] }] }), "every symbol must be listed in answerKey.expectedSymbols"],
      ["legacy target hiding an expectation", withKey({ expectedContextTargets: [{ file: "src/a.ts", factIds: ["f1"] }, { file: "src/hidden.ts" }] }), "file must be listed in answerKey.expectedFiles"],
      ["top-level files disagree", { ...validCase(), expectedFiles: ["src/other.ts"] }, "expectedFiles must agree with answerKey.expectedFiles"],
      ["top-level symbols disagree", { ...validCase(), expectedSymbols: ["Other"] }, "expectedSymbols must agree with answerKey.expectedSymbols"]
    ];
    for (const [label, input, fragment] of cases) {
      const errors = validateRetrievalPrecisionRecallCase(input);
      expect(errors.some((error) => error.includes(fragment)), `${label}: ${JSON.stringify(errors)}`).toBe(true);
      expect(errors.join(" ")).not.toContain("/abs/a.ts");
    }
  });

  it("rejects duplicate case ids at corpus level", () => {
    expect(validateRetrievalPrecisionRecallCorpus([validCase(), validCase()])).toEqual(["retrieval-precision-recall corpus: duplicate case id c1."]);
  });
});
