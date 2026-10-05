import { describe, expect, it } from "vitest";
import {
  buildRetrievalEvidence,
  calculateRetrievalQualityMetrics,
  type RetrievalEvidenceV1,
  type RetrievalQualityMetricsV1
} from "../../../src/evaluation/retrievalQuality/index.js";
import type { BenchmarkTaskAnswerKey, EvaluationCaseInput, ExpectedAnswerFact, ExpectedContextTarget } from "../../../src/evaluation/types.js";

type SymbolSpec = { name: string; file?: string; nodeId?: string };

function evidence(files: string[], symbols: SymbolSpec[] = [], availability: RetrievalEvidenceV1["availability"] = "available"): RetrievalEvidenceV1 {
  return {
    schemaVersion: "retrieval-evidence-v1",
    availability,
    ...(availability === "available" ? {} : { availabilityReason: "test" }),
    files: files.map((path) => ({ path, surfacedBy: ["search"] })),
    symbols: symbols.map((symbol) => ({ ...symbol, surfacedBy: ["search"] })),
    commands: []
  };
}

const facts = (...ids: string[]): ExpectedAnswerFact[] => ids.map((id) => ({ id, text: `text of ${id}`, weight: 1, required: true }));

function caseOf(overrides: {
  files?: string[];
  symbols?: string[];
  answerKey?: Partial<BenchmarkTaskAnswerKey> | null;
  topFiles?: string[];
  topSymbols?: string[];
}): Pick<EvaluationCaseInput, "id" | "expectedFiles" | "expectedSymbols" | "answerKey"> {
  const files = overrides.files ?? ["a.ts"];
  const symbols = overrides.symbols ?? ["X"];
  return {
    id: "case-1",
    expectedFiles: overrides.topFiles ?? files,
    expectedSymbols: overrides.topSymbols ?? symbols,
    answerKey:
      overrides.answerKey === null
        ? undefined
        : overrides.answerKey === undefined
          ? undefined
          : { expectedFiles: files, expectedSymbols: symbols, expectedFacts: [], minimumCorrectFacts: 0, ...overrides.answerKey }
  };
}

const retrieval = (retrievalEvidence: RetrievalEvidenceV1 | undefined, totalEstimatedTokens = 100) => ({
  retrievalEvidence,
  totalEstimatedTokens,
  tokenCountMethod: "estimated_chars_div_4"
});

const calc = (c: ReturnType<typeof caseOf>, e: RetrievalEvidenceV1 | undefined, tokens?: number): RetrievalQualityMetricsV1 =>
  calculateRetrievalQualityMetrics({ evaluationCase: c, retrieval: retrieval(e, tokens) });

const avail = (value: number, numerator: number, denominator: number) => ({ availability: "available", numerator, denominator, value, reason: null });
const notApplicable = (reason: string) => ({ availability: "not-applicable", numerator: null, denominator: null, value: null, reason });
const unavailable = (reason: string) => ({ availability: "unavailable", numerator: null, denominator: null, value: null, reason });

describe("file metrics", () => {
  it("TST-B2-001 perfect retrieval", () => {
    const m = calc(caseOf({ files: ["a.ts", "b.ts"] }), evidence(["b.ts", "a.ts"]));
    expect(m.file).toMatchObject({ precision: avail(1, 2, 2), recall: avail(1, 2, 2), missedFiles: [], irrelevantRetrievedFiles: [], relevantRetrievedFiles: ["a.ts", "b.ts"], missedFileCount: 0 });
    expect(m.irrelevantContextRatio).toEqual(avail(0, 0, 2));
  });

  it("TST-B2-002 extra irrelevant files lower precision and raise noise", () => {
    const m = calc(caseOf({ files: ["a.ts", "b.ts"] }), evidence(["a.ts", "b.ts", "c.ts"]));
    expect(m.file.precision).toEqual(avail(2 / 3, 2, 3));
    expect(m.file.recall).toEqual(avail(1, 2, 2));
    expect(m.irrelevantContextRatio).toEqual(avail(1 / 3, 1, 3));
    expect(m.file.irrelevantRetrievedFiles).toEqual(["c.ts"]);
    expect(m.irrelevantContextRatio.value).toBeCloseTo(1 - (m.file.precision.value as number), 12);
  });

  it("TST-B2-003 missed expected files lower recall", () => {
    const m = calc(caseOf({ files: ["a.ts", "b.ts", "c.ts"] }), evidence(["a.ts"]));
    expect(m.file.precision).toEqual(avail(1, 1, 1));
    expect(m.file.recall).toEqual(avail(1 / 3, 1, 3));
    expect(m.file.missedFiles).toEqual(["b.ts", "c.ts"]);
    expect(m.file.missedFileCount).toBe(2);
  });

  it("TST-B2-004 zero retrieved files: precision and noise not-applicable, recall a real zero", () => {
    const m = calc(caseOf({ files: ["a.ts", "b.ts"] }), evidence([]));
    expect(m.file.precision).toEqual(notApplicable("no-retrieved-files"));
    expect(m.irrelevantContextRatio).toEqual(notApplicable("no-retrieved-files"));
    expect(m.file.recall).toEqual(avail(0, 0, 2));
    expect(m.file.missedFiles).toEqual(["a.ts", "b.ts"]);
  });

  it("zero expected files: recall not-applicable, precision a real zero", () => {
    const m = calc(caseOf({ files: [] }), evidence(["a.ts"]));
    expect(m.file.recall).toEqual(notApplicable("no-expected-files"));
    expect(m.file.precision).toEqual(avail(0, 0, 1));
  });

  it("TST-B2-025 keeps files surfaced only through symbol nodes in the retrieved universe", () => {
    const retrieved = buildRetrievalEvidence({
      commands: [
        { family: "search", ok: true, stdout: JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "1.0.0", results: [{ kind: "file", path: "a.ts", nodeId: "file:a.ts" }] }) },
        { family: "lookup", ok: true, stdout: JSON.stringify({ status: "found", node: { kind: "file", path: "a.ts", id: "file:a.ts" }, neighbors: [{ kind: "symbol", id: "symbol:n.ts#helper", symbolName: "helper", path: "n.ts" }] }) }
      ]
    });
    const m = calc(caseOf({ files: ["a.ts"] }), retrieved);
    expect(m.file.irrelevantRetrievedFiles).toEqual(["n.ts"]);
    expect(m.file.precision).toEqual(avail(0.5, 1, 2));
  });

  it("TST-B2-010 unsafe expected file identities are not sanitized into the metric sets", () => {
    for (const unsafe of ["/abs/a.ts", "../a.ts", "C:\\a.ts", "a//b.ts"]) {
      const m = calc(caseOf({ files: ["a.ts", unsafe] }), evidence(["a.ts"]));
      expect(m.expectations.files).toEqual({ availability: "unavailable", reason: "unsafe-expected-file-identity" });
      expect(m.file.precision).toEqual(unavailable("unsafe-expected-file-identity"));
      expect(m.file.recall).toEqual(unavailable("unsafe-expected-file-identity"));
      expect(m.irrelevantContextRatio).toEqual(unavailable("unsafe-expected-file-identity"));
      expect(m.file.missedFiles).toBeNull();
      expect(JSON.stringify(m)).not.toContain(unsafe.replace(/\\/g, "\\\\"));
    }
  });

  it("normalizes expected and retrieved file identities with the same contract", () => {
    const m = calc(caseOf({ files: ["src\\a.ts", "./b.ts"] }), evidence(["src/a.ts", "b.ts"]));
    expect(m.file.recall).toEqual(avail(1, 2, 2));
  });
});

describe("evidence availability", () => {
  it("TST-B2-005 partial, unavailable and missing evidence never yield quality scores or false zeros", () => {
    const answerKey = { expectedFacts: facts("f1"), expectedContextTargets: [{ file: "a.ts", factIds: ["f1"] }] };
    for (const [e, reason] of [
      [evidence(["a.ts"], [{ name: "X", file: "a.ts" }], "partial"), "retrieval-evidence-partial"],
      [evidence([], [], "unavailable"), "retrieval-evidence-unavailable"],
      [undefined, "retrieval-evidence-missing"]
    ] as const) {
      const m = calc(caseOf({ answerKey }), e);
      for (const metric of [m.file.precision, m.file.recall, m.symbol.precision, m.symbol.recall, m.fact.coverage, m.irrelevantContextRatio]) {
        expect(metric).toEqual(unavailable(reason));
      }
      expect(m.file.missedFiles).toBeNull();
      expect(m.symbol.missedSymbols).toBeNull();
      expect(m.fact.coveredFactIds).toBeNull();
      expect(m.retrievedTokenCount).toBe(100);
    }
  });
});

describe("symbol metrics", () => {
  it("TST-B2-006 matches exact, case-sensitive names only", () => {
    const m = calc(caseOf({ symbols: ["createTask"] }), evidence(["a.ts"], [{ name: "createtask" }, { name: "CreateTask" }, { name: "createTaskImpl" }, { name: "Service.createTask" }]));
    expect(m.symbol.relevantRetrievedSymbols).toEqual([]);
    expect(m.symbol.recall).toEqual(avail(0, 0, 1));
    expect(m.symbol.precision).toEqual(avail(0, 0, 4));
    const exact = calc(caseOf({ symbols: ["createTask"] }), evidence(["a.ts"], [{ name: "createTask" }]));
    expect(exact.symbol.recall).toEqual(avail(1, 1, 1));
  });

  it("TST-B2-007 counts same-named symbol identities once", () => {
    const m = calc(
      caseOf({ symbols: ["run"] }),
      evidence(["a.ts"], [
        { name: "run", file: "a.ts", nodeId: "symbol:a.ts#run" },
        { name: "run", file: "b.ts", nodeId: "symbol:b.ts#run" }
      ])
    );
    expect(m.symbol.precision).toEqual(avail(1, 1, 1));
    expect(m.symbol.relevantRetrievedSymbols).toEqual(["run"]);
  });

  it("TST-B2-008 reports symbol false positives and false negatives", () => {
    const m = calc(caseOf({ symbols: ["A", "B", "C"] }), evidence(["a.ts"], [{ name: "A" }, { name: "Z" }, { name: "Y" }]));
    expect(m.symbol).toMatchObject({
      relevantRetrievedSymbols: ["A"],
      irrelevantRetrievedSymbols: ["Y", "Z"],
      missedSymbols: ["B", "C"],
      missedSymbolCount: 2,
      precision: avail(1 / 3, 1, 3),
      recall: avail(1 / 3, 1, 3)
    });
  });

  it("handles zero retrieved and zero expected symbols explicitly", () => {
    expect(calc(caseOf({ symbols: ["A"] }), evidence(["a.ts"], [])).symbol).toMatchObject({
      precision: notApplicable("no-retrieved-symbols"),
      recall: avail(0, 0, 1)
    });
    expect(calc(caseOf({ symbols: [] }), evidence(["a.ts"], [{ name: "A" }])).symbol.recall).toEqual(notApplicable("no-expected-symbols"));
  });

  it("rejects invalid expected symbols instead of dropping them", () => {
    const m = calc(caseOf({ symbols: ["A", ""] }), evidence(["a.ts"], [{ name: "A" }]));
    expect(m.symbol.precision).toEqual(unavailable("invalid-expected-symbol"));
    expect(m.file.precision.availability).toBe("available");
  });
});

describe("answer-key agreement", () => {
  it("TST-B2-009 conflicting top-level and answer-key expectations are unavailable, not reconciled", () => {
    const m = calc(caseOf({ files: ["a.ts"], symbols: ["X"], answerKey: {}, topFiles: ["b.ts"], topSymbols: ["Y"] }), evidence(["a.ts", "b.ts"], [{ name: "X" }]));
    expect(m.expectations).toEqual({
      files: { availability: "unavailable", reason: "expected-files-answer-key-mismatch" },
      symbols: { availability: "unavailable", reason: "expected-symbols-answer-key-mismatch" }
    });
    expect(m.file.precision).toEqual(unavailable("expected-files-answer-key-mismatch"));
    expect(m.symbol.recall).toEqual(unavailable("expected-symbols-answer-key-mismatch"));
  });

  it("treats ordering and path-form differences as agreement, and uses top-level values without an answer key", () => {
    const agree = calc(caseOf({ files: ["a.ts", "b.ts"], answerKey: {}, topFiles: ["./b.ts", "a\\.ts".replace("\\", "")] }), evidence(["a.ts"]));
    expect(agree.expectations.files.availability).toBe("available");
    const noKey = calc(caseOf({ files: ["a.ts"] }), evidence(["a.ts"]));
    expect(noKey.file.recall).toEqual(avail(1, 1, 1));
  });
});

describe("fact coverage", () => {
  const target = (file: string, factIds: string[], extra: Partial<ExpectedContextTarget> = {}): ExpectedContextTarget => ({ file, factIds, ...extra });
  const withFacts = (expectedFacts: ExpectedAnswerFact[], expectedContextTargets?: ExpectedContextTarget[]) =>
    caseOf({ answerKey: { expectedFacts, expectedContextTargets } });

  it("TST-B2-011 computes deterministic coverage over complete mappings", () => {
    const c = withFacts(facts("f3", "f1", "f2"), [target("a.ts", ["f1"]), target("b.ts", ["f2", "f3"]), target("c.ts", ["f3"])]);
    const m = calc(c, evidence(["a.ts", "b.ts"]));
    expect(m.fact).toMatchObject({ coveredFactIds: ["f1", "f2"], uncoveredFactIds: ["f3"], uncoveredFactCount: 1, coverage: avail(2 / 3, 2, 3) });
  });

  it("TST-B2-012 a file-only target is covered by its retrieved file", () => {
    const c = withFacts(facts("f1"), [target("a.ts", ["f1"])]);
    expect(calc(c, evidence(["a.ts"])).fact.coverage).toEqual(avail(1, 1, 1));
    expect(calc(c, evidence(["b.ts"])).fact.coverage).toEqual(avail(0, 0, 1));
  });

  it("TST-B2-013 a file-plus-symbol target needs the symbol retrieved with that file", () => {
    const c = withFacts(facts("f1"), [target("a.ts", ["f1"], { symbols: ["X"] })]);
    expect(calc(c, evidence(["a.ts"], [{ name: "X", file: "a.ts" }])).fact.coverage.value).toBe(1);
    expect(calc(c, evidence(["a.ts"], [])).fact.coverage.value).toBe(0);
  });

  it("TST-B2-014 the same symbol name in another file, or without file identity, does not satisfy a target", () => {
    const c = withFacts(facts("f1"), [target("a.ts", ["f1"], { symbols: ["X"] })]);
    expect(calc(c, evidence(["a.ts", "b.ts"], [{ name: "X", file: "b.ts" }])).fact.coverage.value).toBe(0);
    expect(calc(c, evidence(["a.ts"], [{ name: "X" }])).fact.coverage.value).toBe(0);
  });

  it("TST-B2-015 a fact with several required targets needs all of them", () => {
    const c = withFacts(facts("f1"), [target("a.ts", ["f1"]), target("b.ts", ["f1"])]);
    expect(calc(c, evidence(["a.ts"])).fact.uncoveredFactIds).toEqual(["f1"]);
    expect(calc(c, evidence(["a.ts", "b.ts"])).fact.coveredFactIds).toEqual(["f1"]);
  });

  it("TST-B2-016 optional targets do not gate coverage", () => {
    const c = withFacts(facts("f1"), [target("a.ts", ["f1"]), target("zzz.ts", ["f1"], { required: false })]);
    expect(calc(c, evidence(["a.ts"])).fact.coverage).toEqual(avail(1, 1, 1));
  });

  it("TST-B2-017 incomplete mapping is unavailable, never scored over the mapped subset", () => {
    const partialMap = withFacts(facts("f1", "f2"), [target("a.ts", ["f1"])]);
    expect(calc(partialMap, evidence(["a.ts"])).fact.coverage).toEqual(unavailable("fact-context-mapping-unavailable"));
    const onlyOptional = withFacts(facts("f1"), [target("a.ts", ["f1"], { required: false })]);
    expect(calc(onlyOptional, evidence(["a.ts"])).fact.coverage).toEqual(unavailable("fact-context-mapping-unavailable"));
    const legacyTargets = withFacts(facts("f1"), [{ file: "a.ts", symbols: ["X"] }]);
    expect(calc(legacyTargets, evidence(["a.ts"])).fact.coverage).toEqual(unavailable("fact-context-mapping-unavailable"));
    expect(calc(withFacts(facts("f1"), undefined), evidence(["a.ts"])).fact.coverage).toEqual(unavailable("fact-context-mapping-unavailable"));
    expect(calc(caseOf({ answerKey: null }), evidence(["a.ts"])).fact.coverage).toEqual(unavailable("answer-key-missing"));
  });

  it("TST-B2-010 invalid required mapped targets make fact coverage unavailable", () => {
    for (const bad of [target("/abs/a.ts", ["f1"]), target("../a.ts", ["f1"]), target("a.ts", ["unknown"]), target("a.ts", ["f1", "f1"]), target("a.ts", ["f1"], { symbols: [""] })]) {
      const c = withFacts(facts("f1"), [target("a.ts", ["f1"]), bad]);
      expect(calc(c, evidence(["a.ts"])).fact.coverage).toEqual(unavailable("fact-context-mapping-invalid"));
    }
    const optionalBad = withFacts(facts("f1"), [target("a.ts", ["f1"]), target("/abs/a.ts", ["f1"], { required: false })]);
    expect(calc(optionalBad, evidence(["a.ts"])).fact.coverage.availability).toBe("available");
  });

  it("zero expected facts is not-applicable", () => {
    expect(calc(withFacts([], []), evidence(["a.ts"])).fact.coverage).toEqual(notApplicable("no-expected-facts"));
  });

  it("TST-B2-018/019/020 ignores fact text, weight and the required flag", () => {
    const targets = [target("a.ts", ["f1"]), target("b.ts", ["f2"])];
    const base = calc(withFacts(facts("f1", "f2"), targets), evidence(["a.ts"]));
    const varied = calc(
      withFacts(
        [
          { id: "f1", text: "completely different prose mentioning b.ts and createTask", weight: 99, required: false },
          { id: "f2", text: "", weight: 0.001, required: false }
        ],
        targets
      ),
      evidence(["a.ts"])
    );
    expect(varied.fact).toEqual(base.fact);
    expect(base.fact.coverage).toEqual(avail(0.5, 1, 2));
  });
});

describe("tokens, ordering, determinism, privacy", () => {
  it("TST-B2-021 carries the measured token count without recomputation", () => {
    const withTokens = (tokens: number) => calc(caseOf({}), evidence(["a.ts"]), tokens);
    expect(withTokens(1234)).toMatchObject({ retrievedTokenCount: 1234, tokenCountMethod: "estimated_chars_div_4" });
    expect(withTokens(0)).toMatchObject({ retrievedTokenCount: 0, tokenCountMethod: "estimated_chars_div_4" });
    expect(calc(caseOf({}), evidence(["a.ts", "b.ts", "c.ts"]), 7).retrievedTokenCount).toBe(7);
    expect(withTokens(Number.NaN)).toMatchObject({ retrievedTokenCount: null, tokenCountMethod: null });
  });

  it("TST-B2-022/023 is order independent and repeatable without mutating inputs", () => {
    const caseA = caseOf({ files: ["b.ts", "a.ts"], symbols: ["Y", "X"], answerKey: { expectedFacts: facts("f2", "f1"), expectedContextTargets: [{ file: "b.ts", factIds: ["f2"] }, { file: "a.ts", factIds: ["f1"] }] } });
    const caseB = caseOf({ files: ["a.ts", "b.ts"], symbols: ["X", "Y"], answerKey: { expectedFacts: facts("f1", "f2"), expectedContextTargets: [{ file: "a.ts", factIds: ["f1"] }, { file: "b.ts", factIds: ["f2"] }] } });
    const ev1 = evidence(["z.ts", "a.ts", "b.ts"], [{ name: "Y" }, { name: "Q" }, { name: "X" }]);
    const ev2 = evidence(["b.ts", "a.ts", "z.ts"], [{ name: "X" }, { name: "Y" }, { name: "Q" }]);
    const snapshot = JSON.stringify([caseA, ev1]);
    const first = calc(caseA, ev1);
    expect(JSON.stringify([caseA, ev1])).toBe(snapshot);
    expect(calc(caseA, ev1)).toEqual(first);
    expect(calc(caseB, ev2)).toEqual(first);
    expect(first.file.relevantRetrievedFiles).toEqual(["a.ts", "b.ts"]);
    expect(first.symbol.irrelevantRetrievedSymbols).toEqual(["Q"]);
    expect(first.fact.coveredFactIds).toEqual(["f1", "f2"]);
  });

  it("TST-B2-024 output holds no raw or machine-local material", () => {
    const e = buildRetrievalEvidence({
      commands: [
        { family: "search", ok: true, stdout: JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "1.0.0", indexDir: "C:/Users/someone/private", query: "SOURCE_BODY", results: [{ kind: "file", path: "a.ts", nodeId: "file:a.ts" }] }) },
        { family: "source", ok: true }
      ],
      selection: { nodeId: "file:a.ts", file: "a.ts" }
    });
    const m = calc(caseOf({ files: ["a.ts"] }), e);
    const serialized = JSON.stringify(m);
    for (const marker of ["SOURCE_BODY", "someone", "private", "node.exe", "stdout", "stderr"]) {
      expect(serialized).not.toContain(marker);
    }
    expect(Object.keys(m).sort()).toEqual(["caseId", "evidence", "expectations", "fact", "file", "irrelevantContextRatio", "retrievedTokenCount", "schemaVersion", "symbol", "tokenCountMethod"]);
    expect(m.schemaVersion).toBe("retrieval-quality-metrics-v1");
  });

  it("emits no ranking, composite, winner or threshold fields", () => {
    const serialized = JSON.stringify(calc(caseOf({}), evidence(["a.ts"])));
    for (const forbidden of ["mrr", "ndcg", "rank", "score", "winner", "threshold", "f1", "composite", "pass"]) {
      expect(serialized.toLowerCase()).not.toContain(`"${forbidden}`);
    }
  });
});
